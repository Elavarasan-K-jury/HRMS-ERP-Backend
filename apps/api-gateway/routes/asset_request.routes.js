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

    app.openapi(
        {
            method: 'put',
            path: '/asset-requests/{id}/status',
            tags: ['Asset Requests'],
            summary: 'Approve or reject an asset request',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Request ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                approved_by: z.string().optional(),
                                status: z.enum(['APPROVED', 'REJECTED'], { required_error: 'Status must be APPROVED or REJECTED' }),
                                approved_at: z.string().optional(),
                                rejection_reason: z.string().optional(),
                            })
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset Request updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                request: z.any(),
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
                            schema: z.object({ message: z.string() }),
                        },
                    },
                },
                409: {
                    description: 'Business Rule Conflict',
                    content: {
                        'application/json': {
                            schema: z.object({ message: z.string() }),
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
                    assetRequestClient.ApproveRejectAssetRequest({
                        id,
                        status: body.status,
                        approved_by: body.approved_by || '',
                        approved_at: body.approved_at || '',
                        rejection_reason: body.rejection_reason || '',
                    }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json(response);
            } catch (err) {
                const msg = err?.details || err?.message || 'Internal server error';
                const code = err?.code === 9 ? 409 : err?.code === 5 ? 404 : 500;
                return c.json({ success: false, message: msg }, code);
            }
        }
    );

    // Phase 06: Assign physical asset to approved request
    app.openapi(
        {
            method: 'post',
            path: '/asset-requests/{id}/assign',
            tags: ['Asset Requests'],
            summary: 'Assign a physical asset to an approved request',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Request ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                asset_id: z.string({ required_error: 'Asset ID is required' }),
                                assigned_date: z.string().optional(),
                                condition_assign: z.string().optional(),
                                notes: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset assigned to request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assignment: z.any(),
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
                            schema: z.object({ message: z.string() }),
                        },
                    },
                },
                409: {
                    description: 'Business Rule Conflict',
                    content: {
                        'application/json': {
                            schema: z.object({ message: z.string() }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.AssignAssetToRequest({
                        request_id: id,
                        asset_id: body.asset_id,
                        assigned_date: body.assigned_date || '',
                        condition_assign: body.condition_assign || '',
                        notes: body.notes || '',
                    }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json(response);
            } catch (err) {
                const msg = err?.details || err?.message || 'Internal server error';
                const code = err?.code === 9 ? 409 : err?.code === 5 ? 404 : 500;
                return c.json({ success: false, message: msg }, code);
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

    // Phase 05: Employee self-service — create asset request
    app.openapi(
        {
            method: 'post',
            path: '/employee-assets/request',
            tags: ['Asset Requests'],
            summary: 'Employee: submit an asset request',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string({ required_error: 'Organization ID is required' }),
                                category_id: z.string().optional(),
                                model_id: z.string().optional(),
                                reason: z.string().optional(),
                                quantity: z.number().optional(),
                                priority: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset request created',
                    content: {
                        'application/json': {
                            schema: z.object({
                                request: z.any(),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) {
                    return c.json({ success: false, message: 'Unauthorized' }, 401);
                }

                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.createAssetRequest({
                        organization_id: body.organization_id,
                        employee_id: employeeId,
                        category_id: body.category_id || '',
                        model_id: body.model_id || '',
                        reason: body.reason || '',
                        quantity: body.quantity || 1,
                        priority: body.priority || 'MEDIUM',
                    }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json(response, 201);
            } catch (err) {
                return c.json({ success: false, message: err.message }, 500);
            }
        }
    );

    // Phase 05: Employee self-service — list my requests
    app.openapi(
        {
            method: 'get',
            path: '/employee-assets/my-requests',
            tags: ['Asset Requests'],
            summary: 'Employee: list my asset requests',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    page: z.coerce.number().optional().default(1),
                    limit: z.coerce.number().optional().default(20),
                }),
            },
            responses: {
                200: {
                    description: 'My asset requests',
                    content: {
                        'application/json': {
                            schema: z.object({
                                requests: z.array(z.any()),
                                total: z.number(),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) {
                    return c.json({ success: false, message: 'Unauthorized' }, 401);
                }

                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    assetRequestClient.listAssetRequests({
                        organization_id: query.organization_id,
                        employee_id: employeeId,
                        page: query.page,
                        limit: query.limit,
                        sort_by: 'created_at',
                        sort_order: 'desc',
                    }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json({
                    requests: response.requests || [],
                    total: response.total || 0,
                    success: true,
                    message: 'My asset requests fetched successfully',
                }, 200);
            } catch (err) {
                return c.json({ success: false, message: err.message }, 500);
            }
        }
    );
}