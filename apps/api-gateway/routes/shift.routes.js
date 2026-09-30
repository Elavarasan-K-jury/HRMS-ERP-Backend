import { z, ZodError } from 'zod';
import { shiftClient } from '../grpc/shift.client.js';
import { prisma } from '@jury-hrms/db/client.js';

function resolveOrganizationId(c, fromQuery = '') {
    if (fromQuery) return fromQuery;
    const fromCtx = c.get('organizationId');
    if (fromCtx) return fromCtx;
    return c.req.header('x-org-id') || c.req.header('organizationId') || c.req.header('organization_id') || '';
}

/**
 * Authoritative Effective Hours calculation.
 * effective_hours = gross_hours - (break_minutes / 60)
 * Never uses start/end times or the Flexible 00:00–23:59 placeholder.
 * Returns null when gross hours are not configured.
 */
export function calculateEffectiveHours(grossHours, breakMinutes) {
    const gross = Number(grossHours);
    if (!Number.isFinite(gross) || gross <= 0) return null;
    const breakMin = Number(breakMinutes);
    const bm = Number.isFinite(breakMin) && breakMin > 0 ? breakMin : 0;
    // Round to 2 decimals to avoid float noise (e.g. 7.499999999)
    return Math.round((gross - bm / 60) * 100) / 100;
}

function withEffectiveHours(shift) {
    if (!shift || typeof shift !== 'object') return shift;
    return {
        ...shift,
        effective_hours: calculateEffectiveHours(shift.gross_hours, shift.break_minutes),
    };
}

function locationLabelFromEmployee(emp) {
    const loc = emp?.location;
    if (!loc) return '';
    const base =
        loc.name ||
        loc.formattedAddress ||
        [loc.city, loc.state, loc.country].filter(Boolean).join(', ') ||
        '';
    if (loc.entityType === 'branch') {
        const branchName = emp?.branch?.name;
        return branchName ? `${branchName} — ${base}` : base;
    }
    if (loc.entityType === 'organization') {
        return `Organization${loc.isHeadquarters ? ' (HQ)' : ''} — ${base}`;
    }
    return base;
}

const businessDateRegex = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD business date → UTC-midnight Date (rejects 2026-02-30). */
function parseBusinessDate(value) {
    if (typeof value !== 'string' || !businessDateRegex.test(value)) return null;
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10) === value ? d : null;
}

function todayBusinessDate() {
    return parseBusinessDate(new Date().toISOString().slice(0, 10));
}

/**
 * Optional assignment_from / assignment_to query → inclusive business-date range.
 * No params → both default to today (current-assignment semantics).
 * One side missing → open bound on that side.
 * Returns { error } so handlers never query an invalid range.
 */
function resolveAssignmentRange(query) {
    const rawFrom = String(query.assignment_from || '').trim();
    const rawTo = String(query.assignment_to || '').trim();
    if (rawFrom && !parseBusinessDate(rawFrom)) {
        return { error: 'assignment_from must be a valid YYYY-MM-DD business date' };
    }
    if (rawTo && !parseBusinessDate(rawTo)) {
        return { error: 'assignment_to must be a valid YYYY-MM-DD business date' };
    }
    if (rawFrom && rawTo && rawFrom > rawTo) {
        return { error: 'From date cannot be later than To date.' };
    }
    if (!rawFrom && !rawTo) {
        const today = todayBusinessDate();
        return { from: today, to: today };
    }
    return {
        from: rawFrom ? parseBusinessDate(rawFrom) : null,
        to: rawTo ? parseBusinessDate(rawTo) : null,
    };
}

/**
 * Overlap rule (both bounds inclusive, date-only):
 *   validFrom <= T AND (validTo IS NULL OR validTo >= F)
 * Absent bound = open (no predicate on that side).
 */
function assignmentOverlapWhere(range) {
    const { from, to } = range;
    if (from && to) {
        return { validFrom: { lte: to }, OR: [{ validTo: null }, { validTo: { gte: from } }] };
    }
    if (from) return { OR: [{ validTo: null }, { validTo: { gte: from } }] };
    if (to) return { validFrom: { lte: to } };
    return {};
}

/**
 * Unique-employee count per shift for a date range (one query, no N+1).
 * EmployeeShiftAssignment is the source of truth; soft-deleted assignments
 * and employees outside the organization are excluded. An employee with
 * multiple matching rows for one shift is counted exactly once.
 */
async function employeeCountsForShifts(shiftIds, organizationId, range) {
    const counts = Object.create(null);
    if (!shiftIds.length) return counts;
    for (const id of shiftIds) counts[id] = 0;
    const rows = await prisma.employeeShiftAssignment.findMany({
        where: {
            shiftId: { in: shiftIds },
            deletedAt: null,
            ...assignmentOverlapWhere(range),
            employee: { organizationId, deletedAt: null },
        },
        select: { shiftId: true, employeeId: true },
    });
    const uniqueByShift = new Map();
    for (const row of rows) {
        let set = uniqueByShift.get(row.shiftId);
        if (!set) {
            set = new Set();
            uniqueByShift.set(row.shiftId, set);
        }
        set.add(row.employeeId);
    }
    for (const [shiftId, set] of uniqueByShift) counts[shiftId] = set.size;
    return counts;
}

export default function registerShiftRoutes({ openapi }) {
    //
    // ------------------------------
    // 📌 Create Shift Schema
    // ------------------------------
    //
    // NOTE:
    // - start_time / end_time are canonical 24-hour HH:mm strings
    //   e.g. "09:30", "18:30". end < start means overnight (crosses midnight).
    //
    const dayFlagsSchema = z.object({
        monday: z.boolean().optional(),
        tuesday: z.boolean().optional(),
        wednesday: z.boolean().optional(),
        thursday: z.boolean().optional(),
        friday: z.boolean().optional(),
        saturday: z.boolean().optional(),
        sunday: z.boolean().optional(),
    });

    const weeklyOffEnum = z.enum([
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
    ]);

    const objectIdRegex = /^[0-9a-fA-F]{24}$/;

    // Canonical time-of-day: 24-hour HH:mm (no timezone, no date component)
    const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

    const createShiftSchema = z
        .object({
            organization_id: z
                .string({ required_error: 'Organization ID is required' })
                .regex(objectIdRegex, 'Invalid organization_id'),

            name: z
                .string({ required_error: 'Shift name is required' })
                .min(2, 'Name must have at least 2 characters'),

            start_time: z
                .string({ required_error: 'Start time is required' })
                .regex(hhmmRegex, 'Invalid time format (expected HH:mm, e.g. 09:30)'),

            end_time: z
                .string({ required_error: 'End time is required' })
                .regex(hhmmRegex, 'Invalid time format (expected HH:mm, e.g. 18:30)'),

            break_minutes: z
                .number()
                .int()
                .min(0, 'Break minutes cannot be negative')
                .optional(),

            applicable_days: dayFlagsSchema.optional(),

            weekly_off: z.array(weeklyOffEnum).optional(),

            shift_type: z.enum(['FIXED', 'FLEXIBLE']).optional().default('FIXED'),

            code: z.string().optional().default(''),

            description: z.string().optional().default(''),

            require_gross_hours: z.boolean().optional().default(false),

            gross_hours: z
                .number()
                .min(0, 'Gross hours cannot be negative')
                .max(24, 'Gross hours cannot exceed 24')
                .optional()
                .default(0),

            max_shift_duration_hours: z
                .number()
                .int()
                .min(0, 'Maximum shift duration cannot be negative')
                .max(72, 'Maximum shift duration cannot exceed 72')
                .optional()
                .default(0),
        })
        .strict();

    function validateCreateShiftBusinessRules(parsed) {
        const issues = [];
        if (parsed.applicable_days && !Object.values(parsed.applicable_days).some(Boolean)) {
            issues.push({ field: 'applicable_days', message: 'Select at least one working day' });
        }
        if (parsed.shift_type === 'FLEXIBLE') {
            if (!parsed.require_gross_hours || !(parsed.gross_hours > 0)) {
                issues.push({ field: 'gross_hours', message: 'Flexible shifts require gross hours greater than 0' });
            }
            if (!(parsed.max_shift_duration_hours > 0)) {
                issues.push({ field: 'max_shift_duration_hours', message: 'Flexible shifts require a maximum shift duration greater than 0' });
            }
        }
        if (parsed.require_gross_hours && !(parsed.gross_hours > 0)) {
            issues.push({ field: 'gross_hours', message: 'Gross hours must be greater than 0 when enabled' });
        }
        // Effective hours must never go negative: break_minutes <= gross_hours * 60
        if (parsed.require_gross_hours && parsed.gross_hours > 0) {
            const breakMin = Number(parsed.break_minutes) || 0;
            if (breakMin > parsed.gross_hours * 60) {
                issues.push({
                    field: 'break_minutes',
                    message: 'Break duration cannot exceed gross hours (effective hours would be negative)',
                });
            }
        }
        return issues;
    }

    function validateUpdateShiftEffective(existingShift, parsed) {
        const issues = [];
        const gross =
            parsed.require_gross_hours === true
                ? Number(parsed.gross_hours) || 0
                : parsed.require_gross_hours === false
                    ? 0
                    : Number(existingShift?.gross_hours) || 0;
        const breakMin =
            parsed.break_minutes !== undefined && parsed.break_minutes !== null
                ? Number(parsed.break_minutes) || 0
                : Number(existingShift?.break_minutes) || 0;
        if (gross > 0 && breakMin > gross * 60) {
            issues.push({
                field: 'break_minutes',
                message: 'Break duration cannot exceed gross hours (effective hours would be negative)',
            });
        }
        return issues;
    }

    //
    // ------------------------------
    // 🟢 Create Shift
    // ------------------------------
    //
    openapi(
        {
            method: 'post',
            path: '/shifts',
            tags: ['Shift'],
            summary: 'Create a new shift',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createShiftSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Shift created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                start_time: z.string(),
                                end_time: z.string(),
                                break_minutes: z.number(),
                                applicable_days: dayFlagsSchema.optional(),
                                weekly_off: z.array(weeklyOffEnum).optional(),
                                shift_type: z.string().optional(),
                                code: z.string().optional(),
                                description: z.string().optional(),
                                require_gross_hours: z.boolean().optional(),
                                gross_hours: z.number().optional(),
                                effective_hours: z.number().nullable().optional(),
                                max_shift_duration_hours: z.number().optional(),
                                created_at: z.string().optional(),
                                updated_at: z.string().optional(),
                                deleted_at: z.string().optional(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                                details: z.array(
                                    z.object({
                                        field: z.string(),
                                        message: z.string(),
                                    })
                                ),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createShiftSchema.parse(body);
                const businessIssues = validateCreateShiftBusinessRules(parsed);
                if (businessIssues.length) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: businessIssues,
                        },
                        400
                    );
                }

                const response = await new Promise((resolve, reject) => {
                    shiftClient.CreateShift(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });

                return c.json(withEffectiveHours(response), 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map((e) => ({
                                field: e.path.join('.'),
                                message: e.message,
                            })),
                        },
                        400
                    );
                }
                const msg = String(error?.message || '');
                if (msg.includes('INVALID_ARGUMENT')) {
                    return c.json({ error: msg.replace(/^\d+\s+INVALID_ARGUMENT:\s*/, '') }, 400);
                }
                if (msg.includes('ALREADY_EXISTS')) {
                    return c.json({ error: msg.replace(/^\d+\s+ALREADY_EXISTS:\s*/, '') }, 409);
                }
                if (msg.includes('NOT_FOUND')) {
                    return c.json({ error: msg.replace(/^\d+\s+NOT_FOUND:\s*/, '') }, 404);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // ------------------------------
    // 🟣 Get Shift by ID
    // ------------------------------
    //
    openapi(
        {
            method: 'get',
            path: '/shifts/{id}',
            tags: ['Shift'],
            summary: 'Fetch a shift by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Shift ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Shift details',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                start_time: z.string(),
                                end_time: z.string(),
                                break_minutes: z.number(),
                                applicable_days: dayFlagsSchema.optional(),
                                weekly_off: z.array(weeklyOffEnum).optional(),
                                shift_type: z.string().optional(),
                                code: z.string().optional(),
                                description: z.string().optional(),
                                require_gross_hours: z.boolean().optional(),
                                gross_hours: z.number().optional(),
                                effective_hours: z.number().nullable().optional(),
                                max_shift_duration_hours: z.number().optional(),
                                created_at: z.string().optional(),
                                updated_at: z.string().optional(),
                                deleted_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Shift not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    shiftClient.GetShift({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });

                if (!response) return c.json({ error: 'Shift not found' }, 404);

                return c.json(withEffectiveHours(response));
            } catch (error) {
                const msg = String(error?.message || '');
                if (msg.includes('NOT_FOUND')) {
                    return c.json({ error: msg.replace(/^\d+\s+NOT_FOUND:\s*/, '') }, 404);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // ------------------------------
    // 🟡 List Shifts (No pagination)
    // ------------------------------
    //
    openapi(
        {
            method: 'get',
            path: '/shifts',
            tags: ['Shift'],
            summary: 'List all shifts of an organization',
            request: {
                query: z.object({
                    organization_id: z.string({
                        required_error: 'Organization ID is required',
                    }),
                    assignment_from: z.string().optional(),
                    assignment_to: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'List of shifts',
                    content: {
                        'application/json': {
                            schema: z.object({
                                shifts: z.array(
                                    z.object({
                                        id: z.string(),
                                        name: z.string(),
                                        organization_id: z.string(),
                                        start_time: z.string(),
                                        end_time: z.string(),
                                        break_minutes: z.number(),
                                        applicable_days: dayFlagsSchema.optional(),
                                        weekly_off: z.array(weeklyOffEnum).optional(),
                                        shift_type: z.string().optional(),
                                        code: z.string().optional(),
                                        description: z.string().optional(),
                                        require_gross_hours: z.boolean().optional(),
                                        gross_hours: z.number().optional(),
                                        effective_hours: z.number().nullable().optional(),
                                        max_shift_duration_hours: z.number().optional(),
                                        created_at: z.string().optional(),
                                        updated_at: z.string().optional(),
                                        deleted_at: z.string().optional(),
                                        employee_count: z.number().optional(),
                                    })
                                ),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                // Assignment range (optional): invalid ranges never reach the database.
                const range = resolveAssignmentRange(query);
                if (range.error) {
                    return c.json({ error: range.error }, 400);
                }

                const response = await new Promise((resolve, reject) => {
                    shiftClient.ListShifts(
                        { organization_id: query.organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                const shifts = (response.shifts || []).map(withEffectiveHours);

                // Authoritative employee counts from EmployeeShiftAssignment for the
                // requested range (default: today) — overrides the service's
                // today-only count so cards and the Employees tab stay consistent.
                const counts = await employeeCountsForShifts(
                    shifts.map((s) => s.id),
                    query.organization_id,
                    range
                );

                return c.json(
                    {
                        ...response,
                        shifts: shifts.map((s) => ({
                            ...s,
                            employee_count: counts[s.id] ?? 0,
                        })),
                    },
                    200
                );
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // ------------------------------
    // 🟡 List employees currently assigned to a shift
    // ------------------------------
    //
    openapi(
        {
            method: 'get',
            path: '/shifts/{id}/assigned-employees',
            tags: ['Shift'],
            summary: 'List employees currently assigned to a shift',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Shift ID is required' }).regex(objectIdRegex, 'Invalid shift id'),
                }),
                query: z.object({
                    organization_id: z.string().regex(objectIdRegex).optional(),
                    search: z.string().optional().default(''),
                    page: z.coerce.number().int().min(1).optional().default(1),
                    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
                    assignment_from: z.string().optional(),
                    assignment_to: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Assigned employees page',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        employee_name: z.string(),
                                        employee_code: z.string(),
                                        job_title: z.string(),
                                        reporting_to: z.string(),
                                        department: z.string(),
                                        location: z.string(),
                                    })
                                ),
                                total_count: z.number(),
                                page: z.number(),
                                limit: z.number(),
                            }),
                        },
                    },
                },
                400: { description: 'Invalid input' },
                404: { description: 'Shift not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const q = c.req.valid('query');
                const organizationId = resolveOrganizationId(c, q.organization_id);
                if (!organizationId || !objectIdRegex.test(organizationId)) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }

                const shift = await prisma.shifts.findUnique({ where: { id } });
                if (!shift || shift.deletedAt || shift.organizationId !== organizationId) {
                    return c.json({ error: 'Shift not found' }, 404);
                }

                // Assignment range (optional): no params → today (current-assignment
                // semantics); with params → inclusive overlap rule. Invalid ranges
                // never reach the database.
                const range = resolveAssignmentRange(q);
                if (range.error) {
                    return c.json({ error: range.error }, 400);
                }

                const search = (q.search || '').trim();

                const assignmentWhere = {
                    shiftId: id,
                    deletedAt: null,
                    ...assignmentOverlapWhere(range),
                    employee: {
                        organizationId,
                        deletedAt: null,
                        ...(search
                            ? {
                                OR: [
                                    { fullName: { contains: search, mode: 'insensitive' } },
                                    { employeeCode: { contains: search, mode: 'insensitive' } },
                                ],
                            }
                            : {}),
                    },
                };

                const assignments = await prisma.employeeShiftAssignment.findMany({
                    where: assignmentWhere,
                    select: { employeeId: true, validFrom: true },
                    orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
                });

                const seen = new Set();
                const employeeIds = [];
                for (const row of assignments) {
                    if (seen.has(row.employeeId)) continue;
                    seen.add(row.employeeId);
                    employeeIds.push(row.employeeId);
                }

                const totalCount = employeeIds.length;
                const page = q.page;
                const limit = q.limit;
                const skip = (page - 1) * limit;
                const pageIds = employeeIds.slice(skip, skip + limit);

                if (!pageIds.length) {
                    return c.json({ employees: [], total_count: totalCount, page, limit }, 200);
                }

                const employees = await prisma.organizationEmployees.findMany({
                    where: { id: { in: pageIds } },
                    select: {
                        id: true,
                        fullName: true,
                        employeeCode: true,
                        designation: { select: { name: true } },
                        manager: { select: { fullName: true } },
                        departmentAssignments: {
                            select: { department: { select: { name: true } } },
                            take: 1,
                        },
                        location: {
                            select: {
                                id: true,
                                name: true,
                                entityType: true,
                                isHeadquarters: true,
                                formattedAddress: true,
                                city: true,
                                state: true,
                                country: true,
                            },
                        },
                        branch: { select: { id: true, name: true } },
                    },
                });

                const byId = new Map(employees.map((e) => [e.id, e]));
                const ordered = pageIds.map((empId) => byId.get(empId)).filter(Boolean);
                const mapped = ordered.map((emp) => ({
                    id: emp.id,
                    employee_name: emp.fullName || '',
                    employee_code: emp.employeeCode || '',
                    job_title: emp.designation?.name || '',
                    reporting_to: emp.manager?.fullName || '',
                    department: emp.departmentAssignments?.[0]?.department?.name || '',
                    location: locationLabelFromEmployee(emp),
                }));

                return c.json({ employees: mapped, total_count: totalCount, page, limit }, 200);
            } catch (error) {
                console.error('[Shift] assigned-employees error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // ------------------------------
    // 🟠 Update Shift
    // ------------------------------
    //
    const updateShiftSchema = z.object({
        name: z.string().optional(),
        // Optional on update; empty string is rejected (not a valid ObjectId)
        organization_id: z
            .string()
            .regex(objectIdRegex, 'Invalid organization_id')
            .optional(),
        start_time: z.string().regex(hhmmRegex, 'Invalid time format (expected HH:mm)').optional(),
        end_time: z.string().regex(hhmmRegex, 'Invalid time format (expected HH:mm)').optional(),
        break_minutes: z
            .number()
            .int()
            .min(0, 'Break minutes cannot be negative')
            .optional(),
        applicable_days: dayFlagsSchema.optional(),
        weekly_off: z.array(weeklyOffEnum).optional(),
        shift_type: z.enum(['FIXED', 'FLEXIBLE']).optional(),
        code: z.string().optional(),
        description: z.string().optional(),
        require_gross_hours: z.boolean().optional(),
        gross_hours: z
            .number()
            .min(0, 'Gross hours cannot be negative')
            .max(24, 'Gross hours cannot exceed 24')
            .optional(),
        max_shift_duration_hours: z
            .number()
            .int()
            .min(0, 'Maximum shift duration cannot be negative')
            .max(72, 'Maximum shift duration cannot exceed 72')
            .optional(),
    });

    openapi(
        {
            method: 'put',
            path: '/shifts/{id}',
            tags: ['Shift'],
            summary: 'Update a shift',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Shift ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: updateShiftSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Shift updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                start_time: z.string(),
                                end_time: z.string(),
                                break_minutes: z.number(),
                                applicable_days: dayFlagsSchema.optional(),
                                weekly_off: z.array(weeklyOffEnum).optional(),
                                shift_type: z.string().optional(),
                                code: z.string().optional(),
                                description: z.string().optional(),
                                require_gross_hours: z.boolean().optional(),
                                gross_hours: z.number().optional(),
                                effective_hours: z.number().nullable().optional(),
                                max_shift_duration_hours: z.number().optional(),
                                created_at: z.string().optional(),
                                updated_at: z.string().optional(),
                                deleted_at: z.string().optional(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation error' },
                404: { description: 'Shift not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = updateShiftSchema.parse(await c.req.json());

                // Effective-hours safety: break cannot exceed configured gross hours
                const existing = await new Promise((resolve, reject) => {
                    shiftClient.GetShift({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });
                const effectiveIssues = validateUpdateShiftEffective(existing, body);
                if (effectiveIssues.length) {
                    return c.json({ error: 'Validation failed', details: effectiveIssues }, 400);
                }

                const payload = { id, ...body };

                const response = await new Promise((resolve, reject) => {
                    shiftClient.UpdateShift(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });

                return c.json(withEffectiveHours(response), 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map((e) => ({
                                field: e.path.join('.'),
                                message: e.message,
                            })),
                        },
                        400
                    );
                }
                const msg = String(error?.message || '');
                if (msg.includes('INVALID_ARGUMENT')) {
                    return c.json({ error: msg.replace(/^\d+\s+INVALID_ARGUMENT:\s*/, '') }, 400);
                }
                if (msg.includes('PERMISSION_DENIED')) {
                    return c.json({ error: msg.replace(/^\d+\s+PERMISSION_DENIED:\s*/, '') }, 403);
                }
                if (msg.includes('NOT_FOUND')) {
                    return c.json({ error: msg.replace(/^\d+\s+NOT_FOUND:\s*/, '') }, 404);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // ------------------------------
    // 🔴 Delete Shift
    // ------------------------------
    //
    openapi(
        {
            method: 'delete',
            path: '/shifts/{id}',
            tags: ['Shift'],
            summary: 'Soft delete a shift',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Shift ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Shift deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Shift not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    shiftClient.DeleteShift({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                const msg = String(error?.message || '');
                if (msg.includes('NOT_FOUND')) {
                    return c.json({ error: msg.replace(/^\d+\s+NOT_FOUND:\s*/, '') }, 404);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
