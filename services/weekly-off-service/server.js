import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.WEEKLY_OFF_SERVICE_PORT || 5075);
const weeklyOffProto = loadProto('weekly_off');

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const FREQUENCIES = ['ALL', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'LAST'];
const DAY_TYPES = ['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF'];

const OCCURRENCE_TO_FREQUENCY = {
    ALL: 'ALL', '1': 'FIRST', '2': 'SECOND', '3': 'THIRD', '4': 'FOURTH', '5': 'FIFTH', LAST: 'LAST',
};
const FREQUENCY_TO_OCCURRENCE = {
    ALL: 'ALL', FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', LAST: 'LAST',
};
const OCCURRENCE_TO_NUMBER = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

function isValidDay(d) { return DAYS.includes(d); }
function isValidFrequency(f) { return FREQUENCIES.includes(f); }
function isValidDayType(t) { return DAY_TYPES.includes(t); }

/**
 * Normalize any offDays JSON shape into canonical week_offs:
 * [{ day_of_week, day_offs: [{frequency, day_type}] }]
 * Legacy [{day, type}] → frequency ALL.
 * Also returns legacy-compatible entries (day/type) for older consumers.
 */
function normalizeWeekOffs(offDays) {
    if (!Array.isArray(offDays)) return [];
    const out = [];
    for (const item of offDays) {
        if (!item || typeof item !== 'object') continue;
        if (item.day_of_week && Array.isArray(item.day_offs)) {
            const dayOffs = item.day_offs
                .filter(o => o && isValidFrequency(o.frequency) && isValidDayType(o.day_type))
                .map(o => ({ frequency: o.frequency, day_type: o.day_type }));
            if (dayOffs.length === 0) continue;
            out.push({
                day: item.day_of_week,
                type: dayOffs[0].day_type,
                day_of_week: item.day_of_week,
                day_offs: dayOffs,
            });
        } else if (item.day && item.type) {
            // Legacy: { day, type } → ALL frequency
            const type = isValidDayType(item.type) ? item.type : 'FULL_DAY';
            out.push({
                day: item.day,
                type,
                day_of_week: item.day,
                day_offs: [{ frequency: 'ALL', day_type: type }],
            });
        }
    }
    return out;
}

/** Validate week_offs array; returns error string or null. */
function validateWeekOffs(weekOffs) {
    if (!Array.isArray(weekOffs) || weekOffs.length === 0) {
        return 'At least one week_offs entry required';
    }
    const seenDays = new Set();
    for (const dayCfg of weekOffs) {
        if (!dayCfg || !isValidDay(dayCfg.day_of_week)) {
            return `Invalid day_of_week: ${dayCfg?.day_of_week}`;
        }
        if (seenDays.has(dayCfg.day_of_week)) {
            return `Duplicate day_of_week: ${dayCfg.day_of_week}`;
        }
        seenDays.add(dayCfg.day_of_week);
        const dayOffs = dayCfg.day_offs;
        if (!Array.isArray(dayOffs) || dayOffs.length === 0) {
            return `day_offs required for ${dayCfg.day_of_week}`;
        }
        const freqs = new Set();
        let hasAll = false;
        for (const off of dayOffs) {
            if (!off || !isValidFrequency(off.frequency)) {
                return `Invalid frequency for ${dayCfg.day_of_week}: ${off?.frequency}`;
            }
            if (!isValidDayType(off.day_type)) {
                return `Invalid day_type for ${dayCfg.day_of_week}: ${off?.day_type}`;
            }
            if (freqs.has(off.frequency)) {
                return `Duplicate frequency ${off.frequency} for ${dayCfg.day_of_week}`;
            }
            freqs.add(off.frequency);
            if (off.frequency === 'ALL') hasAll = true;
        }
        if (hasAll && freqs.size > 1) {
            return `ALL cannot be combined with other frequencies for ${dayCfg.day_of_week}`;
        }
    }
    return null;
}

/** Store dual-compat JSON for Prisma offDays Json field. */
function toStoredOffDays(weekOffs) {
    return weekOffs.map(dayCfg => {
        const firstType = dayCfg.day_offs[0]?.day_type || 'FULL_DAY';
        return {
            day: dayCfg.day_of_week,          // legacy consumer field
            type: firstType,                  // legacy consumer field
            day_of_week: dayCfg.day_of_week,
            day_offs: dayCfg.day_offs.map(o => ({ frequency: o.frequency, day_type: o.day_type })),
        };
    });
}

/** Convert stored JSON → API week_offs (clean shape without legacy day/type). */
function toApiWeekOffs(stored) {
    return normalizeWeekOffs(stored).map(e => ({
        day_of_week: e.day_of_week,
        day_offs: e.day_offs.map(o => ({ frequency: o.frequency, day_type: o.day_type })),
    }));
}

/** Occurrence index (1-5) of a weekday within its month, or 'LAST'. */
function occurrenceOfWeekday(date) {
    const day = date.getDate();
    const dow = date.getDay();
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 0, 0).getDate();
    // next same weekday in next month?
    const nextSame = day + 7;
    if (nextSame > daysInMonth) return 'LAST';
    const n = Math.ceil(day / 7);
    if (n >= 1 && n <= 5) return n;
    return 'LAST';
}

function frequencyMatches(frequency, date) {
    if (frequency === 'ALL') return true;
    const occ = occurrenceOfWeekday(date);
    if (frequency === 'LAST') return occ === 'LAST';
    const n = OCCURRENCE_TO_NUMBER[String(occ)];
    if (n == null) return false;
    return String(n) === String(OCCURRENCE_TO_NUMBER[frequency] ?? frequency) ||
        frequency === { 1: 'FIRST', 2: 'SECOND', 3: 'THIRD', 4: 'FOURTH', 5: 'FIFTH' }[n];
}

function matchDayOffForDate(dayOffs, date) {
    for (const off of dayOffs) {
        if (frequencyMatches(off.frequency, date)) return off;
    }
    return null;
}

function mapPolicy(p, employeeCount = 0) {
    const weekOffs = toApiWeekOffs(p.offDays);
    return {
        id: p.id,
        organization_id: p.organizationId,
        name: p.name,
        code: p.code,
        description: p.description || '',
        effective_from: p.effectiveFrom ? p.effectiveFrom.toISOString().slice(0, 10) : '',
        week_offs: weekOffs,
        created_at: p.createdAt?.toISOString() || '',
        updated_at: p.updatedAt?.toISOString() || '',
        employee_count: employeeCount,
    };
}

function mapAssignment(a) {
    return {
        id: a.id,
        employee_id: a.employeeId,
        weekly_off_policy_id: a.weeklyOffPolicyId,
        effective_from: a.effectiveFrom ? a.effectiveFrom.toISOString().slice(0, 10) : '',
        effective_to: a.effectiveTo ? a.effectiveTo.toISOString().slice(0, 10) : '',
        created_at: a.createdAt?.toISOString() || '',
        policy_name: a.weeklyOffPolicy?.name || '',
        employee_name: a.employee?.fullName || '',
        employee_code: a.employee?.employeeCode || '',
        week_offs: a.weeklyOffPolicy ? toApiWeekOffs(a.weeklyOffPolicy.offDays) : [],
    };
}

/** Current assignment window filter (deletedAt null + effectiveFrom/to covers now). */
function currentAssignmentWhere(now) {
    // effective_to is stored as a UTC-midnight date; the END bound compares against
    // the start of the same calendar day so the final inclusive day still counts.
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return {
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dayStart } }],
    };
}

/**
 * Unique current employees per policy (one query, no N+1).
 * If an employee somehow has multiple current rows, keep only the latest effectiveFrom.
 */
async function countEmployeesByPolicyIds(policyIds) {
    const counts = Object.create(null);
    if (!policyIds.length) return counts;
    for (const id of policyIds) counts[id] = 0;
    const now = new Date();
    const rows = await prisma.employeeWeeklyOffAssignment.findMany({
        where: {
            ...currentAssignmentWhere(now),
            weeklyOffPolicyId: { in: policyIds },
        },
        select: { weeklyOffPolicyId: true, employeeId: true, effectiveFrom: true },
    });
    const latestByEmployee = new Map();
    for (const row of rows) {
        const prev = latestByEmployee.get(row.employeeId);
        if (!prev || row.effectiveFrom > prev.effectiveFrom) {
            latestByEmployee.set(row.employeeId, row);
        }
    }
    for (const row of latestByEmployee.values()) {
        if (counts[row.weeklyOffPolicyId] !== undefined) counts[row.weeklyOffPolicyId]++;
    }
    return counts;
}

async function clearAttendanceAdjustments(employeeId, from, to) {
    const rangeStart = from;
    const rangeEnd = to || new Date('9999-12-31T23:59:59.999Z');
    const resetResult = await prisma.attendance.updateMany({
        where: { employeeId, date: { gte: rangeStart, lte: rangeEnd }, status: 'REGULARISED' },
        data: { status: 'PENDING', checkIn: null, checkOut: null },
    });
    const deleteResult = await prisma.attendanceRegularisation.updateMany({
        where: { employeeId, date: { gte: rangeStart, lte: rangeEnd }, status: 'APPROVED' },
        data: { deletedAt: new Date() },
    });
    if (resetResult.count > 0 || deleteResult.count > 0) {
        console.log(`[clearAttendanceAdjustments] employee=${employeeId}, reset=${resetResult.count}, deleted_regs=${deleteResult.count}`);
    }
}

const impl = {
    // ==================== POLICY CRUD ====================

    CreateWeeklyOffPolicy: async (call, cb) => {
        try {
            const { organization_id, name, code, description, effective_from, week_offs } = call.request;
            if (!organization_id || !name) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id and name required' });
            }
            const validationError = validateWeekOffs(week_offs);
            if (validationError) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: validationError });
            }

            const effectiveFrom = parseDate(effective_from) || new Date();
            let finalCode = (code || '').trim();
            const codeProvided = !!finalCode;
            if (!finalCode) {
                const base = (name || 'WO')
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '')
                    .slice(0, 12) || 'WO';
                finalCode = base;
                let suffix = 1;
                // ensure unique code within org
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const clash = await prisma.weeklyOffPolicy.findFirst({
                        where: { deletedAt: null, organizationId: organization_id, code: finalCode },
                    });
                    if (!clash) break;
                    finalCode = `${base}_${suffix++}`;
                    if (suffix > 100) {
                        finalCode = `${base}_${Date.now().toString(36).toUpperCase().slice(-6)}`;
                        break;
                    }
                }
            } else {
                const existing = await prisma.weeklyOffPolicy.findFirst({
                    where: { deletedAt: null, organizationId: organization_id, code: finalCode },
                });
                if (existing) {
                    return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Weekly Off Policy with this code already exists' });
                }
            }
            void codeProvided;

            const policy = await prisma.weeklyOffPolicy.create({
                data: {
                    deletedAt: null,
                    organizationId: organization_id,
                    name,
                    code: finalCode,
                    description: description || null,
                    effectiveFrom,
                    offDays: toStoredOffDays(week_offs),
                },
            });

            cb(null, { policy: mapPolicy(policy) });
        } catch (e) {
            console.error('[CreateWeeklyOffPolicy]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetWeeklyOffPolicy: async (call, cb) => {
        try {
            const { id, organization_id } = call.request;
            const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id } });
            if (!policy || policy.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            if (organization_id && policy.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            cb(null, { policy: mapPolicy(policy) });
        } catch (e) {
            console.error('[GetWeeklyOffPolicy]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListWeeklyOffPolicies: async (call, cb) => {
        try {
            const { organization_id } = call.request;
            const policies = await prisma.weeklyOffPolicy.findMany({
                where: { deletedAt: null, organizationId: organization_id },
                orderBy: { createdAt: 'desc' },
            });
            const counts = await countEmployeesByPolicyIds(policies.map(p => p.id));
            cb(null, { policies: policies.map(p => mapPolicy(p, counts[p.id] || 0)) });
        } catch (e) {
            console.error('[ListWeeklyOffPolicies]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateWeeklyOffPolicy: async (call, cb) => {
        try {
            const { id, organization_id, name, code, description, effective_from, week_offs } = call.request;
            const existing = await prisma.weeklyOffPolicy.findUnique({ where: { id } });
            if (!existing || existing.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            if (organization_id && existing.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }

            if (week_offs && week_offs.length > 0) {
                const validationError = validateWeekOffs(week_offs);
                if (validationError) {
                    return cb({ code: grpc.status.INVALID_ARGUMENT, message: validationError });
                }
            }

            if (code && code.trim() && code.trim() !== existing.code) {
                const dupe = await prisma.weeklyOffPolicy.findFirst({
                    where: { deletedAt: null, organizationId: existing.organizationId, code: code.trim(), NOT: { id } },
                });
                if (dupe) {
                    return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Weekly Off Policy with this code already exists' });
                }
            }

            const patch = { updatedAt: new Date() };
            if (name) patch.name = name;
            if (code && code.trim()) patch.code = code.trim();
            // Full-form updates include week_offs + description together — always apply description then.
            if (week_offs && week_offs.length > 0) {
                patch.offDays = toStoredOffDays(week_offs);
                patch.description = description || null;
            } else if (description) {
                patch.description = description;
            }
            if (effective_from) {
                const d = parseDate(effective_from);
                if (d) patch.effectiveFrom = d;
            }

            const policy = await prisma.weeklyOffPolicy.update({
                where: { id },
                data: patch,
            });

            cb(null, { policy: mapPolicy(policy) });
        } catch (e) {
            console.error('[UpdateWeeklyOffPolicy]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteWeeklyOffPolicy: async (call, cb) => {
        try {
            const { id, organization_id } = call.request;
            const existing = await prisma.weeklyOffPolicy.findUnique({ where: { id } });
            if (!existing || existing.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            if (organization_id && existing.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            await prisma.weeklyOffPolicy.update({
                where: { id },
                data: { deletedAt: new Date() },
            });
            cb(null, { success: true, message: 'Deleted' });
        } catch (e) {
            console.error('[DeleteWeeklyOffPolicy]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    // ==================== ASSIGNMENT CRUD ====================

    AssignWeeklyOff: async (call, cb) => {
        try {
            const { organization_id, employee_id, weekly_off_policy_id, effective_from, effective_to } = call.request;
            if (!organization_id || !employee_id || !weekly_off_policy_id || !effective_from) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id, employee_id, weekly_off_policy_id, and effective_from required' });
            }

            const fromDate = parseDate(effective_from);
            const toDate = parseDate(effective_to);
            if (!fromDate) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid effective_from date' });
            }

            const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id: weekly_off_policy_id } });
            if (!policy || policy.deletedAt || policy.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Weekly Off Policy not found' });
            }

            const employee = await prisma.organizationEmployees.findUnique({ where: { id: employee_id } });
            if (!employee || employee.deletedAt || employee.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }

            const overlap = await prisma.employeeWeeklyOffAssignment.findFirst({
                where: { deletedAt: null,
                    employeeId: employee_id,
                    effectiveFrom: { lte: toDate || new Date('2099-12-31') },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromDate } }],
                },
            });
            if (overlap) {
                const samePolicy = overlap.weeklyOffPolicyId === weekly_off_policy_id
                    && overlap.effectiveFrom?.toISOString().slice(0, 10) === fromDate.toISOString().slice(0, 10)
                    && (toDate ? (overlap.effectiveTo?.toISOString().slice(0, 10) === toDate.toISOString().slice(0, 10)) : !overlap.effectiveTo);
                if (samePolicy) {
                    return cb(null, { assignment: mapAssignment({
                        ...overlap,
                        weeklyOffPolicy: policy,
                        employee,
                    }) });
                }
                return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Overlapping assignment exists for this employee' });
            }

            const assignment = await prisma.employeeWeeklyOffAssignment.create({
                data: { deletedAt: null,
                    employeeId: employee_id,
                    weeklyOffPolicyId: weekly_off_policy_id,
                    effectiveFrom: fromDate,
                    effectiveTo: toDate,
                },
                include: { weeklyOffPolicy: true, employee: true },
            });

            await clearAttendanceAdjustments(employee_id, fromDate, toDate);
            cb(null, { assignment: mapAssignment(assignment) });
        } catch (e) {
            console.error('[AssignWeeklyOff]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetWeeklyOffAssignment: async (call, cb) => {
        try {
            const { id } = call.request;
            const assignment = await prisma.employeeWeeklyOffAssignment.findUnique({
                where: { id },
                include: { weeklyOffPolicy: true, employee: true },
            });
            if (!assignment || assignment.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            }
            cb(null, { assignment: mapAssignment(assignment) });
        } catch (e) {
            console.error('[GetWeeklyOffAssignment]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListWeeklyOffAssignments: async (call, cb) => {
        try {
            const { employee_id, organization_id, active_only, weekly_off_policy_id } = call.request;
            const where = { deletedAt: null };
            if (employee_id) where.employeeId = employee_id;
            if (organization_id) {
                where.employee = { organizationId: organization_id, deletedAt: null };
            }
            if (weekly_off_policy_id) {
                // Guard: Prisma findUnique throws INTERNAL on malformed ObjectIDs.
                if (!/^[0-9a-fA-F]{24}$/.test(weekly_off_policy_id)) {
                    return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid weekly_off_policy_id' });
                }
                const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id: weekly_off_policy_id } });
                if (!policy || policy.deletedAt) {
                    return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
                }
                if (organization_id && policy.organizationId !== organization_id) {
                    return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
                }
                where.weeklyOffPolicyId = weekly_off_policy_id;
            }
            if (active_only) {
                Object.assign(where, currentAssignmentWhere(new Date()));
            }

            let assignments = await prisma.employeeWeeklyOffAssignment.findMany({
                where,
                include: {
                    weeklyOffPolicy: true,
                    employee: { select: { fullName: true, employeeCode: true } },
                },
                orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
            });

            // Current-assignment semantics: one row per employee (latest effectiveFrom wins).
            if (active_only) {
                const latest = new Map();
                for (const a of assignments) {
                    const prev = latest.get(a.employeeId);
                    if (!prev || a.effectiveFrom > prev.effectiveFrom) latest.set(a.employeeId, a);
                }
                assignments = [...latest.values()];
            }

            cb(null, { assignments: assignments.map(mapAssignment) });
        } catch (e) {
            console.error('[ListWeeklyOffAssignments]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateWeeklyOffAssignment: async (call, cb) => {
        try {
            const { id, weekly_off_policy_id, effective_from, effective_to } = call.request;
            const existing = await prisma.employeeWeeklyOffAssignment.findUnique({ where: { id } });
            if (!existing || existing.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            }

            const fromDate = effective_from ? parseDate(effective_from) : undefined;
            const toDate = parseDate(effective_to);

            const assignment = await prisma.employeeWeeklyOffAssignment.update({
                where: { id },
                data: {
                    ...(weekly_off_policy_id && { weeklyOffPolicyId: weekly_off_policy_id }),
                    ...(fromDate && { effectiveFrom: fromDate }),
                    ...(effective_to !== undefined && { effectiveTo: toDate }),
                    updatedAt: new Date(),
                },
                include: { weeklyOffPolicy: true, employee: true },
            });

            await clearAttendanceAdjustments(assignment.employeeId, assignment.effectiveFrom, assignment.effectiveTo);
            cb(null, { assignment: mapAssignment(assignment) });
        } catch (e) {
            console.error('[UpdateWeeklyOffAssignment]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteWeeklyOffAssignment: async (call, cb) => {
        try {
            const { id } = call.request;
            const existing = await prisma.employeeWeeklyOffAssignment.findUnique({ where: { id } });
            if (!existing || existing.deletedAt) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            }
            await prisma.employeeWeeklyOffAssignment.update({
                where: { id },
                data: { deletedAt: new Date() },
            });
            cb(null, { success: true, message: 'Deleted' });
        } catch (e) {
            console.error('[DeleteWeeklyOffAssignment]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    BulkAssignWeeklyOff: async (call, cb) => {
        try {
            const { organization_id, weekly_off_policy_id, employee_ids, effective_from, effective_to } = call.request;
            if (!organization_id || !weekly_off_policy_id || !employee_ids?.length || !effective_from) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id, weekly_off_policy_id, employee_ids, and effective_from required' });
            }

            const fromDate = parseDate(effective_from);
            const toDate = parseDate(effective_to);
            if (!fromDate) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid effective_from date' });
            }

            const policy = await prisma.weeklyOffPolicy.findUnique({ where: { id: weekly_off_policy_id } });
            if (!policy || policy.deletedAt || policy.organizationId !== organization_id) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }

            const results = [];
            for (const empId of employee_ids) {
                try {
                    const employee = await prisma.organizationEmployees.findUnique({ where: { id: empId } });
                    if (!employee || employee.deletedAt || employee.organizationId !== organization_id) {
                        results.push({ employee_id: empId, status: 'FAILED', message: 'Employee not found' });
                        continue;
                    }
                    const overlap = await prisma.employeeWeeklyOffAssignment.findFirst({
                        where: { deletedAt: null,
                            employeeId: empId,
                            effectiveFrom: { lte: toDate || new Date('2099-12-31') },
                            OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromDate } }],
                        },
                    });
                    if (overlap) {
                        results.push({ employee_id: empId, status: 'SKIPPED', message: 'Overlapping assignment exists' });
                        continue;
                    }

                    await prisma.employeeWeeklyOffAssignment.create({
                        data: { deletedAt: null,
                            employeeId: empId,
                            weeklyOffPolicyId: weekly_off_policy_id,
                            effectiveFrom: fromDate,
                            effectiveTo: toDate,
                        },
                    });
                    results.push({ employee_id: empId, status: 'SUCCESS', message: 'Assigned' });
                } catch (e) {
                    results.push({ employee_id: empId, status: 'FAILED', message: e.message });
                }
            }

            cb(null, { processed: results.filter(r => r.status === 'SUCCESS').length, results });
        } catch (e) {
            console.error('[BulkAssignWeeklyOff]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetActiveWeeklyOffForEmployee: async (call, cb) => {
        try {
            const { employee_id, date } = call.request;
            if (!employee_id) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'employee_id required' });
            }

            const checkDate = parseDate(date) || new Date();
            const dayOfWeek = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();

            const assignment = await prisma.employeeWeeklyOffAssignment.findFirst({
                where: { deletedAt: null,
                    employeeId: employee_id,
                    effectiveFrom: { lte: checkDate },
                    OR: [{ effectiveTo: null }, {
                        effectiveTo: {
                            gte: new Date(Date.UTC(checkDate.getUTCFullYear(), checkDate.getUTCMonth(), checkDate.getUTCDate())),
                        },
                    }],
                },
                orderBy: { effectiveFrom: 'desc' },
                include: { weeklyOffPolicy: true },
            });

            if (!assignment) {
                return cb(null, { assignment: null, is_weekly_off: false, day_type: 'NONE' });
            }

            const weekOffs = normalizeWeekOffs(assignment.weeklyOffPolicy?.offDays);
            const dayEntry = weekOffs.find(d => d.day_of_week === dayOfWeek);

            if (dayEntry) {
                const matched = matchDayOffForDate(dayEntry.day_offs, checkDate);
                if (matched) {
                    cb(null, {
                        assignment: mapAssignment(assignment),
                        is_weekly_off: true,
                        day_type: matched.day_type || 'FULL_DAY',
                    });
                } else {
                    cb(null, { assignment: mapAssignment(assignment), is_weekly_off: false, day_type: 'NONE' });
                }
            } else {
                cb(null, { assignment: mapAssignment(assignment), is_weekly_off: false, day_type: 'NONE' });
            }
        } catch (e) {
            console.error('[GetActiveWeeklyOffForEmployee]', e);
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    const server = new grpc.Server();
    server.addService(weeklyOffProto.WeeklyOffPolicyService.service, impl);
    server.addService(weeklyOffProto.WeeklyOffAssignmentService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });

    console.log(`[weekly-off-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[weekly-off-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown((err) => {
                if (err) server.forceShutdown();
                console.log('[weekly-off-service] gRPC server stopped.');
            });
            await prisma.$disconnect();
            process.exit(0);
        } catch (e) {
            console.error('[weekly-off-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[weekly-off-service] Fatal:', err);
    process.exit(1);
});
