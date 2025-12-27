import { z, ZodError } from 'zod';
import { componentClient } from '../grpc/component_definition.client.js';

export default function registerComponentDefinitionRoutes({ openapi }) {

    /* ============================================================
       FETCH Component Definitions
       ============================================================ */
    openapi(
        {
            method: 'get',
            path: '/salary/components',
            tags: ['Component Definitions'],
            summary: 'Fetch all salary component definitions',
            request: {
                query: z.object({
                    organization_id: z.string(),
                    page: z.coerce.number().optional().nullable(),
                    limit: z.coerce.number().optional().nullable(),
                    search: z.string().optional().default(''),
                    category: z.enum(['recurring', 'adhoc', 'allowance', 'custom']).default('recurring'),
                    sort_by: z
                        .enum(['key', 'name', 'type', 'category', 'displayOrder', 'createdAt', 'updatedAt'])
                        .default('displayOrder'),
                    sort_order: z.enum(['asc', 'desc']).default('asc'),
                }),
            },
            responses: {
                200: {
                    description: 'Component definitions fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                data: z.array(z.object({})),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation error' },
            },
        },

        async (c) => {
            try {
                const query = c.req.valid('query');

                const payload = {
                    page: query.page,
                    per_page: query.limit,
                    search: query.search,
                    category: query.category,
                    sort_by: query.sort_by,
                    sort_order: query.sort_order,
                    organization_id: query.organization_id,
                };

                const response = await new Promise((resolve, reject) => {
                    componentClient.fetchComponentDefinitions(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ============================================================
       CREATE Component Definition
       ============================================================ */
    openapi(
        {
            method: 'post',
            path: '/salary/components',
            tags: ['Component Definitions'],
            summary: 'Create a new salary component definition',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),

                                key: z.string(),
                                name: z.string(),

                                type: z.enum(['earning', 'deduction', 'reimbursement', 'benefit', 'tax']),
                                category: z.enum(['recurring', 'adhoc', 'allowance', 'custom']).default('recurring'),

                                defaultFormula: z.string().nullable().optional(),
                                description: z.string().optional(),

                                isTaxable: z.boolean().default(true),
                                isVariable: z.boolean().default(false),
                                isStatutory: z.boolean().default(false),
                                includeInCTC: z.boolean().default(true),
                                includeInGross: z.boolean().default(true),

                                displayOrder: z.number().default(999),
                                isActive: z.boolean().default(true),
                            }),
                        },
                    },
                },
            },

            responses: {
                201: {
                    description: 'Component definition created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                data: z.any(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation error' },
            },
        },

        async (c) => {
            try {
                const body = await c.req.json();

                const payload = {
                    organization_id: body.organization_id,
                    key: body.key,
                    name: body.name,
                    type: body.type,
                    category: body.category,
                    defaultFormula: body.defaultFormula,
                    description: body.description,
                    isTaxable: body.isTaxable,
                    isVariable: body.isVariable,
                    isStatutory: body.isStatutory,
                    includeInCTC: body.includeInCTC,
                    includeInGross: body.includeInGross,
                    displayOrder: body.displayOrder,
                    isActive: body.isActive,
                };

                const response = await new Promise((resolve, reject) => {
                    componentClient.createComponentDefinition(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 201);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map((e) => ({
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



    /* ============================================================
       UPDATE Component Definition
       ============================================================ */
    openapi(
        {
            method: 'put',
            path: '/salary/components/{component_id}',
            tags: ['Component Definitions'],
            summary: 'Update an existing salary component definition',
            request: {
                params: z.object({
                    component_id: z.string(),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),

                                key: z.string(),
                                name: z.string(),
                                type: z.string(),
                                category: z.string(),

                                defaultFormula: z.string().nullable().optional(),
                                description: z.string().optional(),

                                isTaxable: z.boolean(),
                                isVariable: z.boolean(),
                                isStatutory: z.boolean(),
                                includeInCTC: z.boolean(),
                                includeInGross: z.boolean(),

                                displayOrder: z.number(),
                                isActive: z.boolean(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Component definition updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                data: z.any(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation error' },
            },
        },

        async (c) => {
            try {
                const id = c.req.param('component_id');
                const body = await c.req.json();

                const payload = {
                    id,
                    organization_id: body.organization_id,

                    key: body.key,
                    name: body.name,
                    type: body.type,
                    category: body.category,

                    defaultFormula: body.defaultFormula,
                    description: body.description,

                    isTaxable: body.isTaxable,
                    isVariable: body.isVariable,
                    isStatutory: body.isStatutory,
                    includeInCTC: body.includeInCTC,
                    includeInGross: body.includeInGross,

                    displayOrder: body.displayOrder,
                    isActive: body.isActive,
                };

                const response = await new Promise((resolve, reject) => {
                    componentClient.updateComponentDefinition(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: 'Validation failed',
                            details: error.errors.map((e) => ({
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


    /* ============================================================
       DELETE Component Definition
       ============================================================ */
    openapi(
        {
            method: 'delete',
            path: '/salary/components/{component_id}',
            tags: ['Component Definitions'],
            summary: 'Delete an existing salary component definition',
            request: {
                params: z.object({
                    component_id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'Component definition deleted successfully',
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
                const id = c.req.param('component_id');

                const payload = { id };

                const response = await new Promise((resolve, reject) => {
                    componentClient.deleteComponentDefinition(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
