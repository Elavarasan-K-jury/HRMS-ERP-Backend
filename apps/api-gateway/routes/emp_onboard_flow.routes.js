import { z, ZodError } from 'zod';
import { onboardingFlowClient } from '../grpc/emp_onboard_flow.client.js';

export default function registerEmployeeOnboardingFlowRoutes(app) {
    // ✅ Schema for creating Onboarding Flow
    const createOnboardingFlowSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z.string({ required_error: 'Flow name is required' }).min(2, 'Name must have at least 2 characters'),
        description: z.string().optional(),
        steps: z.number().int().min(0).optional(),
        estimated_days: z.number().int().min(0).optional(),
    });

    // 🟢 Create Onboarding Flow
    app.openapi(
        {
            method: 'post',
            path: '/employee-onboarding-flows',
            tags: ['Employee Onboarding Flows'],
            summary: 'Create a new employee onboarding flow',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createOnboardingFlowSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Onboarding Flow created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                created_at: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createOnboardingFlowSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    onboardingFlowClient.CreateEmployeeOnboardingFlow(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
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

    // 🟣 Get Onboarding Flow by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-flows/{id}',
            tags: ['Employee Onboarding Flows'],
            summary: 'Get an onboarding flow by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'Flow ID is required' }) }),
            },
            responses: {
                200: {
                    description: 'Onboarding Flow details',
                    content: {
                        'application/json': {
                            schema: createOnboardingFlowSchema.extend({
                                id: z.string(),
                                created_at: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Onboarding Flow not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    onboardingFlowClient.GetEmployeeOnboardingFlow({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!response) return c.json({ error: 'Onboarding Flow not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List All Onboarding Flows
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-flows',
            tags: ['Employee Onboarding Flows'],
            summary: 'List all employee onboarding flows for an organization',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().optional(),
                    sort_by: z.string().optional(),
                    sort_order: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'List of onboarding flows',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    name: z.string(),
                                    organization_id: z.string(),
                                })
                            ),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const {
                    organization_id,
                    page,
                    limit,
                    search,
                    sort_by,
                    sort_order,
                } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    onboardingFlowClient.ListEmployeeOnboardingFlows({
                        organization_id,
                        page,
                        limit,
                        search,
                        sort_by,
                        sort_order,
                    }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response);
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

    // 🔵 Update Onboarding Flow
    app.openapi(
        {
            method: 'put',
            path: '/employee-onboarding-flows/{id}',
            tags: ['Employee Onboarding Flows'],
            summary: 'Update an existing employee onboarding flow',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Flow ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: createOnboardingFlowSchema.partial().extend({
                                organization_id: z.string({ required_error: 'Organization ID is required' }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Onboarding Flow updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation failed' },
                404: { description: 'Flow not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                const existing = await new Promise((resolve, reject) => {
                    onboardingFlowClient.GetEmployeeOnboardingFlow({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.flow);
                    });
                });

                if (!existing) return c.json({ error: 'Onboarding Flow not found' }, 404);

                const parsed = createOnboardingFlowSchema
                    .partial()
                    .extend({ organization_id: z.string({ required_error: 'Organization ID is required' }) })
                    .parse(body);

                const payload = { id, ...parsed };

                const response = await new Promise((resolve, reject) => {
                    onboardingFlowClient.UpdateEmployeeOnboardingFlow(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response);
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

    // 🔴 Delete Onboarding Flow
    app.openapi(
        {
            method: 'delete',
            path: '/employee-onboarding-flows/{id}',
            tags: ['Employee Onboarding Flows'],
            summary: 'Soft delete an onboarding flow by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Flow ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Onboarding flow deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation failed' },
                404: { description: 'Flow not found' },
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const existing = await new Promise((resolve, reject) => {
                    onboardingFlowClient.GetEmployeeOnboardingFlow({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!existing) return c.json({ error: 'Onboarding Flow not found' }, 404);

                const response = await new Promise((resolve, reject) => {
                    onboardingFlowClient.DeleteEmployeeOnboardingFlow({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeOnboardingFlow API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
