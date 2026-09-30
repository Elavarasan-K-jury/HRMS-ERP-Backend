import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma, checkDbConnection } from "@jury-hrms/db/client.js";
import { subscribe } from '@jury-hrms/redis';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.REGULARISATION_SERVICE_PORT || 5073);
const proto = loadProto("attendance_regularisation");

function parseDate(d) {
    if (!d) return null;
    const t = new Date(d);
    return isNaN(t) ? null : t;
}

function localDayKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function isFutureDate(d) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    // Strictly future (tomorrow+); today is allowed
    return target > now;
}

function mapReg(r) {
    return {
        id: r.id,
        organization_id: r.organizationId,
        attendance_id: r.attendanceId,
        employee_id: r.employeeId,
        date: r.date ? localDayKey(r.date) : '',
        type: r.type,
        requested_in_time: r.requestedInTime?.toISOString() || '',
        requested_out_time: r.requestedOutTime?.toISOString() || '',
        note: r.note || '',
        status: r.status,
        approval_instance_id: r.approvalInstanceId || '',
        is_bulk_action: r.isBulkAction,
        created_by: r.createdBy,
        created_at: r.createdAt?.toISOString() || '',
    };
}

/* ============================================================
   HELPER: fetch the employee's attendance policy
============================================================ */
async function getAttendancePolicy(organizationId) {
    return prisma.attendancePolicies.findFirst({
        where: { deletedAt: null, organizationId, isActive: true },
        orderBy: { createdAt: 'desc' },
    });
}

/* ============================================================
   MAIN IMPLEMENTATION
============================================================ */
const impl = {

    /* --------------------------------------------------------
       CreateRegularisation
       Employee submits a regularisation → creates ApprovalInstance
    -------------------------------------------------------- */
    CreateRegularisation: async (call, cb) => {
        try {
            const { organization_id, employee_id, attendance_id, date, type, requested_in_time, requested_out_time, note } = call.request;

            if (!organization_id || !employee_id) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id and employee_id required' });
            }
            if (!type || !['ADJUST_LOGS', 'EXEMPT_PENALTY'].includes(type)) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'type must be ADJUST_LOGS or EXEMPT_PENALTY' });
            }
            if (!note || !note.trim()) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'note is required' });
            }

            // Validate type-specific fields
            if (type === 'ADJUST_LOGS') {
                if (!requested_in_time || !requested_out_time) {
                    return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'requested_in_time and requested_out_time are required for ADJUST_LOGS' });
                }
            }

            // Validate against attendance policy
            const policy = await getAttendancePolicy(organization_id);
            if (policy && !policy.allowRegularisation) {
                return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Regularisation is not enabled for your organisation' });
            }
            if (policy && policy.regularisationMode !== 'BOTH') {
                if (policy.regularisationMode === 'ADJUST_LOGS' && type === 'EXEMPT_PENALTY') {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Exempt penalty mode is not enabled for your organisation' });
                }
                if (policy.regularisationMode === 'EXEMPT_PENALTY' && type === 'ADJUST_LOGS') {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Adjust logs mode is not enabled for your organisation' });
                }
            }

            // Find the attendance record first so regDate can fall back to attendance.date
            let attendance = null;
            if (attendance_id) {
                attendance = await prisma.attendance.findFirst({
                    where: { deletedAt: null, id: attendance_id },
                });
            }
            let regDate = parseDate(date);
            if (!regDate && attendance) {
                regDate = new Date(attendance.date);
            }
            if (!regDate) regDate = new Date();

            // Reject future-dated regularisation (tomorrow or later)
            if (isFutureDate(regDate)) {
                return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Cannot regularise a future date' });
            }

            // Check window limit
            if (policy && policy.regularisationWindowDays) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - policy.regularisationWindowDays);
                cutoff.setHours(0, 0, 0, 0);
                const regDay = new Date(regDate);
                regDay.setHours(0, 0, 0, 0);
                if (regDay < cutoff) {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: `Cannot regularise beyond ${policy.regularisationWindowDays} days` });
                }
            }

            // Count-per-period cap (null maxRegularisationRequests = unlimited)
            // Buckets on createdAt (submission time), matching Keka "requests an employee can make in a given period"
            if (policy && policy.maxRegularisationRequests != null) {
                const period = (policy.regularisationPeriod || 'MONTHLY').toUpperCase();
                const bucket = new Date(); // submission time = now
                let periodStart;
                let periodEnd;
                if (period === 'WEEKLY') {
                    const day = bucket.getDay();
                    const diff = (day + 6) % 7; // Monday-start week
                    periodStart = new Date(bucket);
                    periodStart.setDate(bucket.getDate() - diff);
                    periodStart.setHours(0, 0, 0, 0);
                    periodEnd = new Date(periodStart);
                    periodEnd.setDate(periodStart.getDate() + 6);
                    periodEnd.setHours(23, 59, 59, 999);
                } else if (period === 'YEARLY') {
                    periodStart = new Date(bucket.getFullYear(), 0, 1);
                    periodEnd = new Date(bucket.getFullYear(), 11, 31, 23, 59, 59, 999);
                } else {
                    // MONTHLY (default) — calendar month of submission
                    periodStart = new Date(bucket.getFullYear(), bucket.getMonth(), 1);
                    periodEnd = new Date(bucket.getFullYear(), bucket.getMonth() + 1, 0, 23, 59, 59, 999);
                }
                const usedCount = await prisma.attendanceRegularisation.count({
                    where: {
                        deletedAt: null,
                        employeeId: employee_id,
                        status: { in: ['PENDING', 'APPROVED'] },
                        createdAt: { gte: periodStart, lte: periodEnd },
                    },
                });
                if (usedCount >= policy.maxRegularisationRequests) {
                    return cb({
                        code: grpc.status.FAILED_PRECONDITION,
                        message: `Regularisation limit reached: maximum ${policy.maxRegularisationRequests} request(s) per ${period.toLowerCase()} period`,
                    });
                }
            }

            if (!attendance) {
                // Find by employee + date
                const dayStart = new Date(regDate);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(regDate);
                dayEnd.setHours(23, 59, 59, 999);
                attendance = await prisma.attendance.findFirst({
                    where: { deletedAt: null,
                        employeeId: employee_id,
                        date: { gte: dayStart, lte: dayEnd },
                    },
                });
            }
            if (!attendance) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'No attendance record found for this employee on this date' });
            }

            // Check for duplicate pending request on same attendance
            const existing = await prisma.attendanceRegularisation.findFirst({
                where: {
                    attendanceId: attendance.id,
                    status: 'PENDING',
                    deletedAt: null,
                },
            });
            if (existing) {
                return cb({ code: grpc.status.ALREADY_EXISTS, message: 'A pending regularisation already exists for this date' });
            }

            // Create the regularisation record
            const reg = await prisma.attendanceRegularisation.create({
                data: { deletedAt: null,
                    organizationId: organization_id,
                    attendanceId: attendance.id,
                    employeeId: employee_id,
                    date: regDate,
                    type,
                    requestedInTime: parseDate(requested_in_time),
                    requestedOutTime: parseDate(requested_out_time),
                    note: note.trim(),
                    status: 'PENDING',
                    isBulkAction: false,
                    createdBy: employee_id,
                },
            });

            // Start approval flow via gRPC
            const approvalProto = loadProto('approval');
            const approvalAddr = process.env.APPROVAL_SERVICE_ADDR || 'localhost:50055';
            const approvalClient = new approvalProto.ApprovalInstanceService(
                approvalAddr,
                grpc.credentials.createInsecure(),
            );

            const startReq = {
                organization_id,
                entity_id: reg.id,
                entity_type: 'REGULARISATION',
                employee_id,
            };

            approvalClient.StartApproval(startReq, (err, resp) => {
                if (err) {
                    console.error('[regularisation-service] StartApproval failed:', err.message);
                    // Non-fatal: regularisation is created, approval can be retried
                } else if (resp?.approval?.id) {
                    prisma.attendanceRegularisation.update({
                        where: { id: reg.id },
                        data: { approvalInstanceId: resp.approval.id },
                    }).catch(e => console.error('[regularisation-service] Failed to link approval instance:', e.message));
                } else {
                    console.error('[regularisation-service] StartApproval returned no approval id:', JSON.stringify(resp));
                }
            });

            cb(null, { regularisation: mapReg(reg) });
        } catch (e) {
            console.error('[regularisation-service] CreateRegularisation error:', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       GetRegularisation
    -------------------------------------------------------- */
    GetRegularisation: async (call, cb) => {
        try {
            const { regularisation_id } = call.request;
            if (!regularisation_id) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'regularisation_id required' });
            }

            const reg = await prisma.attendanceRegularisation.findFirst({
                where: { deletedAt: null, id: regularisation_id },
            });
            if (!reg) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Regularisation not found' });
            }

            cb(null, { regularisation: mapReg(reg) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       ListRegularisations
    -------------------------------------------------------- */
    ListRegularisations: async (call, cb) => {
        try {
            const { employee_id, organization_id, status, date_from, date_to } = call.request;

            const where = {};
            if (employee_id) where.employeeId = employee_id;
            if (organization_id) where.organizationId = organization_id;
            if (status) where.status = status;
            if (date_from || date_to) {
                where.date = {};
                if (date_from) where.date.gte = parseDate(date_from);
                if (date_to) where.date.lte = parseDate(date_to);
            }

            const list = await prisma.attendanceRegularisation.findMany({
                where,
                orderBy: { createdAt: 'desc' },
            });

            cb(null, { regularisations: list.map(mapReg) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       BulkRegularise — admin direct action, bypasses approval
    -------------------------------------------------------- */
    BulkRegularise: async (call, cb) => {
        try {
            const { organization_id, admin_id, items, confirmation_flag } = call.request;

            if (confirmation_flag !== 'CONFIRMED') {
                return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'confirmation_flag must be CONFIRMED' });
            }
            if (!admin_id || !organization_id) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'admin_id and organization_id required' });
            }
            if (!items || items.length === 0) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'items array is required' });
            }

            const results = [];

            for (const item of items) {
                try {
                    const regDate = parseDate(item.date) || new Date();
                    const type = item.type || 'EXEMPT_PENALTY';

                    // Find attendance record
                    const dayStart = new Date(regDate);
                    dayStart.setHours(0, 0, 0, 0);
                    const dayEnd = new Date(regDate);
                    dayEnd.setHours(23, 59, 59, 999);

                    const attendance = await prisma.attendance.findFirst({
                        where: { deletedAt: null,
                            employeeId: item.employee_id,
                            date: { gte: dayStart, lte: dayEnd },
                        },
                    });
                    if (!attendance) {
                        results.push({ attendance_id: item.attendance_id || '', status: 'FAILED', message: 'Attendance not found' });
                        continue;
                    }

                    // Create regularisation (bulk, no approval)
                    const reg = await prisma.attendanceRegularisation.create({
                        data: { deletedAt: null,
                            organizationId: organization_id,
                            attendanceId: attendance.id,
                            employeeId: item.employee_id,
                            date: regDate,
                            type,
                            requestedInTime: parseDate(item.requested_in_time),
                            requestedOutTime: parseDate(item.requested_out_time),
                            note: item.note || 'Bulk admin action',
                            status: 'APPROVED',
                            isBulkAction: true,
                            createdBy: admin_id,
                        },
                    });

                    // Apply the regularisation directly to the attendance record
                    await applyRegularisationToAttendance(reg, attendance);

                    results.push({ attendance_id: attendance.id, status: 'SUCCESS', message: 'Regularised' });
                } catch (e) {
                    results.push({ attendance_id: item.attendance_id || '', status: 'FAILED', message: e.message });
                }
            }

            // Write AdminAuditLog
            const affectedEmployeeIds = items.map(i => i.employee_id);
            const affectedDates = items.map(i => i.date);
            await prisma.adminAuditLog.create({
                data: { deletedAt: null,
                    adminId: admin_id,
                    organizationId: organization_id,
                    action: 'BULK_REGULARISE',
                    entityType: 'REGULARISATION',
                    changes: {
                        employee_ids: affectedEmployeeIds,
                        dates: affectedDates,
                        count: results.filter(r => r.status === 'SUCCESS').length,
                    },
                },
            });

            cb(null, { processed: results.filter(r => r.status === 'SUCCESS').length, results });
        } catch (e) {
            console.error('[regularisation-service] BulkRegularise error:', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ============================================================
   HELPER: Apply regularisation to the actual Attendance record
   Called on approval (via Redis) or bulk action (direct).
============================================================ */
async function applyRegularisationToAttendance(reg, attendance) {
    if (reg.type === 'ADJUST_LOGS') {
        // Update check-in / check-out times and mark the day regularised
        const updateData = { status: 'REGULARISED' };
        if (reg.requestedInTime) updateData.checkIn = reg.requestedInTime;
        if (reg.requestedOutTime) updateData.checkOut = reg.requestedOutTime;

        await prisma.attendance.update({
            where: { id: attendance.id },
            data: updateData,
        });
    } else if (reg.type === 'EXEMPT_PENALTY') {
        // Mark the day as penalty-exempt without claiming physical presence
        await prisma.attendance.update({
            where: { id: attendance.id },
            data: { status: 'REGULARISED' },
        });
    }
}

/* ============================================================
   REDIS PUBSUB — subscribe to approval.instance.completed
   When a REGULARISATION approval is finalized, write back to Attendance.
============================================================ */
async function subscribeToApprovalEvents() {
    await subscribe('approval.instance.completed', async (event) => {
        try {
            if (event.entityType !== 'REGULARISATION') return;

            const reg = await prisma.attendanceRegularisation.findFirst({
                where: { deletedAt: null, id: event.entityId },
            });
            if (!reg) {
                console.warn(`[regularisation-service] Regularisation ${event.entityId} not found for approval event`);
                return;
            }

            if (event.finalStatus === 'COMPLETED') {
                // APPROVED — update the regularisation status and apply to attendance
                await prisma.attendanceRegularisation.update({
                    where: { id: reg.id },
                    data: { status: 'APPROVED' },
                });

                const attendance = await prisma.attendance.findFirst({
                    where: { deletedAt: null, id: reg.attendanceId },
                });
                if (attendance) {
                    await applyRegularisationToAttendance(reg, attendance);
                }

                console.log(`[regularisation-service] Regularisation ${reg.id} APPROVED via approval event`);
            } else if (event.finalStatus === 'REJECTED') {
                // REJECTED — update status only, no change to underlying attendance
                await prisma.attendanceRegularisation.update({
                    where: { id: reg.id },
                    data: { status: 'REJECTED' },
                });

                console.log(`[regularisation-service] Regularisation ${reg.id} REJECTED via approval event`);
            }
        } catch (err) {
            console.error('[regularisation-service] Error processing approval event:', err.message);
        }
    });

    console.log('[regularisation-service] Subscribed to approval.instance.completed');
}

/* ============================================================
   MAIN SERVER BOOTSTRAP
============================================================ */
async function main() {
    await checkDbConnection('attendance-regularisation-service');

    // Subscribe to Redis approval events
    await subscribeToApprovalEvents();

    const server = new grpc.Server();
    server.addService(proto.RegularisationService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[attendance-regularisation-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[attendance-regularisation-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[attendance-regularisation-service] Force closing:', err);
                    server.forceShutdown();
                } else {
                    console.log('[attendance-regularisation-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            process.exit(0);
        } catch (e) {
            console.error('[attendance-regularisation-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[attendance-regularisation-service] Fatal error:', err);
    process.exit(1);
});
