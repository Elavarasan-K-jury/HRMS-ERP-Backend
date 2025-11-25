import { z, ZodError } from 'zod';
import { shiftClient } from '../grpc/shift.client.js';

export default function registerShiftRoutes({ openapi }) {
    //
    // ------------------------------
    // 📌 Create Shift Schema
    // ------------------------------
    //
    // NOTE:
    // - start_time / end_time should be ISO datetime strings
    //   e.g. "2025-11-17T09:00:00+05:30" (IST, 24-hour format)
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

    const createShiftSchema = z
        .object({
            organization_id: z.string({ required_error: 'Organization ID is required' }),

            name: z
                .string({ required_error: 'Shift name is required' })
                .min(2, 'Name must have at least 2 characters'),

            start_time: z
                .string({ required_error: 'Start time is required' })
                .datetime('Invalid date format'), // expects ISO datetime (can include +05:30)

            end_time: z
                .string({ required_error: 'End time is required' })
                .datetime('Invalid date format'),

            break_minutes: z
                .number()
                .int()
                .min(0, 'Break minutes cannot be negative')
                .optional(),

            applicable_days: dayFlagsSchema.optional(),

            weekly_off: z.array(weeklyOffEnum).optional(),
        })
        .strict();

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

                const response = await new Promise((resolve, reject) => {
                    shiftClient.CreateShift(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });

                return c.json(response, 201);
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

                return c.json(response);
            } catch (error) {
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
                                        created_at: z.string().optional(),
                                        updated_at: z.string().optional(),
                                        deleted_at: z.string().optional(),
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

                const response = await new Promise((resolve, reject) => {
                    shiftClient.ListShifts(
                        { organization_id: query.organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
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
        organization_id: z.string().optional(),
        start_time: z.string().datetime().optional(),
        end_time: z.string().datetime().optional(),
        break_minutes: z
            .number()
            .int()
            .min(0, 'Break minutes cannot be negative')
            .optional(),
        applicable_days: dayFlagsSchema.optional(),
        weekly_off: z.array(weeklyOffEnum).optional(),
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

                const payload = { id, ...body };

                const response = await new Promise((resolve, reject) => {
                    shiftClient.UpdateShift(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.shift);
                    });
                });

                return c.json(response, 200);
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
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
