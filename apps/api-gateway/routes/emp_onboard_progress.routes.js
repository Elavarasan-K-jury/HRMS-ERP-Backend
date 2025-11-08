import { z, ZodError } from 'zod';
import { onboardingProgressClient } from '../grpc/emp_onboard_progress.client.js';

export default function registerEmployeeOnboardingProgressRoutes(app) {
    // ✅ Schema for creating onboarding progress
    const createOnboardingProgressSchema = z.object({
        employee_id: z.string({ required_error: 'Employee ID is required' }),
        flow_id: z.string({ required_error: 'Onboarding Flow ID is required' }),
        step_id: z.string({ required_error: 'Step ID is required' }),
        step_feature_id: z.string({ required_error: 'Step Feature ID is required' }),
        step_feature_value: z.string().optional(),
    });

    // 🟢 Create Employee Onboarding Progress
    app.openapi(
        {
            method: 'post',
            path: '/employee-onboarding-progress',
            tags: ['Employee Onboarding Progress'],
            summary: 'Create onboarding progress record for an employee',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createOnboardingProgressSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Progress created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                employee_id: z.string(),
                                flow_id: z.string(),
                                step_id: z.string(),
                                step_feature_id: z.string(),
                                step_feature_value: z.string().optional(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createOnboardingProgressSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    onboardingProgressClient.CreateEmployeeOnboardingProgress(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progress);
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟣 Get Progress by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-progress/{id}',
            tags: ['Employee Onboarding Progress'],
            summary: 'Get onboarding progress by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'Progress ID is required' }) }),
            },
            responses: {
                200: {
                    description: 'Progress details',
                    content: {
                        'application/json': {
                            schema: createOnboardingProgressSchema.extend({
                                id: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Progress not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    onboardingProgressClient.GetEmployeeOnboardingProgress({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progress);
                    });
                });

                if (!response) return c.json({ error: 'Progress not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List All Progress (by employee or flow)
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-progress',
            tags: ['Employee Onboarding Progress'],
            summary: 'List onboarding progress records by employee or flow',
            request: {
                query: z.object({
                    employee_id: z.string().optional(),
                    flow_id: z.string().optional(),
                }).refine(data => data.employee_id || data.flow_id, {
                    message: 'At least one of employee_id or flow_id must be provided',
                }),
            },
            responses: {
                200: {
                    description: 'List of progress records',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    employee_id: z.string(),
                                    flow_id: z.string(),
                                    step_id: z.string(),
                                    step_feature_id: z.string(),
                                    step_feature_value: z.string().optional(),
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
                const parsed = z.object({
                    employee_id: z.string().optional(),
                    flow_id: z.string().optional(),
                }).refine(data => data.employee_id || data.flow_id, {
                    message: 'At least one of employee_id or flow_id must be provided',
                }).parse(query);

                const response = await new Promise((resolve, reject) => {
                    onboardingProgressClient.ListEmployeeOnboardingProgresses(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progresses);
                    });
                });

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🔵 Update Progress (update only value)
    app.openapi(
        {
            method: 'put',
            path: '/employee-onboarding-progress/{id}',
            tags: ['Employee Onboarding Progress'],
            summary: 'Update progress feature value for an employee',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Progress ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                step_feature_value: z.string({ required_error: 'Step feature value is required' }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Progress updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                step_feature_value: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Progress not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = z.object({
                    step_feature_value: z.string(),
                }).parse(body);

                // ✅ Check if exists
                const existing = await new Promise((resolve, reject) => {
                    onboardingProgressClient.GetEmployeeOnboardingProgress({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progress);
                    });
                });

                if (!existing) return c.json({ error: 'Progress not found' }, 404);

                const payload = { id, ...parsed };

                const response = await new Promise((resolve, reject) => {
                    onboardingProgressClient.UpdateEmployeeOnboardingProgress(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progress);
                    });
                });

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🔴 Delete Progress Record
    app.openapi(
        {
            method: 'delete',
            path: '/employee-onboarding-progress/{id}',
            tags: ['Employee Onboarding Progress'],
            summary: 'Delete onboarding progress record by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Progress ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Progress deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Progress not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const existing = await new Promise((resolve, reject) => {
                    onboardingProgressClient.GetEmployeeOnboardingProgress({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.progress);
                    });
                });

                if (!existing) return c.json({ error: 'Progress not found' }, 404);

                const response = await new Promise((resolve, reject) => {
                    onboardingProgressClient.DeleteEmployeeOnboardingProgress({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeOnboardingProgress API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
