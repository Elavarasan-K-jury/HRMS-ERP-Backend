import { z, ZodError } from 'zod';
import { assetModelClient } from '../grpc/asset_model.client.js';

export default function registerAssetModelRoutes(app) {
    const CreateAssetModelSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        category_id: z.string({ required_error: 'Category ID is required' }),
        brand: z.string({ required_error: 'Brand is required' }),
        model_name: z.string({ required_error: 'Model name is required' }),
        code: z.string().optional(),
        description: z.string().optional(),
        specs: z.string().optional(),
        is_active: z.boolean().default(true),
    });

    // 🟢 Create Asset Model
    app.openapi(
        {
            method: 'post',
            path: '/asset-models',
            tags: ['Asset Models'],
            summary: 'Create a new asset model',
            request: {
                body: {
                    content: {
                        'application/json': { schema: CreateAssetModelSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset Model created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                model: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                brand: z.string(),
                                model_name: z.string(),
                                code: z.string(),
                                description: z.string(),
                                specs: z.string(),
                                is_active: z.boolean(),
                                created_at: z.string(),
                                updated_at: z.string(),
                                    deleted_at: z.string(),
                                }),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    }
                },
                400: {
                    description: 'Bad Request',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            })
                        },
                    },
                },
                409: { description: 'Asset Model already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = CreateAssetModelSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetModelClient.createAssetModel(parsed, (error, response) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(response);
                        }
                    });
                });

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                } else {
                    return c.json({ message: error.message }, 500);
                }
            }
        }
    );

    // 🟣 Get Asset Model by ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-models/{id}',
            tags: ['Asset Models'],
            summary: 'Get an asset model by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Model ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Model retrieved successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                model: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    category_id: z.string(),
                                    brand: z.string(),
                                    model_name: z.string(),
                                    code: z.string().nullable(),
                                    description: z.string().nullable(),
                                    specs: z.string().nullable(),
                                    is_active: z.boolean(),
                                    created_at: z.string(),
                                    updated_at: z.string(),
                                    deleted_at: z.string().nullable(),
                                }),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                404: { description: 'Asset Model not found' },
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    assetModelClient.getAssetModel({ id }, (error, response) => {
                        if (error) return reject(error);
                        resolve(response);
                    });
                });

                if (!response.model) {
                    return c.json({ message: 'Asset Model not found' }, 404);
                }

                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //🟡 List all Asset Models
    app.openapi(
        {
            method: 'get',
            path: '/asset-models',
            tags: ['Asset Models'],
            summary: 'List all asset models',
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
                    description: 'Asset Models retrieved successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                models: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        brand: z.string(),
                                        model_name: z.string(),
                                        code: z.string().nullable(),
                                        description: z.string().nullable(),
                                        specs: z.string().nullable(),
                                        is_active: z.boolean(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                        deleted_at: z.string().nullable(),
                                    })
                                ),
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
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    assetModelClient.listAssetModels(query, (error, response) => {
                        if (error) return reject(error);
                        resolve(response);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    // 🟣 Update Asset Model
    const UpdateAssetModelSchema = CreateAssetModelSchema.partial(); 

    app.openapi(
        {
            method: 'put',
            path: '/asset-models/{id}', // 👈 OpenAPI path param format
            tags: ['Asset Models'],
            summary: 'Update an asset model',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Model ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: UpdateAssetModelSchema },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Asset Model updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                model: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    category_id: z.string(),
                                    brand: z.string(),
                                    model_name: z.string(),
                                    code: z.string().nullable(),
                                    description: z.string().nullable(),
                                    specs: z.string().nullable(),
                                    is_active: z.boolean(),
                                    created_at: z.string(),
                                    updated_at: z.string(),
                                    deleted_at: z.string().nullable(),
                                }),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                404: { description: 'Asset Model not found' },
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                if (!id) {
                    return c.json({ message: 'Model ID is missing in path' }, 400);
                }

                const body = await c.req.json();
                const parsed = UpdateAssetModelSchema.parse(body);

                const grpcPayload = {
                    id,
                    ...parsed,
                };

                const response = await new Promise((resolve, reject) => {
                    assetModelClient.updateAssetModel(grpcPayload, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
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

    // 🟤 Delete Asset Model
    app.openapi(
        {
            method: 'delete',
            path: '/asset-models/{id}', // 👈 OpenAPI path param format
            tags: ['Asset Models'],
            summary: 'Delete an asset model',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Model ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Model deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                success: z.boolean().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Asset Model not found' },
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetModelClient.deleteAssetModel({ id }, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

}
