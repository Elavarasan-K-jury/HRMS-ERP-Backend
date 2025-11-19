import { z, ZodError } from 'zod';
import { assetAssignmentClient } from '../grpc/asset_assignment.client.js';

export default function registerAssetAssignmentRoutes(app) {
    const CreateAssetAssignmentSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        asset_id: z.string({ required_error: 'Asset ID is required' }),
        employee_id: z.string({ required_error: 'Employee ID is required' }),
        assigned_date: z.string({ required_error: 'Assigned Date is required' }),
        return_date: z.string().optional(),
        condition_assign: z.string().optional(),
        status: z.string().default('Active'),
        notes: z.string().optional(),
    });

    // 🟢 Create Asset Assignment
    app.openapi(
        {
            method: 'post',
            path: '/asset-assignments',
            tags: ['Asset Assignments'],
            summary: 'Create a new asset assignment',
            request: {
                body: {
                    content: {
                        'application/json': { schema: CreateAssetAssignmentSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset assignment created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assetAssignment: z.object({
                                    id: z.string(),
                                    organizationId: z.string(),
                                    assetId: z.string(),
                                    employeeId: z.string(),
                                    assignedDate: z.string(),
                                    returnDate: z.string().optional(),
                                    conditionAssign: z.string().optional(),
                                    status: z.string(),
                                    notes: z.string().optional(),
                                    createdAt: z.string(),
                                    updatedAt: z.string(),
                                    deletedAt: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    }
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
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = CreateAssetAssignmentSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetAssignmentClient.createAssetAssignment(parsed, (err, response) => {
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

    //Get Asset Assignment By ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-assignments/{id}',
            tags: ['Asset Assignments'],
            summary: 'Get an asset assignment by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Assignement ID is required' }),
                })
            },
            responses: {
                200: {
                    description: 'Asset assignment found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assetAssignment: z.object({
                                    id: z.string(),
                                    organizationId: z.string(),
                                    assetId: z.string(),
                                    employeeId: z.string(),
                                    assignedDate: z.string(),
                                    returnDate: z.string().optional(),
                                    conditionAssign: z.string().optional(),
                                    status: z.string(),
                                    notes: z.string().optional(),
                                    createdAt: z.string(),
                                    updatedAt: z.string(),
                                    deletedAt: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Asset assignment not found',
                    content: {
                        'application/json': {
                            schema: z.object({
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
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetAssignmentClient.getAssetAssignment({ id }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //List Asset Assignments
    app.openapi(
        {
            method: 'get',
            path: '/asset-assignments',
            tags: ['Asset Assignments'],
            summary: 'List all asset assignments',
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
                    description: 'List of asset assignments',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assetAssignments: z.array(z.object({
                                    id: z.string(),
                                    organizationId: z.string(),
                                    assetId: z.string(),
                                    employeeId: z.string(),
                                    assignedDate: z.string(),
                                    returnDate: z.string().optional(),
                                    conditionAssign: z.string().optional(),
                                    status: z.string(),
                                    notes: z.string().optional(),
                                    createdAt: z.string(),
                                    updatedAt: z.string(),
                                    deletedAt: z.string().optional(),
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
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    assetAssignmentClient.listAssetAssignments({
                        organization_id: query.organization_id,
                        search: query.search,
                        page: query.page,
                        limit: query.limit,
                        sort_by: query.sort_by,
                        sort_order: query.sort_order,
                    }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //Update Asset Assignment
    app.openapi(
        {
            method: 'put',
            path: '/asset-assignments/{id}',
            tags: ['Asset Assignments'],
            summary: 'Update an asset assignment',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Assignement ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: CreateAssetAssignmentSchema },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset assignment updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assetAssignment: z.object({
                                    id: z.string(),
                                    organizationId: z.string(),
                                    assetId: z.string(),
                                    employeeId: z.string(),
                                    assignedDate: z.string(),
                                    returnDate: z.string().optional(),
                                    conditionAssign: z.string().optional(),
                                    status: z.string(),
                                    notes: z.string().optional(),
                                    createdAt: z.string(),
                                    updatedAt: z.string(),
                                    deletedAt: z.string().optional(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Asset assignment not found',
                    content: {
                        'application/json': {
                            schema: z.object({
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
                const id = c.req.param('id');
                const body = await c.req.json();
                const payload = CreateAssetAssignmentSchema.safeParse({
                    id,
                    ...body
                });

                const response = await new Promise((resolve, reject) => {
                    assetAssignmentClient.updateAssetAssignment({ id, ...payload.data }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //Delete Asset Assignment By ID
    app.openapi(
        {
            method: 'delete',
            path: '/asset-assignments/{id}',
            tags: ['Asset Assignments'],
            summary: 'Delete an asset assignment',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset Assignement ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset assignment deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Asset assignment not found',
                    content: {
                        'application/json': {
                            schema: z.object({
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
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetAssignmentClient.deleteAssetAssignment({ id }, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );
}
