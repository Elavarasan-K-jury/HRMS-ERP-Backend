import { z, ZodError } from 'zod';
import { onboardingStepClient } from '../grpc/emp_onboard_step.client.js';

export default function registerEmployeeOnboardingStepRoutes(app) {
    // ✅ Schema for creating Onboarding Step
    const createOnboardingStepSchema = z.object({
        onboarding_id: z.string({ required_error: 'Onboarding Flow ID is required' }),
        name: z.string({ required_error: 'Step name is required' }).min(2, 'Name must have at least 2 characters'),
        is_active: z.boolean().default(true),
    });

    // 🟢 Create Onboarding Step
    app.openapi(
        {
            method: 'post',
            path: '/employee-onboarding-steps',
            tags: ['Employee Onboarding Steps'],
            summary: 'Create a new employee onboarding step for a flow',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createOnboardingStepSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Onboarding step created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                onboarding_id: z.string(),
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
                const parsed = createOnboardingStepSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    onboardingStepClient.CreateEmployeeOnboardingStep(parsed, (err, resp) => {
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

    // 🟣 Get Onboarding Step by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-steps/{id}',
            tags: ['Employee Onboarding Steps'],
            summary: 'Get a specific onboarding step by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'Step ID is required' }) }),
            },
            responses: {
                200: {
                    description: 'Onboarding Step details',
                    content: {
                        'application/json': {
                            schema: createOnboardingStepSchema.extend({
                                id: z.string(),
                                created_at: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Onboarding step not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    onboardingStepClient.GetEmployeeOnboardingStep({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!response) return c.json({ error: 'Onboarding step not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List All Steps by Flow
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-steps',
            tags: ['Employee Onboarding Steps'],
            summary: 'List all onboarding steps for a specific onboarding flow',
            request: {
                query: z.object({
                    onboarding_id: z.string({ required_error: 'Onboarding Flow ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'List of onboarding steps',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    name: z.string(),
                                    onboarding_id: z.string(),
                                    is_active: z.boolean(),
                                })
                            ),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.query();
                const parsed = z.object({ onboarding_id: z.string() }).parse(query);

                const response = await new Promise((resolve, reject) => {
                    onboardingStepClient.ListEmployeeOnboardingSteps(parsed, (err, resp) => {
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

    // 🔵 Update Onboarding Step
    app.openapi(
        {
            method: 'put',
            path: '/employee-onboarding-steps/{id}',
            tags: ['Employee Onboarding Steps'],
            summary: 'Update an existing employee onboarding step',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Step ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: createOnboardingStepSchema.partial().extend({
                                onboarding_id: z.string({ required_error: 'Onboarding Flow ID is required' }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Onboarding Step updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                onboarding_id: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Step not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                // ✅ Check step existence first
                const existing = await new Promise((resolve, reject) => {
                    onboardingStepClient.GetEmployeeOnboardingStep({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.step);
                    });
                });

                if (!existing) return c.json({ error: 'Step not found' }, 404);

                const parsed = createOnboardingStepSchema
                    .partial()
                    .extend({
                        onboarding_id: z.string({ required_error: 'Onboarding Flow ID is required' }),
                    })
                    .parse(body);

                const payload = { id, ...parsed };

                const response = await new Promise((resolve, reject) => {
                    onboardingStepClient.UpdateEmployeeOnboardingStep(payload, (err, resp) => {
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

    // 🔴 Delete Onboarding Step
    app.openapi(
        {
            method: 'delete',
            path: '/employee-onboarding-steps/{id}',
            tags: ['Employee Onboarding Steps'],
            summary: 'Soft delete an onboarding step by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Step ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Onboarding step deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Step not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const existing = await new Promise((resolve, reject) => {
                    onboardingStepClient.GetEmployeeOnboardingStep({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.step);
                    });
                });

                if (!existing) return c.json({ error: 'Step not found' }, 404);

                const response = await new Promise((resolve, reject) => {
                    onboardingStepClient.DeleteEmployeeOnboardingStep({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeOnboardingStep API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
