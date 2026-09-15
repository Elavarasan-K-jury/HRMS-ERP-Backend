import { z, ZodError } from 'zod';
import { assetIdSeriesClient } from '../grpc/asset_id_series.client.js';

export default function registerAssetIdSeriesRoutes(app) {
    const createSeriesSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z.string({ required_error: 'Series name is required' }),
        prefix: z.string().optional().default(''),
        digits: z.number().optional().default(6),
        suffix: z.string().optional().default(''),
        is_active: z.boolean().optional().default(true),
    });

    const updateSeriesSchema = z.object({
        organization_id: z.string().optional(),
        name: z.string().optional(),
        prefix: z.string().optional(),
        digits: z.number().optional(),
        suffix: z.string().optional(),
        is_active: z.boolean().optional(),
    });

    const generateIdSchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        series_id: z.string({ required_error: 'Series ID is required' }),
        preview_only: z.boolean().optional().default(false),
    });

    // Create
    app.openapi(
        {
            method: 'post',
            path: '/asset-id-series',
            tags: ['Asset ID Series'],
            summary: 'Create an asset ID series',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createSeriesSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Series created successfully' },
                400: { description: 'Validation error' },
                409: { description: 'Series name already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSeriesSchema.parse(body);
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.createAssetIdSeries(parsed, (err, res) => {
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

    // List
    app.openapi(
        {
            method: 'get',
            path: '/asset-id-series',
            tags: ['Asset ID Series'],
            summary: 'List asset ID series',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    page: z.string().optional(),
                    limit: z.string().optional(),
                    search: z.string().optional(),
                    sort_by: z.string().optional(),
                    sort_order: z.string().optional(),
                }),
            },
            responses: {
                200: { description: 'Series list fetched successfully' },
            },
        },
        async (c) => {
            try {
                const query = c.req.query();
                const params = {
                    organization_id: query.organization_id,
                    page: parseInt(query.page || '1'),
                    limit: parseInt(query.limit || '10'),
                    search: query.search || '',
                    sort_by: query.sort_by || 'created_at',
                    sort_order: query.sort_order || 'desc',
                };
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.listAssetIdSeries(params, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    // Get by ID
    app.openapi(
        {
            method: 'get',
            path: '/asset-id-series/{id}',
            tags: ['Asset ID Series'],
            summary: 'Get asset ID series by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Series ID is required' }),
                }),
            },
            responses: {
                200: { description: 'Series found' },
                404: { description: 'Series not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.getAssetIdSeries({ id }, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    // Update
    app.openapi(
        {
            method: 'put',
            path: '/asset-id-series/{id}',
            tags: ['Asset ID Series'],
            summary: 'Update asset ID series',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Series ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: updateSeriesSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Series updated successfully' },
                404: { description: 'Series not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.updateAssetIdSeries({ id, ...body }, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    // Delete
    app.openapi(
        {
            method: 'delete',
            path: '/asset-id-series/{id}',
            tags: ['Asset ID Series'],
            summary: 'Delete asset ID series',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Series ID is required' }),
                }),
            },
            responses: {
                200: { description: 'Series deleted successfully' },
                404: { description: 'Series not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.deleteAssetIdSeries({ id }, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response);
            } catch (error) {
                return c.json({ message: error.message }, 500);
            }
        }
    );

    // Generate Asset ID
    app.openapi(
        {
            method: 'post',
            path: '/asset-id-series/generate',
            tags: ['Asset ID Series'],
            summary: 'Generate next asset ID from a series',
            request: {
                body: {
                    content: {
                        'application/json': { schema: generateIdSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Asset ID generated successfully' },
                404: { description: 'Series not found' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = generateIdSchema.parse(body);
                const response = await new Promise((resolve, reject) => {
                    assetIdSeriesClient.generateAssetId(parsed, (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    });
                });
                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );
}
