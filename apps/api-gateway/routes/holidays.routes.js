// src/routes/holiday.routes.js
import { z, ZodError } from 'zod';
import { holidayClient } from '../grpc/holiday.client.js';

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
        region: z.string().optional().nullable(),
        type: holidayTypeEnum.default('PUBLIC'),
    });

    const updateHolidaySchema = z.object({
        policy_id: z.string().optional(),
        date: z.string().optional(),
        name: z.string().optional(),
        region: z.string().optional().nullable(),
        type: holidayTypeEnum.optional(),
    });

    const idParamSchema = z.object({
        id: z.string({ required_error: 'Holiday ID is required' }),
    });

    const listQuerySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        year: z.string().optional(),
        type: holidayTypeEnum.optional(),
        region: z.string().optional(),
        policy_id: z.string().optional(),
    });

    const calendarQuerySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        month: z
            .string()
            .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
        policy_id: z.string().optional(),
        region: z.string().optional(),
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
                console.log('holidays.routes.js @ Line 137:', payload);

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
       GET HOLIDAY BY ID
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
                                        region: z.string().optional(),
                                        type: holidayTypeEnum,
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
}
