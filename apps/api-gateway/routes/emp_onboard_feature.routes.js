import { z, ZodError } from 'zod';
import { onboardingFeatureClient } from '../grpc/emp_onboard_feature.client.js';

export default function registerEmployeeOnboardingFeatureRoutes(app) {
    // ✅ Schema for creating Onboarding Feature
    const createOnboardingFeatureSchema = z.object({
        step_id: z.string({ required_error: 'Step ID is required' }),
        feature_name: z.string({ required_error: 'Feature name is required' }).min(2, 'Feature name must have at least 2 characters'),
        feature_type: z.string({ required_error: 'Feature type is required' }),
        has_options: z.boolean().default(false),
        options: z.any().optional().transform(val => (val ? JSON.stringify(val) : '')),
    });

    // 🟢 Create Feature
    app.openapi(
        {
            method: 'post',
            path: '/employee-onboarding-features',
            tags: ['Employee Onboarding Features'],
            summary: 'Create a new onboarding feature under a step',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createOnboardingFeatureSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Feature created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                step_id: z.string(),
                                feature_name: z.string(),
                                feature_type: z.string(),
                                has_options: z.boolean(),
                                options: z.string().optional(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createOnboardingFeatureSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.CreateEmployeeOnboardingFeature(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.feature);
                    });
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

    // 🟣 Get Feature by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-features/{id}',
            tags: ['Employee Onboarding Features'],
            summary: 'Get an onboarding feature by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'Feature ID is required' }) }),
            },
            responses: {
                200: {
                    description: 'Feature details',
                    content: {
                        'application/json': {
                            schema: createOnboardingFeatureSchema.extend({
                                id: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Feature not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.GetEmployeeOnboardingFeature({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.feature);
                    });
                });

                if (!response) return c.json({ error: 'Feature not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List All Features by Step
    app.openapi(
        {
            method: 'get',
            path: '/employee-onboarding-features',
            tags: ['Employee Onboarding Features'],
            summary: 'List all features for a specific onboarding step',
            request: {
                query: z.object({
                    step_id: z.string({ required_error: 'Step ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'List of features',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    step_id: z.string(),
                                    feature_name: z.string(),
                                    feature_type: z.string(),
                                    has_options: z.boolean(),
                                    options: z.string().optional(),
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
                const parsed = z.object({ step_id: z.string() }).parse(query);

                const response = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.ListEmployeeOnboardingFeatures(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.features);
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

    // 🔵 Update Feature
    app.openapi(
        {
            method: 'put',
            path: '/employee-onboarding-features/{id}',
            tags: ['Employee Onboarding Features'],
            summary: 'Update an existing onboarding feature',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Feature ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: createOnboardingFeatureSchema.partial().extend({
                                step_id: z.string({ required_error: 'Step ID is required' }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Feature updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                step_id: z.string(),
                                feature_name: z.string(),
                                feature_type: z.string(),
                                has_options: z.boolean(),
                                options: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Feature not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                // ✅ Check if feature exists
                const existing = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.GetEmployeeOnboardingFeature({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.feature);
                    });
                });

                if (!existing) return c.json({ error: 'Feature not found' }, 404);

                const parsed = createOnboardingFeatureSchema
                    .partial()
                    .extend({ step_id: z.string({ required_error: 'Step ID is required' }) })
                    .parse(body);

                const response = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.UpdateEmployeeOnboardingFeature(
                        { id, ...parsed },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp.feature);
                        }
                    );
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

    // 🔴 Delete Feature
    app.openapi(
        {
            method: 'delete',
            path: '/employee-onboarding-features/{id}',
            tags: ['Employee Onboarding Features'],
            summary: 'Delete an onboarding feature by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Feature ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Feature deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Feature not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const existing = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.GetEmployeeOnboardingFeature({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.feature);
                    });
                });

                if (!existing) return c.json({ error: 'Feature not found' }, 404);

                const response = await new Promise((resolve, reject) => {
                    onboardingFeatureClient.DeleteEmployeeOnboardingFeature({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeOnboardingFeature API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
