// leave-request-service/server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

/* ---------------------------------------------
   CONFIG
--------------------------------------------- */
const PORT = process.env.LEAVE_REQUEST_SERVICE_PORT || 5080;
const leaveProto = loadProto('leave_request');

/* ---------------------------------------------
   HELPERS
--------------------------------------------- */
function toApiLeaveRequest(r) {
    if (!r) return null;

    return {
        id: r.id,
        employee_id: r.employeeId,
        organization_id: r.organizationId,
        leave_type_id: r.leaveTypeId,

        start_date: r.startDate?.toISOString(),
        end_date: r.endDate?.toISOString(),

        total_days: r.totalDays || 0,
        is_half_day: r.isHalfDay || false,
        half_day_type: r.halfDayType || '',

        reason: r.reason || '',
        documents: r.documents ? JSON.stringify(r.documents) : '',

        status: r.status,

        cancellation_reason: r.cancellationReason || '',
        cancelled_at: r.cancelledAt?.toISOString() || '',
        cancelled_by: r.cancellationBy || '',

        approval_level: r.approvalLevel || 1,
        approval_instance_id: r.approvalInstanceId || '',

        approved_at: r.approvedAt?.toISOString() || '',
        rejected_at: r.rejectedAt?.toISOString() || '',
        rejection_reason: r.rejectionReason || '',

        created_at: r.createdAt?.toISOString(),
        updated_at: r.updatedAt?.toISOString(),
        deleted_at: r.deletedAt?.toISOString() || '',
    };
}

/* ============================================================
   MAIN IMPLEMENTATION
============================================================ */
const impl = {
    /* --------------------------------------------------------
       APPLY LEAVE
    -------------------------------------------------------- */
    ApplyLeave: async (call, cb) => {
        try {
            const {
                employee_id,
                organization_id,
                leave_type_id,
                start_date,
                end_date,
                is_half_day,
                half_day_type,
                reason,
                documents,
            } = call.request;

            // Validate employee/leave type exists
            const employee = await prisma.organizationEmployees.findFirst({
                where: { id: employee_id, deletedAt: null },
            });
            if (!employee)
                return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            const leaveType = await prisma.leaveTypes.findFirst({
                where: { id: leave_type_id, organizationId: organization_id, deletedAt: null },
            });
            if (!leaveType)
                return cb({ code: grpc.status.NOT_FOUND, message: 'Leave type not found' });

            // Calculate total days
            const s = new Date(start_date);
            const e = new Date(end_date);
            let totalDays = (e - s) / (1000 * 60 * 60 * 24) + 1;

            if (is_half_day) totalDays = 0.5;

            // Insert leave
            const req = await prisma.leaveRequests.create({
                data: {
                    employeeId: employee_id,
                    organizationId: organization_id,
                    leaveTypeId: leave_type_id,

                    startDate: s,
                    endDate: e,

                    isHalfDay: is_half_day,
                    halfDayType: half_day_type,
                    totalDays: totalDays,

                    reason: reason,
                    documents: documents ? JSON.parse(documents) : null,

                    status: 'PENDING',
                    approvalLevel: 1,
                },
            });

            // Create approval instance
            const approvalInstance = await prisma.approvalInstance.create({
                data: {
                    organizationId: organization_id,
                    entityId: req.id,
                    entityType: 'LEAVE',
                    flowId: await getLeaveFlowId(organization_id),
                    currentLevel: 1,
                    status: 'PENDING',
                },
            });

            await prisma.leaveRequests.update({
                where: { id: req.id },
                data: { approvalInstanceId: approvalInstance.id },
            });

            cb(null, {
                success: true,
                message: 'Leave applied successfully',
                leave_request: toApiLeaveRequest({ ...req, approvalInstanceId: approvalInstance.id }),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       CANCEL LEAVE
    -------------------------------------------------------- */
    CancelLeave: async (call, cb) => {
        try {
            const { request_id, employee_id, reason } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { id: request_id, deletedAt: null },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            if (req.employeeId !== employee_id)
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Not allowed' });

            if (req.status === 'APPROVED') {
                return cb({
                    code: grpc.status.PERMISSION_DENIED,
                    message: 'Approved leaves require approval to cancel',
                });
            }

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    status: 'CANCELLED',
                    cancellationReason: reason,
                    cancelledAt: new Date(),
                    cancellationBy: employee_id,
                },
            });

            cb(null, {
                success: true,
                message: 'Leave cancelled successfully',
                leave_request: toApiLeaveRequest(updated),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       APPROVE
    -------------------------------------------------------- */
    ApproveLeave: async (call, cb) => {
        try {
            const { request_id, approver_id } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { id: request_id, deletedAt: null },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    status: 'APPROVED',
                    approvedAt: new Date(),
                },
            });

            cb(null, {
                success: true,
                message: 'Leave approved',
                leave_request: toApiLeaveRequest(updated),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       REJECT
    -------------------------------------------------------- */
    RejectLeave: async (call, cb) => {
        try {
            const { request_id, approver_id, reason } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { id: request_id, deletedAt: null },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    status: 'REJECTED',
                    rejectedAt: new Date(),
                    rejectionReason: reason,
                },
            });

            cb(null, {
                success: true,
                message: 'Leave rejected',
                leave_request: toApiLeaveRequest(updated),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       GET SINGLE
    -------------------------------------------------------- */
    GetLeaveRequest: async (call, cb) => {
        try {
            const { id } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { id, deletedAt: null },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Not found' });

            cb(null, {
                success: true,
                message: 'Leave request fetched',
                leave_request: toApiLeaveRequest(req),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LIST
    -------------------------------------------------------- */
    ListLeaveRequests: async (call, cb) => {
        try {
            const { employee_id, organization_id } = call.request;

            const rows = await prisma.leaveRequests.findMany({
                where: {
                    employeeId: employee_id,
                    organizationId: organization_id,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
            });

            cb(null, {
                leave_requests: rows.map(toApiLeaveRequest),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LEAVE BALANCE
    -------------------------------------------------------- */
    GetLeaveBalance: async (call, cb) => {
        try {
            const { employee_id, organization_id } = call.request;

            // Fetch all leave types
            const types = await prisma.leaveTypes.findMany({
                where: { organizationId: organization_id, deletedAt: null },
            });

            // Used leaves
            const usedMap = {};
            const used = await prisma.leaveRequests.groupBy({
                by: ['leaveTypeId'],
                where: { employeeId: employee_id, status: 'APPROVED' },
                _sum: { totalDays: true },
            });

            used.forEach((u) => {
                usedMap[u.leaveTypeId] = u._sum.totalDays || 0;
            });

            const balances = types.map((t) => ({
                leave_type_id: t.id,
                leave_type_name: t.name,
                accrued: t.monthlyAccrualRate || 0,
                used: usedMap[t.id] || 0,
                available: (t.monthlyAccrualRate || 0) - (usedMap[t.id] || 0),
            }));

            cb(null, { balances });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LEAVE CALENDAR
    -------------------------------------------------------- */
    GetLeaveCalendar: async (call, cb) => {
        try {
            const { employee_id, organization_id, month } = call.request;

            const [year, m] = month.split('-').map(Number);

            const start = new Date(year, m - 1, 1);
            const end = new Date(year, m, 0);

            // Fetch holidays
            const holidays = await prisma.holidays.findMany({
                where: {
                    organizationId: organization_id,
                    date: { gte: start, lte: end },
                },
            });

            // Fetch approved leaves
            const leaves = await prisma.leaveRequests.findMany({
                where: {
                    employeeId: employee_id,
                    status: 'APPROVED',
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                include: { leaveType: true },
            });

            const result = [];

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];

                const isHoliday = holidays.some((h) => h.date.toISOString().startsWith(dateStr));

                const leave = leaves.find(
                    (l) =>
                        new Date(l.startDate) <= d &&
                        new Date(l.endDate) >= d
                );

                result.push({
                    date: dateStr,
                    status: leave
                        ? 'LEAVE'
                        : isHoliday
                        ? 'HOLIDAY'
                        : 'NONE',
                    leave_type_name: leave?.leaveType?.name || '',
                });
            }

            cb(null, { calendar: result });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ============================================================
   MAIN SERVER BOOTSTRAP
============================================================ */
async function main() {
    await checkDbConnection('leave-request-service');

    const server = new grpc.Server();

    server.addService(leaveProto.LeaveRequestService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[leave-request-service] gRPC running on :${PORT}`);

    // graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n[leave-request-service] ${signal} received, shutting down...`);
        server.tryShutdown(async () => {
            await prisma.$disconnect();
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
    console.error('[leave-request-service] Fatal:', e);
    process.exit(1);
});

