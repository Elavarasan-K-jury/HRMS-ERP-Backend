// src/routes/holidayPolicy.routes.js
import { z, ZodError } from 'zod';
import { holidayPolicyClient } from '../grpc/holiday-policy.client.js';

export default function registerHolidayPolicyRoutes({ openapi: app }) {
    const createPolicySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z.string({ required_error: 'Policy name is required' }),
        region: z.string({ required_error: 'Region is required' }),
        applicable_to: z.array(z.string()).optional().default([]),
    });

    const updatePolicySchema = z.object({
        name: z.string().optional(),
        region: z.string().optional(),
        applicable_to: z.array(z.string()).optional(),
        is_active: z.boolean().optional(),
    });

    const idParamSchema = z.object({
        id: z.string({ required_error: 'Policy ID is required' }),
    });

    const listQuerySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        region: z.string().optional(),
        is_active_only: z
            .union([z.literal('true'), z.literal('false')])
            .optional()
            .transform(v => (v ? v === 'true' : undefined)),
    });

    /* CREATE POLICY */
    app(
        {
            method: 'post',
            path: '/holiday-policies',
            tags: ['Holiday Policy'],
            summary: 'Create a new holiday policy',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createPolicySchema },
                    },
                },
            },
            responses: {
                201: { description: 'Holiday policy created successfully' },
                400: { description: 'Validation failed' },
            },
        },
        async c => {
            try {
                const body = createPolicySchema.parse(await c.req.json());

                const response = await new Promise((resolve, reject) => {
                    holidayPolicyClient.CreateHolidayPolicy(body, (err, resp) =>
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

    /* UPDATE POLICY */
    app(
        {
            method: 'put',
            path: '/holiday-policies/{id}',
            tags: ['Holiday Policy'],
            summary: 'Update an existing holiday policy',
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        'application/json': { schema: updatePolicySchema },
                    },
                },
            },
            responses: {
                200: { description: 'Holiday policy updated' },
                400: { description: 'Validation failed' },
                404: { description: 'Policy not found' },
            },
        },
        async c => {
            try {
                const id = c.req.param('id');
                const body = updatePolicySchema.parse(await c.req.json());

                const payload = { policy_id: id, ...body };

                const response = await new Promise((resolve, reject) => {
                    holidayPolicyClient.UpdateHolidayPolicy(payload, (err, resp) =>
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

    /* GET POLICY BY ID */
    app(
        {
            method: 'get',
            path: '/holiday-policies/{id}',
            tags: ['Holiday Policy'],
            summary: 'Get holiday policy by ID',
            request: { params: idParamSchema },
            responses: {
                200: { description: 'Policy fetched' },
                404: { description: 'Policy not found' },
            },
        },
        async c => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    holidayPolicyClient.GetHolidayPolicy({ policy_id: id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                if (!response || !response.policy) {
                    return c.json({ error: 'Policy not found' }, 404);
                }

                return c.json(response, 200);
            } catch (error) {
                return c.json(
                    { error: error.message },
                    error.code === 5 ? 404 : 500
                );
            }
        }
    );

    /* LIST POLICIES */
    app(
        {
            method: 'get',
            path: '/holiday-policies',
            tags: ['Holiday Policy'],
            summary: 'List holiday policies for an organization',
            request: { query: listQuerySchema },
            responses: {
                200: {
                    description: 'List of holiday policies',
                    content: {
                        'application/json': {
                            schema: z.object({
                                policies: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        name: z.string(),
                                        region: z.string(),
                                        applicable_to: z.array(z.string()),
                                        is_active: z.boolean(),
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
                const rawQuery = c.req.valid('query');

                const grpcQuery = {
                    organization_id: rawQuery.organization_id,
                    region: rawQuery.region || '',
                    is_active_only: rawQuery.is_active_only ?? false,
                };

                const response = await new Promise((resolve, reject) => {
                    holidayPolicyClient.ListHolidayPolicies(grpcQuery, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(
                    {
                        policies: response.policies,
                        total_count: response.total_count,
                    },
                    200
                );
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* DELETE POLICY */
    app(
        {
            method: 'delete',
            path: '/holiday-policies/{id}',
            tags: ['Holiday Policy'],
            summary: 'Soft delete a holiday policy',
            request: { params: idParamSchema },
            responses: {
                200: { description: 'Policy deleted' },
                404: { description: 'Policy not found' },
            },
        },
        async c => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    holidayPolicyClient.DeleteHolidayPolicy({ policy_id: id }, (err, resp) =>
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
