import { z, ZodError } from 'zod';
import { assetCategoryClient } from '../grpc/asset_category.client.js';

export default function registerAssetCategoryRoutes(app) {
    // ✅ Schema for creating Asset Category
    const createAssetCategorySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z
            .string({ required_error: 'Category name is required' }),
        code: z.string().optional(),
        description: z.string().optional(),
        is_active: z.boolean().default(true),
    });

    // 🟢 Create Asset Category
    app.openapi(
        {
            method: 'post',
            path: '/asset-categories',
            tags: ['Asset Categories'],
            summary: 'Create a new asset category',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createAssetCategorySchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Asset Category created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                code: z.string().nullable(),
                                description: z.string().nullable(),
                                is_active: z.boolean(),
                                created_at: z.string(),
                                updated_at: z.string(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                409: { description: 'Category name already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createAssetCategorySchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    assetCategoryClient.createAssetCategory(parsed, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
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

    // 🟣 Get Asset Category by ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-categories/{id}',
            tags: ['Asset Categories'],
            summary: 'Get an asset category by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Category ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Asset Category found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                name: z.string(),
                                code: z.string().nullable(),
                                description: z.string().nullable(),
                                is_active: z.boolean(),
                                created_at: z.string(),
                                updated_at: z.string(),
                                deleted_at: z.string().nullable(),
                            }),
                        },
                    },
                },
                404: { description: 'Asset Category not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetCategoryClient.getAssetCategory({ id }, (err, res) => {
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

    // 🟡 List Asset categories — Paginated + Search + Sort
    app.openapi(
        {
            method: 'get',
            path: '/asset-categories',
            tags: ['Asset Categories'],
            summary: 'List asset categories',
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
                    description: 'Asset categories found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                categories: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        name: z.string(),
                                        code: z.string().nullable(),
                                        description: z.string().nullable(),
                                        is_active: z.boolean(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                        deleted_at: z.string().nullable(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
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
                    assetCategoryClient.listAssetCategories(
                        {
                            organization_id: query.organization_id,
                            search: query.search,
                            page: query.page,
                            limit: query.limit,
                            sort_by: query.sort_by,
                            sort_order: query.sort_order,
                        }, (err, res) => {
                            if (err) return reject(err);
                            resolve(res);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    const UpdateAssetCategorySchema = createAssetCategorySchema
        .extend({ id: z.string({ required_error: 'Category ID is required' }) }).partial();

    // 🟤 Update Asset Category by ID
    app.openapi(
        {
            method: 'put',
            path: '/asset-categories/{id}',
            tags: ['Asset Categories'],
            summary: 'Update an asset category by ID',
            request: {
                params: z.object({ id: z.string() }),
                body: {
                    content: {
                        'application/json': { schema: UpdateAssetCategorySchema.omit({ id: true }) },
                    },
                },
            },
            responses: {
                200: {
                    descriptiom: 'Asset Category updated successfully',
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = UpdateAssetCategorySchema.parse({ ...body, id });

                const grpcPayload = {
                    id,
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    code: parsed.code,
                    description: parsed.description,
                    is_active: parsed.is_active,
                };

                const response = await new Promise((resolve, reject) => {
                    assetCategoryClient.updateAssetCategory(grpcPayload, (err, res) => {
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

    // 🟠 Delete Asset Category by ID
    app.openapi(
        {
            method: 'delete',
            path: '/asset-categories/{id}',
            tags: ['Asset Categories'],
            summary: 'Delete an asset category by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Category ID is required' }),
                }),
            },
            responses: { // ✅ Correct place for HTTP responses
                200: {
                    description: 'Asset Category deleted successfully',
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
                    description: 'Asset Category not found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Internal server error',
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
                const { id } = c.req.valid('params');
                const response = await new Promise((resolve, reject) => {
                    assetCategoryClient.deleteAssetCategory({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

}
