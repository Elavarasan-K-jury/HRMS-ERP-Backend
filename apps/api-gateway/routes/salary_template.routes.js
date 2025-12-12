import { z, ZodError } from 'zod';
import { salaryTemplateClient } from '../grpc/salary_template.client.js';

export default function registerSalaryTemplateRoutes({ openapi }) {

    // ============================================================
    // 1️⃣ LIST SALARY TEMPLATES
    // ============================================================
    openapi(
        {
            method: 'get',
            path: '/salary/templates',
            tags: ['Salary Templates'],
            summary: 'Fetch salary templates (paginated)',

            request: {
                query: z.object({
                    organization_id: z.string(),

                    page: z.coerce.number().default(1),
                    limit: z.coerce.number().optional(),

                    search: z.string().optional().default(''),

                    sort_by: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },

            responses: {
                200: {
                    description: 'Salary templates fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.any()
                        }
                    },
                },
                400: { description: 'Validation error' },
            },

        },

        async (c) => {
            try {
                const q = c.req.valid('query');

                const payload = {
                    organization_id: q.organization_id,
                    page: q.page,
                    per_page: q.limit || null,
                    search: q.search,
                    sort_by: q.sort_by,
                    sort_order: q.sort_order,
                };

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.listSalaryTemplates(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // ============================================================
    // 2️⃣ TEMPLATE BUILDER DATA
    // ============================================================
    openapi(
        {
            method: 'get',
            path: '/salary/templates/builder',
            tags: ['Salary Templates'],
            summary: 'Fetch data required for building a salary template',

            request: {
                query: z.object({
                    organization_id: z.string(),
                    template_id: z.string().optional(),
                }),
            },

            responses: {
                200: {
                    description: 'Builder data fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.any()
                        }
                    },
                },
            },

        },

        async (c) => {
            try {
                const q = c.req.valid('query');

                const payload = {
                    organization_id: q.organization_id,
                    template_id: q.template_id ?? '',
                };

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.getSalaryTemplateBuilderData(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // ============================================================
    // 3️⃣ UPSERT TEMPLATE (CREATE or UPDATE)
    // ============================================================
    openapi(
        {
            method: 'post',
            path: '/salary/templates',
            tags: ['Salary Templates'],
            summary: 'Create or update a salary template',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                template_id: z.string().optional(),

                                organization_id: z.string(),
                                name: z.string(),
                                description: z.string().optional(),

                                departments: z.array(z.string()).default([]),
                                designations: z.array(z.string()).default([]),

                                isDefault: z.boolean().default(false),
                                isActive: z.boolean().default(true),

                                components: z.array(
                                    z.object({
                                        id: z.string().optional(),
                                        componentId: z.string(),

                                        formula: z.string().nullable().optional(),
                                        value: z.number().nullable().optional(),

                                        priority: z.number().default(0),
                                        minValue: z.number().nullable().optional(),
                                        maxValue: z.number().nullable().optional(),

                                        condition: z.string().nullable().optional(),
                                    })
                                ).default([]),
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'Salary template saved successfully',
                    content: {
                        'application/json': {
                            schema: z.any()
                        }
                    },
                },
                400: { description: 'Validation error' },
            },

        },

        async (c) => {
            try {
                const body = await c.req.json();

                const payload = {
                    template_id: body.template_id ?? '',
                    organization_id: body.organization_id,

                    name: body.name,
                    description: body.description,

                    departments: body.departments,
                    designations: body.designations,

                    isDefault: body.isDefault,
                    isActive: body.isActive,

                    components: body.components,
                };

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.upsertSalaryTemplate(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        }))
                    }, 400);
                }

                return c.json({ error: error.message }, 500);
            }
        }
    );


    // ============================================================
    // 4️⃣ DELETE TEMPLATE
    // ============================================================
    openapi(
        {
            method: 'delete',
            path: '/salary/templates/{template_id}',
            tags: ['Salary Templates'],
            summary: 'Delete a salary template',

            request: {
                params: z.object({
                    template_id: z.string(),
                }),
            },

            responses: {
                200: {
                    description: 'Template deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.any()
                        }
                    },
                },
            },

        },

        async (c) => {
            try {
                const template_id = c.req.param('template_id');

                const payload = { template_id };

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.deleteSalaryTemplate(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
