import { z, ZodError } from 'zod';
import { assetAttributeDefinitionClient } from '../grpc/asset_attribute_definition.client.js';

export default function registerAssetAttributeDefinitionRoutes(app) {
    const createSchema = z.object({
        asset_model_id: z.string({ required_error: 'Asset Model ID is required' }),
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        label: z.string({ required_error: 'Label is required' }),
        key: z.string().optional().default(''),
        field_type: z.enum(['TEXTBOX', 'NUMBER', 'DATE', 'DROPDOWN', 'TEXTAREA', 'MULTI_SELECT'], {
            required_error: 'Field type is required',
        }),
        options: z.string().optional().default(''),
        is_mandatory: z.boolean().optional().default(false),
        is_unique: z.boolean().optional().default(false),
        display_order: z.number().optional().default(0),
    });

    const updateSchema = z.object({
        label: z.string().optional(),
        key: z.string().optional(),
        field_type: z.enum(['TEXTBOX', 'NUMBER', 'DATE', 'DROPDOWN', 'TEXTAREA', 'MULTI_SELECT']).optional(),
        options: z.string().optional(),
        is_mandatory: z.boolean().optional(),
        is_unique: z.boolean().optional(),
        display_order: z.number().optional(),
    });

    const syncSchema = z.object({
        asset_model_id: z.string({ required_error: 'Asset Model ID is required' }),
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        definitions: z.array(z.object({
            id: z.string().optional().default(''),
            label: z.string(),
            key: z.string().optional().default(''),
            field_type: z.enum(['TEXTBOX', 'NUMBER', 'DATE', 'DROPDOWN', 'TEXTAREA', 'MULTI_SELECT']),
            options: z.string().optional().default(''),
            is_mandatory: z.boolean().optional().default(false),
            is_unique: z.boolean().optional().default(false),
            display_order: z.number().optional().default(0),
        })),
    });

    // Create
    app.openapi(
        {
            method: 'post',
            path: '/asset-attribute-definitions',
            tags: ['Asset Attribute Definitions'],
            summary: 'Create an attribute definition for an asset model',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Created' },
                400: { description: 'Validation error' },
                409: { description: 'Key already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);
                const response = await new Promise((resolve, reject) => {
                    assetAttributeDefinitionClient.createAttributeDefinition(parsed, (err, res) => {
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
            path: '/asset-attribute-definitions',
            tags: ['Asset Attribute Definitions'],
            summary: 'List attribute definitions for a model',
            request: {
                query: z.object({
                    asset_model_id: z.string({ required_error: 'Asset Model ID is required' }),
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
            },
            responses: {
                200: { description: 'List fetched' },
            },
        },
        async (c) => {
            try {
                const query = c.req.query();
                const response = await new Promise((resolve, reject) => {
                    assetAttributeDefinitionClient.listAttributeDefinitions(query, (err, res) => {
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
            path: '/asset-attribute-definitions/{id}',
            tags: ['Asset Attribute Definitions'],
            summary: 'Update an attribute definition',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Definition ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: updateSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Updated' },
                404: { description: 'Not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const response = await new Promise((resolve, reject) => {
                    assetAttributeDefinitionClient.updateAttributeDefinition({ id, ...body }, (err, res) => {
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
            path: '/asset-attribute-definitions/{id}',
            tags: ['Asset Attribute Definitions'],
            summary: 'Delete an attribute definition',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Definition ID is required' }),
                }),
            },
            responses: {
                200: { description: 'Deleted' },
                404: { description: 'Not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    assetAttributeDefinitionClient.deleteAttributeDefinition({ id }, (err, res) => {
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

    // Sync
    app.openapi(
        {
            method: 'post',
            path: '/asset-attribute-definitions/sync',
            tags: ['Asset Attribute Definitions'],
            summary: 'Sync all attribute definitions for a model',
            request: {
                body: {
                    content: {
                        'application/json': { schema: syncSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Synced' },
                400: { description: 'Validation error' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = syncSchema.parse(body);
                const response = await new Promise((resolve, reject) => {
                    assetAttributeDefinitionClient.syncAttributeDefinitions(parsed, (err, res) => {
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
