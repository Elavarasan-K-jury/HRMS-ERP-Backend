import { z, ZodError } from 'zod';
import { orgClient } from '../grpc/organization.client.js';

export default function registerOrganizationRoutes(app) {
    // ✅ Schema for creating an organization
    const createOrgSchema = z.object({
        name: z.string({ required_error: 'Organization name is required' })
            .min(2, 'Name must have at least 2 characters'),
        domain: z.string({ required_error: 'Domain is required' })
            .url('Domain must be a valid URL'),
        gstNumber: z.string()
            .regex(/^$|^[0-9A-Z]{15}$/, 'GST number must be 15 alphanumeric characters')
            .optional(),
        email: z.string().email('Invalid email format').optional(),
        contactPersonName: z.string().optional(),
        contactPersonNumber: z.string().optional(),
        note: z.string().optional(),
        industry: z.string().optional(),
        size: z.number().int('Size must be an integer').positive('Size must be positive').optional(),
        address: z.string().optional()
    });

    // 🟢 Create Organization
    app.openapi(
        {
            method: 'post',
            path: '/organizations',
            tags: ['Organization'],
            summary: 'Create a new organization',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createOrgSchema
                        }
                    }
                }
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
                                created_at: z.string()
                            })
                        }
                    }
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
                                        message: z.string()
                                    })
                                )
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createOrgSchema.parse(body);

                const payload = {
                    name: parsed.name,
                    domain: parsed.domain,
                    gst_number: parsed.gstNumber,
                    email: parsed.email,
                    contact_person_name: parsed.contactPersonName,
                    contact_person_number: parsed.contactPersonNumber,
                    note: parsed.note,
                    industry: parsed.industry,
                    size: parsed.size,
                    address: parsed.address
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
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message
                        }))
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟣 Get organization by ID
    app.openapi(
        {
            method: 'get',
            path: '/organizations/{id}',
            tags: ['Organization'],
            summary: 'Fetch organization by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'ID is required' }) })
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
                                email: z.string().optional()
                            })
                        }
                    }
                },
                404: {
                    description: 'Organization not found'
                }
            }
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

                if (!response) {
                    return c.json({ error: 'Organization not found' }, 404);
                }

                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List Organizations — Paginated + Search + Sort
    app.openapi(
        {
            method: 'get',
            path: '/organizations',
            tags: ['Organization'],
            summary: 'List organizations with pagination, search, and sorting',
            request: {
                query: z.object({
                    page: z
                        .string()
                        .optional()
                        .default('1')
                        .transform((v) => parseInt(v, 10)),
                    limit: z
                        .string()
                        .optional()
                        .default('10')
                        .transform((v) => parseInt(v, 10)),
                    search: z.string().optional().default(''),
                    sort_by: z
                        .string()
                        .optional()
                        .default('createdAt')
                        .refine(
                            (val) =>
                                ['name', 'domain', 'industry', 'size', 'created_at', 'updated_at', 'createdAt', 'updatedAt'].includes(val),
                            {
                                message:
                                    'Invalid sort field. Allowed: name, domain, industry, size, created_at, updated_at',
                            }
                        ),
                    sort_order: z
                        .string()
                        .optional()
                        .default('desc')
                        .refine((val) => ['asc', 'desc'].includes(val.toLowerCase()), {
                            message: 'Sort order must be "asc" or "desc"',
                        }),
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

}
