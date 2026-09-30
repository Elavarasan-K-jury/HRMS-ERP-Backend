// src/routes/holiday.routes.js
import { z, ZodError } from 'zod';
import { holidayClient } from '../grpc/holiday.client.js';
import { PrismaClient } from '@jury-hrms/db';

const prisma = new PrismaClient();

const BULK_IMPORT_MAX_ROWS = 500;

function localDayKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/* ============================================================
   YEAR CREATION RULE
   - currentYear: allowed
   - nextYear: allowed only Dec 25–31
   - previousYear: rejected
   - beyond nextYear: rejected
============================================================ */
function isHolidayYearAllowed(dateStr) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const holidayYear = date.getUTCFullYear();
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const currentDay = now.getUTCDate();

    if (holidayYear < currentYear) {
        return { allowed: false, message: `Holiday creation is not available for past years. Current year is ${currentYear}.` };
    }
    if (holidayYear === currentYear) {
        return { allowed: true };
    }
    if (holidayYear === currentYear + 1) {
        const isDec25to31 = currentMonth === 11 && currentDay >= 25;
        if (isDec25to31) {
            return { allowed: true };
        }
        return { allowed: false, message: `${holidayYear} holiday creation is available from 25-Dec-${currentYear}.` };
    }
    return { allowed: false, message: `Holiday creation is not available for ${holidayYear}. Maximum allowed year is ${currentYear + 1}.` };
}

export default function registerHolidayRoutes({ openapi: app }) {
    /* ============================================================
       ZOD SCHEMAS
    ============================================================ */

    const holidayTypeEnum = z.enum([
        'PUBLIC',
        'RESTRICTED',
        'OPTIONAL',
        'WEEK_OFF',
        'COMPANY_EVENT',
    ]);

    const createHolidaySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        policy_id: z.string().optional(),
        date: z
            .string()
            .refine(v => !isNaN(Date.parse(v)), { message: 'Invalid date format. Use YYYY-MM-DD' }),
        name: z.string({ required_error: 'Holiday name is required' }),
        type: holidayTypeEnum.default('PUBLIC'),
        leave_optional: z.boolean().optional().default(false),
    });

    const updateHolidaySchema = z.object({
        policy_id: z.string().optional(),
        date: z.string().optional(),
        name: z.string().optional(),
        type: holidayTypeEnum.optional(),
        leave_optional: z.boolean().optional(),
    });

    const idParamSchema = z.object({
        id: z.string({ required_error: 'Holiday ID is required' }),
    });

    const listQuerySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        year: z.string().optional(),
        type: holidayTypeEnum.optional(),
        policy_id: z.string().optional(),
    });

    const calendarQuerySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        month: z
            .string()
            .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
        policy_id: z.string().optional(),
    });

    /* ============================================================
       CREATE HOLIDAY
    ============================================================ */
    app(
        {
            method: 'post',
            path: '/holidays',
            tags: ['Holiday'],
            summary: 'Create a new holiday',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createHolidaySchema },
                    },
                },
            },
            responses: {
                201: { description: 'Holiday created successfully' },
                400: { description: 'Validation error' },
            },
        },
        async c => {
            try {
                const body = createHolidaySchema.parse(await c.req.json());

                /* --- Year creation rule --- */
                const yearCheck = isHolidayYearAllowed(body.date);
                if (!yearCheck.allowed) {
                    return c.json({ error: yearCheck.message }, 400);
                }

                const response = await new Promise((resolve, reject) => {
                    holidayClient.CreateHoliday(body, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map(e => ({
                                field: e.path.join('.'),
                                message: e.message,
                            })),
                        },
                        400
                    );
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ============================================================
       UPDATE HOLIDAY
    ============================================================ */
    app(
        {
            method: 'put',
            path: '/holidays/{id}',
            tags: ['Holiday'],
            summary: 'Update an existing holiday',
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        'application/json': { schema: updateHolidaySchema },
                    },
                },
            },
            responses: {
                200: { description: 'Holiday updated successfully' },
                400: { description: 'Validation error' },
                404: { description: 'Holiday not found' },
            },
        },
        async c => {
            try {
                const id = c.req.param('id');
                const body = updateHolidaySchema.parse(await c.req.json());

                const payload = { holiday_id: id, ...body };

                const response = await new Promise((resolve, reject) => {
                    holidayClient.UpdateHoliday(payload, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map(e => ({
                                field: e.path.join('.'),
                                message: e.message,
                            })),
                        },
                        400
                    );
                }

                return c.json(
                    { error: error.message },
                    error.code === 5 ? 404 : 500
                );
            }
        }
    );

    /* ============================================================
       LIST HOLIDAYS (with type filter + total_count)
    ============================================================ */
    app(
        {
            method: 'get',
            path: '/holidays',
            tags: ['Holiday'],
            summary: 'List all holidays for an organization (with filters)',
            request: { query: listQuerySchema },
            responses: {
                200: {
                    description: 'List of holidays',
                    content: {
                        'application/json': {
                            schema: z.object({
                                holidays: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        policy_id: z.string().optional(),
                                        date: z.string(),
                                        name: z.string(),
                                        type: holidayTypeEnum,
                                        leave_optional: z.boolean(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                    })
                                ),
                                total_count: z.number(),
                            }),
                        },
                    },
                },
            },
        },
        async c => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    holidayClient.ListHolidays(query, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(
                    {
                        holidays: response.holidays,
                        total_count: response.total_count,
                    },
                    200
                );
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ============================================================
       AVAILABLE HOLIDAY YEARS (year-independent discovery)
    ============================================================ */
    app(
        {
            method: 'get',
            path: '/holidays/available-years',
            tags: ['Holiday'],
            summary: 'Get distinct holiday years for an organization',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Available holiday years',
                    content: {
                        'application/json': {
                            schema: z.object({
                                years: z.array(z.number()),
                            }),
                        },
                    },
                },
            },
        },
        async c => {
            try {
                const { organization_id } = c.req.valid('query');

                const rows = await prisma.holidays.findMany({
                    where: { organizationId: organization_id },
                    select: { date: true },
                });

                const yearSet = new Set();
                for (const row of rows) {
                    if (row.date) {
                        const year = new Date(row.date).getFullYear();
                        if (!isNaN(year)) yearSet.add(year);
                    }
                }

                const now = new Date();
                const currentYear = now.getUTCFullYear();
                yearSet.add(currentYear);
                yearSet.add(currentYear + 1);

                const years = Array.from(yearSet).sort((a, b) => a - b);

                return c.json({ years }, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ============================================================
       HOLIDAY CALENDAR VIEW (MONTH)
    ============================================================ */
    app(
        {
            method: 'get',
            path: '/holidays/calendar/view',
            tags: ['Holiday'],
            summary: 'Get holiday calendar for a month',
            request: { query: calendarQuerySchema },
            responses: {
                200: { description: 'Holiday calendar view' },
            },
        },
        async c => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    holidayClient.GetHolidayCalendar(query, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ============================================================
       GET HOLIDAY BY ID
       (must be registered after static /holidays/* paths so
        available-years / calendar/view are not swallowed by {id})
    ============================================================ */
    app(
        {
            method: 'get',
            path: '/holidays/{id}',
            tags: ['Holiday'],
            summary: 'Fetch holiday by ID',
            request: { params: idParamSchema },
            responses: {
                200: { description: 'Holiday data retrieved successfully' },
                404: { description: 'Holiday not found' },
            },
        },
        async c => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    holidayClient.GetHoliday({ holiday_id: id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                if (!response || !response.holiday)
                    return c.json({ error: 'Holiday not found' }, 404);

                return c.json(response, 200);
            } catch (error) {
                return c.json(
                    { error: error.message },
                    error.code === 5 ? 404 : 500
                );
            }
        }
    );

    /* ============================================================
       DELETE HOLIDAY
    ============================================================ */
    app(
        {
            method: 'delete',
            path: '/holidays/{id}',
            tags: ['Holiday'],
            summary: 'Delete a holiday',
            request: { params: idParamSchema },
            responses: { 200: { description: 'Holiday deleted successfully' } },
        },
        async c => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    holidayClient.DeleteHoliday({ holiday_id: id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json(
                    { error: error.message },
                    error.code === 5 ? 404 : 500
                );
            }
        }
    );

    /* ============================================================
       BULK IMPORT HOLIDAYS
    ============================================================ */
    app(
        {
            method: 'post',
            path: '/holidays/bulk-import',
            tags: ['Holiday'],
            summary: 'Bulk import holidays from Excel',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string({ required_error: 'Organization ID is required' }),
                                policy_id: z.string({ required_error: 'Policy ID is required' }),
                                holidays: z.array(
                                    z.object({
                                        name: z.string(),
                                        date: z.string(),
                                        leave_optional: z.boolean().optional().default(false),
                                        _excelRow: z.number().optional(),
                                    })
                                ).min(1, 'At least one holiday is required'),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: { description: 'Bulk import completed' },
                400: { description: 'Validation error' },
            },
        },
        async c => {
            try {
                const body = await c.req.json();

                const organization_id = body.organization_id;
                const policy_id = body.policy_id;
                const holidays = body.holidays;

                if (!organization_id || typeof organization_id !== 'string') {
                    return c.json({ success: false, error: 'Organization ID is required' }, 400);
                }
                if (!policy_id || typeof policy_id !== 'string') {
                    return c.json({ success: false, error: 'Policy ID is required' }, 400);
                }
                if (!Array.isArray(holidays) || holidays.length === 0) {
                    return c.json({ success: false, error: 'At least one holiday is required' }, 400);
                }
                if (holidays.length > BULK_IMPORT_MAX_ROWS) {
                    return c.json({ success: false, error: `Maximum ${BULK_IMPORT_MAX_ROWS} holidays per import. Received ${holidays.length}.` }, 400);
                }

                const errors = [];

                /* --- Policy ownership validation --- */
                const policy = await prisma.holidayPolicies.findFirst({
                    where: { id: policy_id, isActive: true },
                });
                if (!policy) {
                    return c.json({ success: false, error: 'Holiday policy not found.' }, 404);
                }
                if (policy.organizationId !== organization_id) {
                    return c.json({ success: false, error: 'Holiday policy does not belong to this organization.' }, 403);
                }

                /* --- Row-level validation --- */
                const validRows = [];

                for (let i = 0; i < holidays.length; i++) {
                    const row = holidays[i];
                    const rowNumber = row._excelRow || (i + 2);
                    const rowErrors = [];

                    const name = typeof row.name === 'string' ? row.name.trim() : '';
                    if (!name) {
                        rowErrors.push({ row: rowNumber, field: 'name', message: 'Name is required.' });
                    }

                    const dateStr = typeof row.date === 'string' ? row.date.trim() : '';
                    let parsedDate = null;
                    if (!dateStr) {
                        rowErrors.push({ row: rowNumber, field: 'date', message: 'Date is required.' });
                    } else {
                        const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                        if (!dateMatch) {
                            rowErrors.push({ row: rowNumber, field: 'date', message: 'Invalid date format. Use YYYY-MM-DD.' });
                        } else {
                            parsedDate = new Date(`${dateStr}T00:00:00.000Z`);
                            if (isNaN(parsedDate.getTime())) {
                                rowErrors.push({ row: rowNumber, field: 'date', message: 'Invalid date.' });
                            } else {
                                /* --- Year creation rule --- */
                                const yearCheck = isHolidayYearAllowed(dateStr);
                                if (!yearCheck.allowed) {
                                    rowErrors.push({ row: rowNumber, field: 'date', message: yearCheck.message });
                                }
                            }
                        }
                    }

                    let leaveOptional = false;
                    if (row.leave_optional !== undefined && row.leave_optional !== null) {
                        if (typeof row.leave_optional === 'boolean') {
                            leaveOptional = row.leave_optional;
                        } else {
                            rowErrors.push({ row: rowNumber, field: 'leave_optional', message: 'Leave Optional must be a boolean.' });
                        }
                    }

                    if (rowErrors.length > 0) {
                        errors.push(...rowErrors);
                    } else {
                        validRows.push({ name, date: parsedDate, leaveOptional, _excelRow: rowNumber });
                    }
                }

                /* --- Duplicate detection within upload --- */
                const seenInUpload = new Map();
                for (const row of validRows) {
                    const key = `${row.name.toLowerCase()}|${localDayKey(row.date)}`;
                    if (seenInUpload.has(key)) {
                        const existingRow = seenInUpload.get(key);
                        errors.push({
                            row: row._excelRow,
                            field: 'duplicate',
                            message: `Duplicate of row ${existingRow}.`,
                        });
                    } else {
                        seenInUpload.set(key, row._excelRow);
                    }
                }

                if (errors.length > 0) {
                    return c.json({ success: false, message: 'Validation failed.', errors }, 400);
                }

                /* --- Duplicate detection against existing database --- */
                if (validRows.length > 0) {
                    const existingHolidays = await prisma.holidays.findMany({
                        where: {
                            organizationId: organization_id,
                            policyId: policy_id,
                        },
                        select: { name: true, date: true },
                    });

                    const existingSet = new Set(
                        existingHolidays.map(h => `${h.name.toLowerCase()}|${localDayKey(h.date)}`)
                    );

                    for (const row of validRows) {
                        const key = `${row.name.toLowerCase()}|${localDayKey(row.date)}`;
                        if (existingSet.has(key)) {
                            errors.push({
                                row: row._excelRow,
                                field: 'duplicate',
                                message: `Holiday '${row.name}' on ${localDayKey(row.date)} already exists in this policy.`,
                            });
                        }
                    }

                    if (errors.length > 0) {
                        return c.json({ success: false, message: 'Validation failed.', errors }, 400);
                    }
                }

                /* --- Bulk creation --- */
                const now = new Date();
                const createData = validRows.map(row => ({
                    organizationId: organization_id,
                    policyId: policy_id,
                    name: row.name,
                    date: row.date,
                    type: 'PUBLIC',
                    leaveOptional: row.leaveOptional,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: null,
                }));

                const result = await prisma.holidays.createMany({ data: createData });

                return c.json({
                    success: true,
                    message: `${result.count} holiday${result.count !== 1 ? 's' : ''} imported successfully.`,
                    imported_count: result.count,
                }, 200);
            } catch (error) {
                console.error('[HolidayBulkImport] error:', error);
                return c.json({ success: false, error: error.message || 'Internal server error' }, 500);
            }
        }
    );
}
