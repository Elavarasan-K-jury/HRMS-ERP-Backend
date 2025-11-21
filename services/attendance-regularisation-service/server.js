import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";

const PORT = Number(process.env.REGULARISATION_SERVICE_PORT || 5070);
const proto = loadProto("attendance_regularisation");

function parseDate(d) {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t) ? null : t;
}

function mapReg(r) {
  return {
    id: r.id,
    attendance_id: r.attendanceId,
    employee_id: r.employeeId,
    reason: r.reason,
    status: r.status,
    requested_at: r.requestedAt?.toISOString() || "",
    approved_at: r.approvedAt?.toISOString() || "",
    approved_by: r.approvedBy || "",
    remarks: r.remarks || "",
    corrected_check_in: r.correctedData?.newCheckIn || "",
    corrected_check_out: r.correctedData?.newCheckOut || "",
  };
}

const impl = {
  // -------------------------------
  // Create Regularisation Request
  // -------------------------------
  CreateRegularisation: async (call, callback) => {
    try {
      const { attendance_id, employee_id, reason, corrected_check_in, corrected_check_out } = call.request;

      const attendance = await prisma.attendance.findUnique({
        where: { id: attendance_id },
      });

      if (!attendance)
        return callback({ code: grpc.status.NOT_FOUND, message: "Attendance not found" });

      const reg = await prisma.attendanceRegularisation.create({
        data: {
          attendanceId: attendance_id,
          employeeId: employee_id,
          reason,
          correctedData: {
            newCheckIn: corrected_check_in || null,
            newCheckOut: corrected_check_out || null,
          },
        },
      });

      return callback(null, { regularisation: mapReg(reg) });
    } catch (e) {
      return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // -------------------------------
  // List Regularisations
  // -------------------------------
  ListRegularisations: async (call, callback) => {
    try {
      const { employee_id, organization_id, status } = call.request;

      const where = {
        deletedAt: null,
      };

      if (employee_id) where.employeeId = employee_id;

      if (status) where.status = status;

      if (organization_id) {
        where.employee = {
          organizationId: organization_id,
        };
      }

      const list = await prisma.attendanceRegularisation.findMany({
        where,
        include: { employee: true },
        orderBy: { requestedAt: "desc" },
      });

      return callback(null, { regularisations: list.map(mapReg) });
    } catch (e) {
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // -------------------------------
  // Approve
  // -------------------------------
  ApproveRegularisation: async (call, callback) => {
    try {
      const { regularisation_id, approver_id, remarks } = call.request;

      const reg = await prisma.attendanceRegularisation.findUnique({
        where: { id: regularisation_id },
      });

      if (!reg)
        return callback({ code: grpc.status.NOT_FOUND, message: "Regularisation not found" });

      // update attendance
      await prisma.attendance.update({
        where: { id: reg.attendanceId },
        data: {
          checkIn: reg.correctedData?.newCheckIn ? new Date(reg.correctedData.newCheckIn) : undefined,
          checkOut: reg.correctedData?.newCheckOut ? new Date(reg.correctedData.newCheckOut) : undefined,
        },
      });

      const updated = await prisma.attendanceRegularisation.update({
        where: { id: regularisation_id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: approver_id,
          remarks,
        },
      });

      // log approval
      await prisma.approvalLogs.create({
        data: {
          organizationId: reg.employeeId, // fix later
          entityId: reg.id,
          entityType: "REGULARISATION",
          level: 1,
          action: "APPROVED",
          approverId: approver_id,
        },
      });

      return callback(null, { regularisation: mapReg(updated) });
    } catch (e) {
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },

  // -------------------------------
  // Reject
  // -------------------------------
  RejectRegularisation: async (call, callback) => {
    try {
      const { regularisation_id, approver_id, remarks } = call.request;

      const reg = await prisma.attendanceRegularisation.findUnique({
        where: { id: regularisation_id },
      });

      if (!reg)
        return callback({ code: grpc.status.NOT_FOUND, message: "Regularisation not found" });

      const updated = await prisma.attendanceRegularisation.update({
        where: { id: regularisation_id },
        data: {
          status: "REJECTED",
          approvedAt: new Date(),
          approvedBy: approver_id,
          remarks,
        },
      });

      await prisma.approvalLogs.create({
        data: {
          organizationId: reg.employeeId,
          entityId: reg.id,
          entityType: "REGULARISATION",
          level: 1,
          action: "REJECTED",
          approverId: approver_id,
        },
      });

      callback(null, { regularisation: mapReg(updated) });
    } catch (e) {
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },
};

/* ------------------------ */
async function main() {
  const server = new grpc.Server();
  server.addService(proto.AttendanceRegularisationService.service, impl);

  await new Promise((resolve) =>
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      resolve
    )
  );

  console.log(`[regularisation-service] running on :${PORT}`);
  server.start();
}
main();
