import { z, ZodError } from 'zod';
import { orgClient } from '../grpc/organization.client.js';

export default function registerOrganizationRoutes({ openapi }) {
    //
    // ✅ Create Organization schema (Swagger-safe)
    //
    const createOrgSchema = z.object({
        name: z
            .string({ required_error: 'Organization name is required' })
            .min(2, 'Name must have at least 2 characters'),

        domain: z
            .string({ required_error: 'Domain is required' })
            .url('Domain must be a valid URL'),

        gst_number: z
            .string()
            .regex(/^$|^[0-9A-Z]{15}$/, 'GST number must be 15 alphanumeric characters')
            .optional(),

        email: z.string().email('Invalid email format').optional(),
        contact_person_name: z.string().optional(),
        contact_person_number: z.string().optional(),
        note: z.string().optional(),
        industry: z.string().optional(),
        size: z.number().int().positive().optional(),

        // ✅ replaced problematic union
        address: z
            .object({
                line1: z.string().optional(),
                line2: z.string().optional(),
                city: z.string().optional(),
                state: z.string().optional(),
                postal_code: z.string().optional(),
                country: z.string().optional(),
            })
            .optional(),
    }).strict();

    //
    // 🟢 Create Organization
    //
    openapi(
        {
            method: 'post',
            path: '/organizations',
            tags: ['Organization'],
            summary: 'Create a new organization',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createOrgSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Organization created',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                domain: z.string(),
                                created_at: z.string().optional(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                                details: z.array(
                                    z.object({
                                        field: z.string(),
                                        message: z.string(),
                                    })
                                ),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createOrgSchema.parse(body);

                const payload = {
                    ...parsed,
                    gst_number: parsed.gst_number ?? null,
                    email: parsed.email ?? null,
                    contact_person_name: parsed.contact_person_name ?? null,
                    contact_person_number: parsed.contact_person_number ?? null,
                    note: parsed.note ?? null,
                    industry: parsed.industry ?? null,
                    size: parsed.size ?? null,
                    address: parsed.address ?? null,
                };

                const response = await new Promise((resolve, reject) => {
                    orgClient.CreateOrganization(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.organization);
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

    //
    // 🟣 Get organization by ID
    //
    openapi(
        {
            method: 'get',
            path: '/organizations/{id}',
            tags: ['Organization'],
            summary: 'Fetch organization by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Organization details',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                domain: z.string(),
                                email: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Organization not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    orgClient.GetOrganization({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.organization);
                    });
                });
                if (!response) return c.json({ error: 'Organization not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // 🟡 List Organizations (pagination)
    //
    openapi(
        {
            method: 'get',
            path: '/organizations',
            tags: ['Organization'],
            summary: 'List organizations with pagination, search, and sorting',
            request: {
                query: z.object({
                    page: z.number().optional().default(1),
                    limit: z.number().optional().default(10),
                    search: z.string().optional().default(''),
                    sort_by: z
                        .enum(['name', 'domain', 'industry', 'size', 'created_at', 'updated_at'])
                        .optional()
                        .default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated, searchable list of organizations',
                    content: {
                        'application/json': {
                            schema: z.object({
                                organizations: z.array(
                                    z.object({
                                        id: z.string(),
                                        name: z.string(),
                                        domain: z.string(),
                                        email: z.string().optional(),
                                        industry: z.string().optional(),
                                        size: z.number().optional(),
                                        created_at: z.string().optional(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
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
                    orgClient.ListOrganizations(
                        {
                            page: query.page,
                            limit: query.limit,
                            search: query.search,
                            sort_by: query.sort_by,
                            sort_order: query.sort_order,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });
                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // 🟠 Update Organization
    //
    openapi(
        {
            method: 'put',
            path: '/organizations/{id}',
            tags: ['Organization'],
            summary: 'Update an existing organization',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Organization ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                name: z.string().optional(),
                                domain: z.string().url('Domain must be a valid URL').optional(),
                                gst_number: z
                                    .string()
                                    .regex(/^$|^[0-9A-Z]{15}$/, 'GST number must be 15 alphanumeric characters')
                                    .optional(),
                                email: z.string().email('Invalid email format').optional(),
                                contact_person_name: z.string().optional(),
                                contact_person_number: z.string().optional(),
                                note: z.string().optional(),
                                industry: z.string().optional(),
                                size: z.number().optional(),
                                address: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Organization updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                domain: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Organization not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const payload = { id, ...body };

                const response = await new Promise((resolve, reject) => {
                    orgClient.UpdateOrganization(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.organization);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    //
    // 🔴 Delete Organization
    //
    openapi(
        {
            method: 'delete',
            path: '/organizations/{id}',
            tags: ['Organization'],
            summary: 'Soft delete an organization (sets deletedAt)',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Organization ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Organization deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({ message: z.string() }),
                        },
                    },
                },
                404: { description: 'Organization not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    orgClient.DeleteOrganization({ id }, (err, resp) => {
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
