import { z, ZodError } from 'zod';
import { assetConditionClient } from '../grpc/asset_condition.client.js';

export default function registerAssetConditionRoutes(app) {
    const CreateAssetConditionSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        assignment_id: z.string({ required_error: 'Assignment ID is required' }),
        employee_id: z.string({ required_error: 'Employee ID is required' }),
        acknowledged_by: z.string().optional(),
        report_date: z.string().optional(),
        description: z.string().optional(),
        ratings: z.string().optional(),
        images: z.string().optional(),
        action_taken: z.string().optional(),
        acknowledged_date: z.string().optional(),
        status: z.string().optional(),
    });

    // 🟢 Create Asset Condition
    app.openapi(
        {
            method: 'post',
            path: '/asset-conditions',
            tags: ['Asset Conditions'],
            summary: 'Create a new asset condition',
            request: {
                body: {
                    content: {
                        'application/json': { schema: CreateAssetConditionSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset Condition created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                condition: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    assignment_id: z.string(),
                                    employee_id: z.string(),
                                    acknowledged_by: z.string().optional(),
                                    report_date: z.string().optional(),
                                    description: z.string().optional(),
                                    ratings: z.string().optional(),
                                    images: z.string().optional(),
                                    action_taken: z.string().optional(),
                                    acknowledged_date: z.string().optional(),
                                    status: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = CreateAssetConditionSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetConditionClient.createAssetCondition(parsed, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //Get Asset Condition By ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-conditions/{id}',
            tags: ['Asset Conditions'],
            summary: 'Get asset condition by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Condition ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Condition fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                condition: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    assignment_id: z.string(),
                                    employee_id: z.string(),
                                    acknowledged_by: z.string().optional(),
                                    report_date: z.string().optional(),
                                    description: z.string().optional(),
                                    ratings: z.string().optional(),
                                    images: z.string().optional(),
                                    action_taken: z.string().optional(),
                                    acknowledged_date: z.string().optional(),
                                    status: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetConditionClient.getAssetCondition({ id }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //List All Asset Condition 
    app.openapi(
        {
            method: 'get',
            path: '/asset-conditions',
            tags: ['Asset Conditions'],
            summary: 'List all asset conditions',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    search: z.string().optional(),
                    page: z.coerce.number().optional().default(1),
                    limit: z.coerce.number().optional().default(10),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Condition fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                conditions: z.array(z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    assignment_id: z.string(),
                                    employee_id: z.string(),
                                    acknowledged_by: z.string().optional(),
                                    report_date: z.string().optional(),
                                    description: z.string().optional(),
                                    ratings: z.string().optional(),
                                    images: z.string().optional(),
                                    action_taken: z.string().optional(),
                                    acknowledged_date: z.string().optional(),
                                    status: z.string().optional(),
                                })),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            }
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    assetConditionClient.listAssetConditions(query, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );

    const UpdateAssetConditionBodySchema = CreateAssetConditionSchema.partial();

    // 🟢 Update Asset Condition
    app.openapi(
        {
            method: 'put',
            path: '/asset-conditions/{id}',
            tags: ['Asset Conditions'],
            summary: 'Update an asset condition',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Condition ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: UpdateAssetConditionBodySchema,   // ← Clean, correct
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset Condition updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                condition: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    assignment_id: z.string(),
                                    employee_id: z.string(),
                                    acknowledged_by: z.string().optional(),
                                    report_date: z.string().optional(),
                                    description: z.string().optional(),
                                    ratings: z.string().optional(),
                                    images: z.string().optional(),
                                    action_taken: z.string().optional(),
                                    acknowledged_date: z.string().optional(),
                                    status: z.string().optional(),
                                    created_at: z.string().optional(),
                                    updated_at: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                // This will now work perfectly
                const parsed = UpdateAssetConditionBodySchema.parse(body);

                const payload = {
                    id,
                    organization_id: parsed.organization_id,
                    assignment_id: parsed.assignment_id,
                    employee_id: parsed.employee_id,
                    acknowledged_by: parsed.acknowledged_by,
                    report_date: parsed.report_date,
                    description: parsed.description,
                    ratings: parsed.ratings,
                    images: parsed.images,
                    action_taken: parsed.action_taken,
                    acknowledged_date: parsed.acknowledged_date,
                    status: parsed.status,
                };

                const response = await new Promise((resolve, reject) => {
                    assetConditionClient.updateAssetCondition(payload, (err, res) => {
                        if (err) reject(err);
                        else resolve(res);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.errors.map(e => ({ path: e.path, message: e.message })) }, 400);
                }
                return c.json({ message: error.message || 'Internal server error' }, 500);
            }
        }
    );

    // 🟢 Delete Asset Condition
    app.openapi(
        {
            method: 'delete',
            path: '/asset-conditions/{id}',
            tags: ['Asset Conditions'],
            summary: 'Delete an asset condition',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Condition ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Condition deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetConditionClient.deleteAssetCondition(id, (err, res) => {
                        if (err) reject(err);
                        else resolve(res);
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message || 'Internal server error' }, 500);
            }
        }
    );  
    
}