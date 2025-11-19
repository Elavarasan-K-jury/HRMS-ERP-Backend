import { z, ZodError } from 'zod';
import { assetRequestClient } from '../grpc/asset_request.client.js';

export default function registerAssetRequestRoutes(app) {
    const CreateAssetRequestSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        category_id: z.string({ required_error: 'Category ID is required' }),
        model_id: z.string({ required_error: 'Model ID is required' }),
        employee_id: z.string({ required_error: 'Employee ID is required' }),
        reason: z.string({ required_error: 'Reason is required' }),
        quantity: z.number().optional(),
        priority: z.string().optional(),
        status: z.string().optional(),
        approved_by: z.string().optional(),
        approved_at: z.string().optional(),
        rejection_reason: z.string().optional(),
    });

    // 🟢 Create Asset Request
    app.openapi(
        {
            method: 'post',
            path: '/asset-requests',
            tags: ['Asset Requests'],
            summary: 'Create a new asset request',
            request: {
                body: {
                    content: {
                        'application/json': { schema: CreateAssetRequestSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset Request created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                request: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    category_id: z.string(),
                                    model_id: z.string(),
                                    employee_id: z.string(),
                                    approved_by: z.string().optional(),
                                    reason: z.string(),
                                    quantity: z.number().optional(),
                                    priority: z.string().optional(),
                                    status: z.string().optional(),
                                    approved_at: z.string().optional(),
                                    rejection_reason: z.string().optional(),
                                    created_at: z.string(),
                                    updated_at: z.string(),
                                    deleted_at: z.string().nullable(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            })
                        }
                    }
                },
                400: {
                    description: 'Validation Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                }
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = CreateAssetRequestSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.createAssetRequest(parsed, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });
                return c.json(response);
            } catch (err) {
                if (err instanceof ZodError) {
                    return c.json({ message: err.message }, 400);
                }
                return c.json({ message: err.message }, 500);
            }
        }
    );

    //Get Asset Request by ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-requests/{id}',
            tags: ['Asset Requests'],
            summary: 'Get an asset request by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Request ID is required' }),
                })
            },
            responses: {
                200: {
                    description: 'Asset Request found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                request: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    category_id: z.string(),
                                    model_id: z.string(),
                                    employee_id: z.string(),
                                    approved_by: z.string().optional(),
                                    reason: z.string(),
                                    quantity: z.number(),
                                    priority: z.string(),
                                    status: z.string(),
                                    approved_at: z.string().optional(),
                                    rejection_reason: z.string().optional(),
                                    created_at: z.string(),
                                    updated_at: z.string(),
                                    deleted_at: z.string().nullable()
                                }),
                                success: z.boolean(),
                                message: z.string()
                            })

                        },
                    },
                },
                404: {
                    description: 'Asset Request not found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.getAssetRequest({ id }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                if (!response.request) {
                    return c.json({ message: 'Asset Request not found' }, 404);
                }

                return c.json(response);
            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );

    //List All Request
    app.openapi(
        {
            method: 'get',
            path: '/asset-requests',
            tags: ['Asset Requests'],
            summary: 'List all asset requests',
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
                    description: 'Asset Requests found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                requests: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        model_id: z.string(),
                                        employee_id: z.string(),
                                        approved_by: z.string().optional(),
                                        reason: z.string(),
                                        quantity: z.number(),
                                        priority: z.string(),
                                        status: z.string(),
                                        approved_at: z.string().optional(),
                                        rejection_reason: z.string().optional(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                        deleted_at: z.string().nullable(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                                success: z.boolean(),
                                message: z.string(),
                            })

                        },
                    },
                },
                400: {
                    description: 'Validation Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Internal Server Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
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
                    assetRequestClient.listAssetRequests({
                        organization_id: query.organization_id,
                        search: query.search,
                        page: query.page,
                        limit: query.limit,
                        sort_by: query.sort_by,
                        sort_order: query.sort_order,
                    }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                if (!response.requests || response.requests.length === 0) {
                    return c.json({ message: 'Asset Request not found' }, 404);
                }

                return c.json(response);

            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }

    );

    //Update Assset request
    app.openapi(
        {
            method: 'put',
            path: '/asset-requests/{id}',
            tags: ['Asset Requests'],
            summary: 'Update asset request',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Request ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: CreateAssetRequestSchema },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset Request updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                request: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    category_id: z.string(),
                                    model_id: z.string(),
                                    employee_id: z.string(),
                                    approved_by: z.string().optional(),
                                    reason: z.string(),
                                    quantity: z.number(),
                                    priority: z.string(),
                                    status: z.string(),
                                    approved_at: z.string().optional(),
                                    rejection_reason: z.string().optional(),
                                    created_at: z.string(),
                                    updated_at: z.string(),
                                    deleted_at: z.string().nullable(),
                                }),
                                success: z.boolean(),
                                message: z.string()
                            })

                        },
                    },
                },
                400: {
                    description: 'Validation Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Internal Server Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                if (!id) {
                    return c.json({ message: 'Asset Request ID is required' }, 400);
                }

                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.updateAssetRequest({ id, ...body }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                if (!response.request) {
                    return c.json({ message: 'Asset Request not found' }, 404);
                }

                return c.json(response);

            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );

    //Delete Asset Request
    app.openapi(
        {
            method: 'delete',
            path: '/asset-requests/{id}',
            tags: ['Asset Requests'],
            summary: 'Delete asset request',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Request ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Request deleted successfully',
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
                    description: 'Validation Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Internal Server Error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                if (!id) {
                    return c.json({ message: 'Asset Request ID is required' }, 400);
                }

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.deleteAssetRequest({ id }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                if (!response.success) {
                    return c.json({ message: 'Asset Request not found' }, 404);
                }

                return c.json(response);

            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );
}