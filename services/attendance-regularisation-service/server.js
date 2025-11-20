import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { startOfMonth, endOfMonth, differenceInCalendarDays } from 'date-fns';

const PORT = Number(process.env.REGULARISATION_SERVICE_PORT || 50064);
const proto = loadProto('attendance_regularisation');

const MAX_REQUESTS_PER_MONTH = Number(process.env.REG_MAX_PER_MONTH || 3);
const REG_WINDOW_DAYS = Number(process.env.REG_WINDOW_DAYS || 30);

const impl = {

  CreateRegularisation: async (call, callback) => {
    try {
      const {
        organization_id,
        attendance_id,
        employee_id,
        reason,
        is_admin_override,
        new_check_in,
        new_check_out,
        remarks,
      } = call.request;

      // 1️⃣ IP Restriction validation
      const metaIp =
        call.metadata?.get('x-forwarded-for')?.[0] ||
        call.getPeer()?.replace('ipv4:', '').split(':')[0];
      const allowedIp = await prisma.organizationIpRestrictions.findFirst({
        where: { organizationId: organization_id, ipAddress: metaIp, deletedAt: null },
      });
      if (!allowedIp) {
        return callback({
          code: grpc.status.PERMISSION_DENIED,
          message: `Access denied from IP ${metaIp}`,
        });
      }

      // 2️⃣ Attendance existence + ownership
      const attendance = await prisma.attendance.findUnique({ where: { id: attendance_id } });
      if (!attendance)
        return callback({ code: grpc.status.NOT_FOUND, message: 'Attendance not found' });
      if (attendance.employeeId !== employee_id)
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Attendance not owned by employee' });
      if (attendance.organizationId !== organization_id)
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Organization mismatch' });

      // 3️⃣ Prevent duplicate PENDING requests
      const dup = await prisma.attendanceRegularisation.findFirst({
        where: { attendanceId: attendance_id, status: 'PENDING' },
      });
      if (dup)
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: 'Pending regularisation already exists for this attendance',
        });

      // 4️⃣ Policy checks
      if (!is_admin_override) {
        // monthly cap
        const monthStart = startOfMonth(new Date());
        const monthEnd = endOfMonth(new Date());
        const count = await prisma.attendanceRegularisation.count({
          where: {
            employeeId: employee_id,
            requestedAt: { gte: monthStart, lte: monthEnd },
          },
        });
        if (count >= MAX_REQUESTS_PER_MONTH)
          return callback({
            code: grpc.status.RESOURCE_EXHAUSTED,
            message: `Limit of ${MAX_REQUESTS_PER_MONTH} regularisations per month reached`,
          });

        // backdated window
        const daysDiff = Math.abs(
          differenceInCalendarDays(new Date(), new Date(attendance.date))
        );
        if (daysDiff > REG_WINDOW_DAYS)
          return callback({
            code: grpc.status.FAILED_PRECONDITION,
            message: `Regularisation allowed only for last ${REG_WINDOW_DAYS} day(s)`,
          });

        // holiday / leave conflict
        const holiday = await prisma.holidays.findFirst({
          where: { organizationId: organization_id, date: attendance.date, deletedAt: null },
        });
        if (holiday)
          return callback({
            code: grpc.status.FAILED_PRECONDITION,
            message: 'Cannot raise regularisation for a holiday',
          });

        const leave = await prisma.leaveRequests.findFirst({
          where: {
            organizationId: organization_id,
            employeeId: employee_id,
            status: 'APPROVED',
            startDate: { lte: attendance.date },
            endDate: { gte: attendance.date },
          },
        });
        if (leave)
          return callback({
            code: grpc.status.FAILED_PRECONDITION,
            message: 'Cannot regularise on an approved leave day',
          });
      }

      // 5️⃣ Create request
      const packedRemarks = JSON.stringify({
        new_check_in,
        new_check_out,
        note: remarks ?? '',
      });

      const reg = await prisma.attendanceRegularisation.create({
        data: {
          attendanceId: attendance_id,
          employeeId: employee_id,
          reason,
          status: 'PENDING',
          remarks: packedRemarks,
        },
      });

      callback(null, {
        regularisation: mapReg(reg, organization_id, new_check_in, new_check_out),
      });
    } catch (e) {
      console.error('[CreateRegularisation Error]', e);
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // ------------------------------------------------
  // Approve Regularisation (multi-level aware)
  // ------------------------------------------------
  ApproveRegularisation: async (call, callback) => {
    try {
      const { id, approver_id, remarks } = call.request;
      const reg = await prisma.attendanceRegularisation.findUnique({ where: { id } });
      if (!reg)
        return callback({ code: grpc.status.NOT_FOUND, message: 'Regularisation not found' });

      const attendance = await prisma.attendance.findUnique({ where: { id: reg.attendanceId } });
      if (!attendance)
        return callback({ code: grpc.status.NOT_FOUND, message: 'Linked attendance not found' });

      const orgId = attendance.organizationId;

      // Determine current approval level
      const existingLogs = await prisma.approvalLogs.findMany({
        where: { entityId: id, entityType: 'REGULARISATION', organizationId: orgId },
      });
      const currentLevel = existingLogs.length + 1;

      // Fetch flow definition
      const nextFlow = await prisma.approvalFlows.findFirst({
        where: {
          organizationId: orgId,
          entityType: 'REGULARISATION',
          level: currentLevel,
          isActive: true,
        },
      });

      // Record this approval
      await prisma.approvalLogs.create({
        data: {
          organizationId: orgId,
          entityId: id,
          entityType: 'REGULARISATION',
          level: currentLevel,
          approverId: approver_id,
          action: 'APPROVED',
          remarks: remarks ?? '',
          approvedAt: new Date(),
        },
      });

      if (nextFlow) {
        // Move to next approval level
        const updatedReg = await prisma.attendanceRegularisation.update({
          where: { id },
          data: { status: 'PENDING', remarks: mergeRemarks(reg.remarks, remarks) },
        });
        return callback(null, { regularisation: mapReg(updatedReg, orgId) });
      }

      // Final approval (no further level)
      const parsed = safeParseRegTimes(reg.remarks);
      const employee = await prisma.organizationEmployees.findUnique({
        where: { id: attendance.employeeId },
        include: { EmployeeShiftAssignment: { include: { shift: true } } },
      });
      const shiftAssign = employee?.EmployeeShiftAssignment?.find(
        (a) =>
          new Date(a.validFrom) <= new Date(attendance.date) &&
          (!a.validTo || new Date(a.validTo) >= new Date(attendance.date))
      );
      const shift = shiftAssign?.shift ?? null;
      const policy = await prisma.attendancePolicies.findFirst({
        where: { organizationId: orgId, isActive: true },
      });

      let correctedCheckIn = parsed?.new_check_in
        ? new Date(parsed.new_check_in)
        : attendance.checkIn;
      let correctedCheckOut = parsed?.new_check_out
        ? new Date(parsed.new_check_out)
        : attendance.checkOut;

      if (!correctedCheckIn && shift?.startTime) correctedCheckIn = new Date(shift.startTime);
      if (!correctedCheckOut && shift?.endTime) correctedCheckOut = new Date(shift.endTime);

      let status = 'PRESENT';
      let grossHours = 0;
      let lateMins = 0;
      if (correctedCheckIn && correctedCheckOut) {
        grossHours = (correctedCheckOut - correctedCheckIn) / 1000 / 60 / 60;
        if (shift?.startTime) {
          const shiftStart = new Date(shift.startTime);
          lateMins = Math.max(0, (correctedCheckIn - shiftStart) / 60000);
        }
        if (lateMins > (policy?.graceMinutes ?? 10)) status = 'LATE';
        if (grossHours < (policy?.halfDayMinutes ?? 240) / 60) status = 'HALF_DAY';
      }

      await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          checkIn: correctedCheckIn,
          checkOut: correctedCheckOut,
          grossHours,
          lateArrivalMinutes: lateMins,
          status,
        },
      });

      const updatedReg = await prisma.attendanceRegularisation.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: approver_id,
          remarks: mergeRemarks(reg.remarks, remarks),
        },
      });

      callback(null, {
        regularisation: mapReg(updatedReg, orgId, parsed?.new_check_in, parsed?.new_check_out),
      });
    } catch (e) {
      console.error('[ApproveRegularisation Error]', e);
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // ------------------------------------------------
  // Reject Regularisation
  // ------------------------------------------------
  RejectRegularisation: async (call, callback) => {
    try {
      const { id, approver_id, reason } = call.request;
      const reg = await prisma.attendanceRegularisation.findUnique({ where: { id } });
      if (!reg)
        return callback({ code: grpc.status.NOT_FOUND, message: 'Regularisation not found' });

      const attendance = await prisma.attendance.findUnique({ where: { id: reg.attendanceId } });
      if (!attendance)
        return callback({ code: grpc.status.NOT_FOUND, message: 'Linked attendance not found' });

      const updatedReg = await prisma.attendanceRegularisation.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approvedAt: new Date(),
          approvedBy: approver_id,
          remarks: mergeRemarks(reg.remarks, reason),
        },
      });

      await prisma.approvalLogs.create({
        data: {
          organizationId: attendance.organizationId,
          entityId: id,
          entityType: 'REGULARISATION',
          level: 1,
          approverId: approver_id,
          action: 'REJECTED',
          remarks: reason ?? '',
          approvedAt: new Date(),
        },
      });

      callback(null, { regularisation: mapReg(updatedReg, attendance.organizationId) });
    } catch (e) {
      console.error('[RejectRegularisation Error]', e);
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // ------------------------------------------------
  // List by Employee & Month
  // ------------------------------------------------
  ListRegularisations: async (call, callback) => {
    try {
      const { employee_id, month, status } = call.request;
      const [year, monthNum] = month.split('-').map(Number);
      const start = new Date(year, monthNum - 1, 1);
      const end = new Date(year, monthNum, 0, 23, 59, 59, 999);

      const list = await prisma.attendanceRegularisation.findMany({
        where: {
          employeeId: employee_id,
          requestedAt: { gte: start, lte: end },
          ...(status ? { status } : {}),
        },
        orderBy: { requestedAt: 'desc' },
      });

      callback(null, { regularisations: list.map((r) => mapReg(r)) });
    } catch (e) {
      console.error('[ListRegularisations Error]', e);
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },
};

// --------------------
// Helpers / Mappers
// --------------------
function mapReg(r, organization_id = '', new_check_in = '', new_check_out = '') {
  const parsed = safeParseRegTimes(r.remarks);
  return {
    id: r.id,
    organization_id,
    attendance_id: r.attendanceId,
    employee_id: r.employeeId,
    reason: r.reason,
    status: r.status,
    requested_at: r.requestedAt?.toISOString() ?? '',
    approved_at: r.approvedAt?.toISOString() ?? '',
    approved_by: r.approvedBy ?? '',
    remarks: parsed?.note || '',
    new_check_in: parsed?.new_check_in || new_check_in || '',
    new_check_out: parsed?.new_check_out || new_check_out || '',
  };
}

function mergeRemarks(existing, extra) {
  if (!existing && !extra) return '';
  if (!existing) return extra ?? '';
  if (!extra) return existing ?? '';
  return `${existing}\n${extra}`;
}

function safeParseRegTimes(remarks) {
  try {
    const obj = JSON.parse(remarks || '{}');
    if (typeof obj === 'object') return obj;
    return null;
  } catch {
    return null;
  }
}




/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
    const server = new grpc.Server();

    server.addService(proto.AttendanceRegularisationService.service, impl);

    // Convert bindAsync to Promise
    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[attendance-regularization-service] gRPC running on :${PORT}`);

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\n[attendance-regularization-service] Received ${signal}, shutting down gracefully...`);

        try {
            // 🧹 Stop accepting new gRPC calls
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[attendance-regularization-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[attendance-regularization-service] gRPC server stopped.');
                }
            });

            // 🧹 Disconnect Prisma cleanly
            await prisma.$disconnect();
            console.log('[attendance-regularization-service] Prisma disconnected.');

            process.exit(0);
        } catch (e) {
            console.error('[attendance-regularization-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    // Handle termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[attendance-regularization-service] Fatal error:', err);
    process.exit(1);
});