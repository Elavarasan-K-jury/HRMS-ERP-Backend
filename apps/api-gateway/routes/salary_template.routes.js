import { z, ZodError } from 'zod'
import { salaryTemplateClient } from '../grpc/salary_template.client.js'

export default function registerSalaryTemplateRoutes({ openapi }) {

    /* ============================================================
       1️⃣ LIST SALARY TEMPLATES (METADATA ONLY)
    ============================================================ */
    openapi(
        {
            method: 'get',
            path: '/salary/templates',
            tags: ['Salary Templates'],
            summary: 'List salary templates (metadata only)',
            request: {
                query: z.object({
                    organization_id: z.string(),

                    page: z.coerce.number().default(1),
                    limit: z.coerce.number().optional(),

                    search: z.string().optional(),
                    sort_by: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: {
                200: { description: 'Templates fetched successfully' },
            },
        },
        async (c) => {
            try {
                const q = c.req.valid('query')

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.ListSalaryTemplates(
                        {
                            organization_id: q.organization_id,
                            page: q.page,
                            per_page: q.limit ?? null,
                            search: q.search ?? '',
                            sort_by: q.sort_by,
                            sort_order: q.sort_order,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    )
                })

                return c.json(response)
            } catch (e) {
                return c.json({ error: e.message }, 500)
            }
        }
    )

    /* ============================================================
       2️⃣ GET SINGLE SALARY TEMPLATE (METADATA ONLY)
    ============================================================ */
    openapi(
        {
            method: 'get',
            path: '/salary/templates/{template_id}',
            tags: ['Salary Templates'],
            summary: 'Get salary template metadata',
            request: {
                params: z.object({
                    template_id: z.string(),
                }),
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: { description: 'Template fetched successfully' },
            },
        },
        async (c) => {
            try {
                const { template_id } = c.req.valid('param')
                const { organization_id } = c.req.valid('query')

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.GetSalaryTemplate(
                        { template_id, organization_id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    )
                })

                return c.json(response)
            } catch (e) {
                return c.json({ error: e.message }, 500)
            }
        }
    )

    /* ============================================================
       3️⃣ CREATE / UPDATE SALARY TEMPLATE (NO COMPONENTS)
    ============================================================ */
    openapi(
        {
            method: 'post',
            path: '/salary/templates',
            tags: ['Salary Templates'],
            summary: 'Create or update salary template (metadata only)',
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
                            }),
                        },
                    },
                },
            },
            responses: {
                200: { description: 'Template saved successfully' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json()

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.UpsertSalaryTemplate(
                        {
                            template_id: body.template_id ?? '',
                            organization_id: body.organization_id,
                            name: body.name,
                            description: body.description ?? '',
                            departments: body.departments ?? [],
                            designations: body.designations ?? [],
                            isDefault: body.isDefault ?? false,
                            isActive: body.isActive ?? true,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    )
                })

                return c.json(response)
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: e.errors }, 400)
                }
                return c.json({ error: e.message }, 500)
            }
        }
    )

    /* ============================================================
       4️⃣ DELETE SALARY TEMPLATE (SOFT DELETE)
    ============================================================ */
    openapi(
        {
            method: 'delete',
            path: '/salary/templates/{template_id}',
            tags: ['Salary Templates'],
            summary: 'Delete salary template',
            request: {
                params: z.object({
                    template_id: z.string(),
                }),
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: { description: 'Template deleted successfully' },
            },
        },
        async (c) => {
            try {
                const { template_id } = c.req.valid('param')
                const { organization_id } = c.req.valid('query')

                const response = await new Promise((resolve, reject) => {
                    salaryTemplateClient.DeleteSalaryTemplate(
                        { id: template_id, organization_id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    )
                })

                return c.json(response)
            } catch (e) {
                return c.json({ error: e.message }, 500)
            }
        }
    )
}
