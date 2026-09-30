// leave-request-service/server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { subscribe } from '@jury-hrms/redis';
import dotenv from 'dotenv';
dotenv.config();

/* ---------------------------------------------
   CONFIG
--------------------------------------------- */
const PORT = process.env.LEAVE_REQUEST_SERVICE_PORT || 5080;
const leaveProto = loadProto('leave_request');

// gRPC client to approval-service (internal, no auth needed)
const APPROVAL_SERVICE_ADDR = process.env.APPROVAL_SERVICE_ADDR || 'localhost:5063';
const approvalProto = loadProto('approval');
const approvalInstanceClient = new approvalProto.ApprovalInstanceService(
    APPROVAL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);

/* ---------------------------------------------
   HELPERS
--------------------------------------------- */
function localDayKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function localDayStart(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
}
function localDayEnd(d) {
    const dt = localDayStart(d);
    dt.setDate(dt.getDate() + 1);
    return dt;
}
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

function isObjectId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

function isFutureDate(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr) > new Date();
}

function isPendingAndFuture(req) {
    return req.status === 'PENDING' && isFutureDate(req.startDate);
}

async function upsertLeaveBalance(employeeId, leaveTypeId, organizationId, year, deltaPending) {
    const existing = await prisma.leaveBalance.findFirst({
        where: { employeeId, leaveTypeId, year },
    });

    if (existing) {
        return prisma.leaveBalance.update({
            where: { id: existing.id },
            data: { pending: Math.max(0, existing.pending + deltaPending), updatedAt: new Date() },
        });
    }

    // First access: fetch the leave type's defaultAnnualAllocation
    const leaveType = await prisma.leaveTypes.findFirst({
        where: { deletedAt: null, id: leaveTypeId },
    });
    // null/undefined = unlimited (no allocation set), 0 = zero days allowed
    const allocated = leaveType?.defaultAnnualAllocation ?? null;

    return prisma.leaveBalance.create({
        data: {
            employeeId,
            leaveTypeId,
            organizationId,
            year,
            allocated,
            used: 0,
            pending: Math.max(0, deltaPending),
            carriedForward: 0,
        },
    });
}

async function ensureLeaveBalance(employeeId, leaveTypeId, organizationId, year) {
    const existing = await prisma.leaveBalance.findFirst({
        where: { employeeId, leaveTypeId, year },
    });
    if (existing) return existing;

    const leaveType = await prisma.leaveTypes.findFirst({
        where: { deletedAt: null, id: leaveTypeId },
    });
    // null/undefined = unlimited (no allocation set), 0 = zero days allowed
    const allocated = leaveType?.defaultAnnualAllocation ?? null;

    return prisma.leaveBalance.create({
        data: {
            employeeId,
            leaveTypeId,
            organizationId,
            year,
            allocated,
            used: 0,
            pending: 0,
            carriedForward: 0,
        },
    });
}

async function calculateWorkingDays(employeeId, organizationId, startDate, endDate) {
    const hs = localDayStart(startDate);
    const he = localDayEnd(endDate);
    const holidays = await prisma.holidays.findMany({
        where: { deletedAt: null, organizationId, date: { gte: hs, lt: he } },
    });
    const holidayDates = new Set(holidays.map(h => localDayKey(h.date)));

    const woAssignment = await prisma.employeeWeeklyOffAssignment.findFirst({
        where: { deletedAt: null, employeeId, effectiveFrom: { lte: endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }] },
        include: { weeklyOffPolicy: true },
    });
    const offDays = woAssignment?.weeklyOffPolicy?.offDays || [];

    let workingDays = 0;
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
        const dateStr = localDayKey(current);
        const dayName = current.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
        const isHoliday = holidayDates.has(dateStr);
        const weeklyOffDay = offDays.find(d => d.day === dayName);

        if (isHoliday) {
            // skip — holiday, not a working day
        } else if (weeklyOffDay?.type === 'FULL_DAY') {
            // skip — full weekly-off day
        } else if (weeklyOffDay?.type === 'FIRST_HALF' || weeklyOffDay?.type === 'SECOND_HALF') {
            workingDays += 0.5;
        } else {
            workingDays += 1;
        }

        current.setDate(current.getDate() + 1);
    }

    return workingDays;
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
                where: { deletedAt: null, id: employee_id },
            });
            if (!employee)
                return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            const leaveType = await prisma.leaveTypes.findFirst({
                where: { deletedAt: null, id: leave_type_id, organizationId: organization_id },
            });
            if (!leaveType)
                return cb({ code: grpc.status.NOT_FOUND, message: 'Leave type not found' });

            // Calculate total days — exclude weekly-off and holiday dates
            const s = new Date(start_date);
            const e = new Date(end_date || start_date);
            let totalDays;
            if (is_half_day) {
                totalDays = 0.5;
            } else {
                totalDays = await calculateWorkingDays(employee_id, organization_id, s, e);
                if (totalDays === 0) {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Requested dates contain no working days (all weekends/holidays).' });
                }
            }

            // Check leave balance — reject if insufficient
            // Skip check entirely if leave type has no allocation set (null = unlimited/unpaid)
            // If allocated = 0, check runs normally and rejects any request > 0 days
            const year = s.getFullYear();
            const balance = await ensureLeaveBalance(employee_id, leave_type_id, organization_id, year);
            if (balance.allocated != null) {
                const available = balance.allocated + (balance.carriedForward || 0) - balance.used - balance.pending;
                if (totalDays > available) {
                    return cb({
                        code: grpc.status.FAILED_PRECONDITION,
                        message: `Insufficient leave balance. Requested ${totalDays} day(s), but only ${available} available (${balance.allocated} allocated, ${balance.used} used, ${balance.pending} pending).`,
                    });
                }
            }

            // Insert leave request
            const req = await prisma.leaveRequests.create({
                data: { deletedAt: null,
                    employeeId: employee_id,
                    organizationId: organization_id,
                    leaveTypeId: leave_type_id,
                    startDate: s,
                    endDate: e,
                    isHalfDay: is_half_day,
                    halfDayType: half_day_type || null,
                    totalDays,
                    reason: reason || '',
                    documents: documents ? JSON.parse(documents) : null,
                    status: 'PENDING',
                    approvalLevel: 1,
                },
            });

            // Increment LeaveBalance.pending
            await upsertLeaveBalance(employee_id, leave_type_id, organization_id, year, totalDays);

            // Call approval-service via gRPC to create ApprovalInstance
            // (internal service-to-service, no admin auth needed)
            const approvalInstance = await new Promise((resolve, reject) => {
                approvalInstanceClient.StartApproval(
                    {
                        organization_id,
                        entity_id: req.id,
                        entity_type: 'LEAVE',
                        employee_id,
                    },
                    (err, resp) => (err ? reject(err) : resolve(resp))
                );
            });

            // Link approval instance to leave request
            await prisma.leaveRequests.update({
                where: { id: req.id },
                data: { approvalInstanceId: approvalInstance?.approval?.id || null },
            });

            cb(null, {
                success: true,
                message: 'Leave applied successfully',
                leave_request: toApiLeaveRequest({
                    ...req,
                    approvalInstanceId: approvalInstance?.approval?.id || null,
                }),
            });
        } catch (e) {
            console.error('[ApplyLeave Error]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       EDIT LEAVE — only PENDING + future-dated
    -------------------------------------------------------- */
    EditLeaveRequest: async (call, cb) => {
        try {
            const { request_id, employee_id, leave_type_id, start_date, end_date, is_half_day, half_day_type, reason } = call.request;

            if (!isObjectId(request_id) || !isObjectId(employee_id)) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid request_id or employee_id' });
            }

            const req = await prisma.leaveRequests.findFirst({
                where: { deletedAt: null, id: request_id },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            if (req.employeeId !== employee_id)
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Not your leave request' });

            // Server-side validation: must be PENDING + future-dated
            if (req.status !== 'PENDING') {
                return cb({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot edit leave with status ${req.status}`,
                });
            }
            if (!isFutureDate(req.startDate)) {
                return cb({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot edit past or today\'s leave',
                });
            }

            // Calculate new total days — exclude weekly-off and holiday dates
            const s = new Date(start_date);
            const e = new Date(end_date || start_date);
            let totalDays;
            if (is_half_day) {
                totalDays = 0.5;
            } else {
                totalDays = await calculateWorkingDays(employee_id, organization_id, s, e);
                if (totalDays === 0) {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Requested dates contain no working days (all weekends/holidays).' });
                }
            }

            const oldTotalDays = req.totalDays || 0;
            const dayDelta = totalDays - oldTotalDays;
            const typeChanged = leave_type_id && leave_type_id !== req.leaveTypeId;
            const newTypeId = leave_type_id || req.leaveTypeId;
            const balanceYear = s.getFullYear();

            // If type changed, check balance on the NEW type before allowing
            if (typeChanged) {
                const newTypeBalance = await ensureLeaveBalance(employee_id, newTypeId, req.organizationId, balanceYear);
                if (newTypeBalance.allocated != null) {
                    const newAvailable = newTypeBalance.allocated + (newTypeBalance.carriedForward || 0) - newTypeBalance.used - newTypeBalance.pending;
                    if (totalDays > newAvailable) {
                        return cb({
                            code: grpc.status.FAILED_PRECONDITION,
                            message: `Insufficient balance on new leave type. Requested ${totalDays} day(s), but only ${newAvailable} available.`,
                        });
                    }
                }
            }

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    leaveTypeId: leave_type_id || req.leaveTypeId,
                    startDate: s,
                    endDate: e,
                    isHalfDay: is_half_day,
                    halfDayType: half_day_type || null,
                    totalDays,
                    reason: reason || req.reason,
                    updatedAt: new Date(),
                },
            });

            // Handle leave type change: release old type's pending, add to new type's pending
            if (typeChanged) {
                // Release pending from old leave type
                if (oldTotalDays > 0) {
                    await upsertLeaveBalance(employee_id, req.leaveTypeId, req.organizationId, balanceYear, -oldTotalDays);
                }
                // Add pending to new leave type
                if (totalDays > 0) {
                    await upsertLeaveBalance(employee_id, leave_type_id, req.organizationId, balanceYear, totalDays);
                }
            } else if (dayDelta !== 0) {
                // Same type, just day count changed
                await upsertLeaveBalance(employee_id, updated.leaveTypeId, req.organizationId, balanceYear, dayDelta);
            }

            cb(null, {
                success: true,
                message: 'Leave updated successfully',
                leave_request: toApiLeaveRequest(updated),
            });
        } catch (e) {
            console.error('[EditLeaveRequest Error]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       CANCEL LEAVE
       - Must be PENDING + future-dated
       - Releases LeaveBalance.pending
    -------------------------------------------------------- */
    CancelLeave: async (call, cb) => {
        try {
            const { request_id, employee_id, reason } = call.request;

            if (!isObjectId(request_id) || !isObjectId(employee_id)) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid request_id or employee_id' });
            }

            const req = await prisma.leaveRequests.findFirst({
                where: { deletedAt: null, id: request_id },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            if (req.employeeId !== employee_id)
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Not your leave request' });

            // Server-side validation: must be PENDING + future-dated
            if (req.status !== 'PENDING') {
                return cb({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot cancel leave with status ${req.status}`,
                });
            }
            if (!isFutureDate(req.startDate)) {
                return cb({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot cancel past or today\'s leave',
                });
            }

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    status: 'CANCELLED',
                    cancellationReason: reason || '',
                    cancelledAt: new Date(),
                    cancellationBy: employee_id,
                },
            });

            // Release LeaveBalance.pending
            if (req.totalDays > 0) {
                const year = new Date(req.startDate).getFullYear();
                await upsertLeaveBalance(req.employeeId, req.leaveTypeId, req.organizationId, year, -req.totalDays);
            }

            cb(null, {
                success: true,
                message: 'Leave cancelled successfully',
                leave_request: toApiLeaveRequest(updated),
            });
        } catch (e) {
            console.error('[CancelLeave Error]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       APPROVE (legacy shortcut — superseded by §1 approval inbox)
    -------------------------------------------------------- */
    ApproveLeave: async (call, cb) => {
        try {
            const { request_id, approver_id } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { deletedAt: null, id: request_id },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: { status: 'APPROVED', approvedAt: new Date() },
            });

            // Move pending → used in LeaveBalance
            if (req.totalDays > 0) {
                const year = new Date(req.startDate).getFullYear();
                const bal = await prisma.leaveBalance.findFirst({
                    where: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year },
                });
                if (bal) {
                    await prisma.leaveBalance.update({
                        where: { id: bal.id },
                        data: {
                            pending: Math.max(0, bal.pending - req.totalDays),
                            used: bal.used + req.totalDays,
                            updatedAt: new Date(),
                        },
                    });
                }
            }

            // Recompute attendance for each day in the leave range
            try {
                const from = new Date(req.startDate);
                const to = new Date(req.endDate);
                for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                    const day = new Date(d);
                    day.setHours(0, 0, 0, 0);
                    const nextDay = new Date(day);
                    nextDay.setDate(nextDay.getDate() + 1);

                    // Find attendance record for this day
                    const att = await prisma.attendance.findFirst({
                        where: { deletedAt: null, employeeId: req.employeeId, date: { gte: day, lt: nextDay } },
                    });

                    // Check weekly-off assignment before setting status
                    const dayName = day.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
                    let finalStatus = 'LEAVE';

                    const woAssignment = await prisma.employeeWeeklyOffAssignment.findFirst({
                        where: { deletedAt: null, employeeId: req.employeeId, effectiveFrom: { lte: day }, OR: [{ effectiveTo: { gte: day } }, { effectiveTo: null }] },
                    });
                    if (woAssignment) {
                        const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id: woAssignment.weeklyOffPolicyId } });
                        if (policy?.offDays) {
                            for (const off of policy.offDays) {
                                if (off.day === dayName) {
                                    finalStatus = off.type === 'FULL_DAY' ? 'WEEKLY_OFF' : 'HALF_DAY';
                                    break;
                                }
                            }
                        }
                    }

                    // Also check holidays
                    const holiday = await prisma.holidays.findFirst({
                        where: { deletedAt: null, organizationId: req.organizationId, date: { gte: day, lt: nextDay } },
                    });
                    if (holiday) finalStatus = 'HOLIDAY';

                    if (!att) {
                        await prisma.attendance.create({
                            data: { deletedAt: null,
                                organizationId: req.organizationId,
                                employeeId: req.employeeId,
                                date: day,
                                status: finalStatus,
                            },
                        });
                    } else if (!att.checkIn && !att.checkOut && att.status !== 'REGULARISED') {
                        await prisma.attendance.update({
                            where: { id: att.id },
                            data: { status: finalStatus },
                        });
                    }
                }
                console.log(`[leave-request-service] Attendance recomputed for leave ${req.id}`);
            } catch (attErr) {
                console.error('[leave-request-service] Failed to recompute attendance:', attErr.message);
            }

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
       REJECT (legacy shortcut)
    -------------------------------------------------------- */
    RejectLeave: async (call, cb) => {
        try {
            const { request_id, approver_id, reason } = call.request;

            const req = await prisma.leaveRequests.findFirst({
                where: { deletedAt: null, id: request_id },
            });
            if (!req) return cb({ code: grpc.status.NOT_FOUND, message: 'Leave not found' });

            const updated = await prisma.leaveRequests.update({
                where: { id: request_id },
                data: {
                    status: 'REJECTED',
                    rejectedAt: new Date(),
                    rejectionReason: reason || '',
                },
            });

            // Release LeaveBalance.pending
            if (req.totalDays > 0) {
                const year = new Date(req.startDate).getFullYear();
                await upsertLeaveBalance(req.employeeId, req.leaveTypeId, req.organizationId, year, -req.totalDays);
            }

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
                where: { deletedAt: null, id },
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
                where: { deletedAt: null,
                    employeeId: employee_id,
                    organizationId: organization_id,
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
       LEAVE BALANCE — uses LeaveBalance table
    -------------------------------------------------------- */
    GetLeaveBalance: async (call, cb) => {
        try {
            const { employee_id, organization_id } = call.request;
            const year = new Date().getFullYear();

            // Fetch all leave types for the org
            const types = await prisma.leaveTypes.findMany({
                where: { deletedAt: null, organizationId: organization_id, isActive: true },
            });

            // Fetch balance records for this employee
            const balances = await prisma.leaveBalance.findMany({
                where: { employeeId: employee_id, year },
            });

            const balMap = {};
            balances.forEach((b) => { balMap[b.leaveTypeId] = b; });

            const result = types.map((t) => {
                const bal = balMap[t.id];
                // null allocated = unlimited; compute actual only if allocated is a number
                const allocated = bal && bal.allocated != null
                    ? bal.allocated + (bal.carriedForward || 0)
                    : (t.monthlyAccrualRate || 0) * 12;
                const used = bal ? bal.used : 0;
                const pending = bal ? bal.pending : 0;
                const available = (bal && bal.allocated == null) ? null : allocated - used - pending;
                return {
                    leave_type_id: t.id,
                    leave_type_name: t.name,
                    accrued: allocated,
                    used,
                    pending,
                    available,
                };
            });

            cb(null, { balances: result });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LEAVE CALENDAR — scoped to team (same department)
    -------------------------------------------------------- */
    GetLeaveCalendar: async (call, cb) => {
        try {
            const { employee_id, organization_id, month } = call.request;

            const [year, m] = month.split('-').map(Number);
            const start = new Date(year, m - 1, 1);
            const end = new Date(year, m, 0);

            // Find employee's department(s) for team scoping
            const myDeptAssignments = await prisma.employeeDepartments.findMany({
                where: { deletedAt: null, employeeId: employee_id },
                select: { departmentId: true },
            });
            const myDeptIds = myDeptAssignments.map((a) => a.departmentId);

            // Find all employees in the same departments (team members)
            let teamEmployeeIds = [employee_id]; // include self
            if (myDeptIds.length > 0) {
                const teamAssignments = await prisma.employeeDepartments.findMany({
                    where: { deletedAt: null, departmentId: { in: myDeptIds } },
                    select: { employeeId: true },
                });
                teamEmployeeIds = [...new Set(teamAssignments.map((a) => a.employeeId))];
            }

            // Fetch holidays (local month range, exclusive next-month start to cover last day)
            const holidays = await prisma.holidays.findMany({
                where: { deletedAt: null,
                    organizationId: organization_id,
                    date: { gte: start, lt: new Date(year, m, 1) },
                },
            });

            // Fetch approved leaves for team
            const leaves = await prisma.leaveRequests.findMany({
                where: { deletedAt: null,
                    employeeId: { in: teamEmployeeIds },
                    status: 'APPROVED',
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                include: { leaveType: true },
            });

            const result = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = localDayKey(d);
                const isHoliday = holidays.some((h) => localDayKey(h.date) === dateStr);
                const dayLeaves = leaves.filter(
                    (l) => new Date(l.startDate) <= d && new Date(l.endDate) >= d
                );

                if (dayLeaves.length > 0) {
                    // Multiple team members on leave — show count
                    result.push({
                        date: dateStr,
                        status: 'LEAVE',
                        leave_type_name: dayLeaves.length > 1
                            ? `${dayLeaves.length} team members`
                            : dayLeaves[0]?.leaveType?.name || 'Leave',
                    });
                } else if (isHoliday) {
                    result.push({ date: dateStr, status: 'HOLIDAY', leave_type_name: '' });
                } else {
                    result.push({ date: dateStr, status: 'NONE', leave_type_name: '' });
                }
            }

            cb(null, { calendar: result });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ============================================================
   REDIS PUBSUB — subscribe to approval.instance.completed
   When a LEAVE approval is finalized, update leave status + balance
============================================================ */
async function subscribeToApprovalEvents() {
    await subscribe('approval.instance.completed', async (event) => {
        try {
            if (event.entityType !== 'LEAVE') return;

            const leaveReq = await prisma.leaveRequests.findFirst({
                where: { deletedAt: null, id: event.entityId },
            });
            if (!leaveReq) {
                console.warn(`[leave-request-service] Leave request ${event.entityId} not found for approval event`);
                return;
            }

            const year = new Date(leaveReq.startDate).getFullYear();

            if (event.finalStatus === 'COMPLETED') {
                // APPROVED — move pending → used
                await prisma.leaveRequests.update({
                    where: { id: leaveReq.id },
                    data: { status: 'APPROVED', approvedAt: new Date() },
                });

                if (leaveReq.totalDays > 0) {
                    const bal = await prisma.leaveBalance.findFirst({
                        where: {
                            employeeId: leaveReq.employeeId,
                            leaveTypeId: leaveReq.leaveTypeId,
                            year,
                        },
                    });
                    if (bal) {
                        await prisma.leaveBalance.update({
                            where: { id: bal.id },
                            data: {
                                pending: Math.max(0, bal.pending - leaveReq.totalDays),
                                used: bal.used + leaveReq.totalDays,
                                updatedAt: new Date(),
                            },
                        });
                    }
                }

                console.log(`[leave-request-service] Leave ${leaveReq.id} APPROVED via approval event`);

                // Recompute attendance for each day in the leave range
                try {
                    const from = new Date(leaveReq.startDate);
                    const to = new Date(leaveReq.endDate);
                    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                        const day = new Date(d);
                        day.setHours(0, 0, 0, 0);
                        const nextDay = new Date(day);
                        nextDay.setDate(nextDay.getDate() + 1);

                        const att = await prisma.attendance.findFirst({
                            where: { deletedAt: null, employeeId: leaveReq.employeeId, date: { gte: day, lt: nextDay } },
                        });

                        // Check weekly-off and holiday priority before setting status
                        const dayName = day.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
                        let finalStatus = 'LEAVE';

                        const woAssignment = await prisma.employeeWeeklyOffAssignment.findFirst({
                            where: { deletedAt: null, employeeId: leaveReq.employeeId, effectiveFrom: { lte: day }, OR: [{ effectiveTo: { gte: day } }, { effectiveTo: null }] },
                        });
                        if (woAssignment) {
                            const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id: woAssignment.weeklyOffPolicyId } });
                            if (policy?.offDays) {
                                for (const off of policy.offDays) {
                                    if (off.day === dayName) {
                                        finalStatus = off.type === 'FULL_DAY' ? 'WEEKLY_OFF' : 'HALF_DAY';
                                        break;
                                    }
                                }
                            }
                        }

                        const holiday = await prisma.holidays.findFirst({
                            where: { deletedAt: null, organizationId: leaveReq.organizationId, date: { gte: day, lt: nextDay } },
                        });
                        if (holiday) finalStatus = 'HOLIDAY';

                        if (!att) {
                            await prisma.attendance.create({
                                data: { deletedAt: null,
                                    organizationId: leaveReq.organizationId,
                                    employeeId: leaveReq.employeeId,
                                    date: day,
                                    status: finalStatus,
                                },
                            });
                        } else if (!att.checkIn && !att.checkOut && att.status !== 'REGULARISED') {
                            await prisma.attendance.update({
                                where: { id: att.id },
                                data: { status: finalStatus },
                            });
                        }
                    }
                    console.log(`[leave-request-service] Attendance recomputed for leave ${leaveReq.id}`);
                } catch (attErr) {
                    console.error('[leave-request-service] Failed to recompute attendance:', attErr.message);
                }
            } else if (event.finalStatus === 'REJECTED') {
                // REJECTED — release pending
                await prisma.leaveRequests.update({
                    where: { id: leaveReq.id },
                    data: { status: 'REJECTED', rejectedAt: new Date() },
                });

                if (leaveReq.totalDays > 0) {
                    await upsertLeaveBalance(
                        leaveReq.employeeId,
                        leaveReq.leaveTypeId,
                        leaveReq.organizationId,
                        year,
                        -leaveReq.totalDays
                    );
                }

                console.log(`[leave-request-service] Leave ${leaveReq.id} REJECTED via approval event`);
            }
        } catch (err) {
            console.error('[leave-request-service] Error processing approval event:', err.message);
        }
    });

    console.log('[leave-request-service] Subscribed to approval.instance.completed');
}

/* ============================================================
   MAIN SERVER BOOTSTRAP
============================================================ */
async function main() {
    await checkDbConnection('leave-request-service');

    // Subscribe to Redis approval events
    await subscribeToApprovalEvents();

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
