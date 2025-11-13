import { z, ZodError } from 'zod';
import { assetClient } from '../grpc/assets.client.js';

export default function registerAssetRoutes(app) {
    // ✅ Schema for creating Asset
    const createAssetSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        category_id: z.string({ required_error: 'Category ID is required' }),
        model_id: z.string({ required_error: 'Model ID is required' }),
        serial_number: z.string({ required_error: 'Serial number is required' }),
        asset_tag: z.string({ required_error: 'Asset tag is required' }),
        user_name: z.string({ required_error: 'User name is required' }),
        password: z.string({ required_error: 'Password is required' }),
        purchase_date: z.string({ required_error: 'Purchase date is required' }),
        warranty_expire: z.string({ required_error: 'Warranty expire is required' }),
        status: z.string({ required_error: 'Status is required' }),
        location: z.string({ required_error: 'Location is required' }),
    });

    // 🟢 Create Asset
    app.openapi(
        {
            method: 'post',
            path: '/assets',
            tags: ['Assets'],
            summary: 'Create a new asset',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createAssetSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                model_id: z.string(),
                                serial_number: z.string(),
                                asset_tag: z.string(),
                                user_name: z.string(),
                                password: z.string(),
                                purchase_date: z.string(),
                                warranty_expire: z.string(),
                                status: z.string(),
                                location: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
                                deleted_at: z.string(),
                            }),
                        },
                    },
                },
            },
            400: {
                description: 'Validation error',
                content: {
                    'application/json': { schema: z.object({ message: z.string() }) },
                }
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createAssetSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetClient.createAsset(parsed, (error, response) => {
                        if (error) {
                            reject(error);
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
        },
    );

    // 🟢 Get Assets By ID
    app.openapi(
        {
            method: 'get',
            path: '/assets/{id}',
            tags: ['Assets'],
            summary: 'Get an asset by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset retrieved successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                model_id: z.string(),
                                serial_number: z.string(),
                                asset_tag: z.string(),
                                user_name: z.string(),
                                password: z.string(),
                                purchase_date: z.string(),
                                warranty_expire: z.string(),
                                status: z.string(),
                                location: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
                                deleted_at: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Asset not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                500: {
                    description: 'Internal server error',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetClient.GetAsset({id}, (err, resp) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(resp);
                        }
                    });
                })
                if (!response) return c.json({ error: 'Assets not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        },
    );

    // 🟢 List All Assets
    app.openapi(
        {
            method: 'get',
            path: '/assets',
            tags: ['Assets'],
            summary: 'List all assets',
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
                    description: 'Assets retrieved successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                assets: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        model_id: z.string(),
                                        serial_number: z.string(),
                                        asset_tag: z.string(),
                                        user_name: z.string(),
                                        password: z.string(),
                                        purchase_date: z.string(),
                                        warranty_expire: z.string(),
                                        status: z.string(),
                                        location: z.string(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                        deleted_at: z.string(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Organization not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                500: {
                    description: 'Internal server error',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    assetClient.ListAssets({
                        organization_id: query.organization_id,
                        search: query.search,
                        page: query.page,
                        limit: query.limit,
                        sort_by: query.sort_by,
                        sort_order: query.sort_order,
                    }, (err, resp) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(resp);
                    }
                    })
                });

                if (!response) return c.json({ error: 'Organization not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        },
    );

    const UpdateAssetSchema = createAssetSchema.extend({
        id: z.string({ required_error: 'Asset ID is required' })
    }).partial();

    // 🟢 Update Asset
    app.openapi(
        {
            method: 'put',
            path: '/assets/{id}',
            tags: ['Assets'],
            summary: 'Update an asset',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: UpdateAssetSchema.omit({ id: true }) },
                    },
                }
            },
            responses: {
                200: {
                    description: 'Asset updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                model_id: z.string(),
                                serial_number: z.string(),
                                asset_tag: z.string(),
                                user_name: z.string(),
                                password: z.string(),
                                purchase_date: z.string(),
                                warranty_expire: z.string(),
                                status: z.string(),
                                location: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
                                deleted_at: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Asset not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                500: {
                    description: 'Internal server error',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
        async (c) => {
            try {

                const id = c.req.param('id');
                const rawBody = await c.req.json();

                const parsed = UpdateAssetSchema.parse(rawBody);

                const payload = {
                    id: id, // always trust the path param, not body
                    organization_id: parsed.organization_id ?? "",
                    category_id: parsed.category_id ?? "",
                    model_id: parsed.model_id ?? "",
                    serial_number: parsed.serial_number ?? "",
                    asset_tag: parsed.asset_tag ?? "",
                    user_name: parsed.user_name ?? "",
                    password: parsed.password ?? "",
                    purchase_date: parsed.purchase_date ? new Date(parsed.purchase_date).toISOString() : "",
                    warranty_expire: parsed.warranty_expire ? new Date(parsed.warranty_expire).toISOString() : "",
                    status: parsed.status ?? "",
                    location: parsed.location ?? "",
                };;

                const response = await new Promise((resolve, reject) => {
                    assetClient.UpdateAsset(payload, (err, resp) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(resp);
                    });
                });

                if (!response) {
                    return c.json({ message: 'Asset not found' }, 404);
                }

                return c.json(response);

            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        },
    );

    //Delete Asset by ID
    app.openapi(
        {
            method: 'delete',
            path: '/assets/{id}',
            tags: ['Assets'],
            summary: 'Delete an asset',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Asset ID is required' }),
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
                404: {
                    description: 'Asset not found',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
                500: {
                    description: 'Internal server error',
                    content: {
                        'application/json': { schema: z.object({ message: z.string() }) },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetClient.DeleteAsset({ id: id }, (err, resp) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(resp);
                    });
                });
                if (!response) {
                    return c.json({ message: 'Asset not found' }, 404);
                }
                return c.json(response);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

}