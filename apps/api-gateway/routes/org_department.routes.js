import { z, ZodError } from 'zod';
import { orgDepartmentClient } from '../grpc/org_department.client.js';

export default function registerOrgDepartmentRoutes({ openapi }) {
    // ──────────────────────────────────────────────────────────────────────
    // CREATE DEPARTMENT SCHEMA
    // ──────────────────────────────────────────────────────────────────────
    const createDeptSchema = z.object({
        organization_id: z
            .string({ required_error: 'organization_id is required' })
            .regex(/^[0-9a-fA-F]{24}$/, 'Invalid organization_id format'),

        name: z
            .string({ required_error: 'Department name is required' })
            .min(2, 'Name must have at least 2 characters'),

        code: z.string().optional(),

        department_head_id: z
            .string()
            .regex(/^[0-9a-fA-F]{24}$/, 'Invalid department_head_id')
            .optional()
            .nullable(),

        department_head_start_date: z
            .string()
            .refine((val) => !val || !isNaN(Date.parse(val)), {
                message: 'department_head_start_date must be a valid ISO date',
            })
            .optional()
            .nullable(),

        description: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
    }).strict();

    // ──────────────────────────────────────────────────────────────────────
    // POST /departments
    // ──────────────────────────────────────────────────────────────────────
    openapi(
        {
            method: 'post',
            path: '/departments',
            tags: ['Org-Department'],
            summary: 'Create a new department',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createDeptSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Department created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                name: z.string(),
                                created_at: z.string(),
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
                409: {
                    description: 'Department name already exists in organization',
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createDeptSchema.parse(body);

                const payload = {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    code: parsed.code ?? null,
                    department_head_id: parsed.department_head_id ?? null,
                    department_head_start_date: parsed.department_head_start_date ?? null,
                    description: parsed.description ?? null,
                    note: parsed.note ?? null,
                };

                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.CreateDepartment(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
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

    // ──────────────────────────────────────────────────────────────────────
    // GET /departments/{id}
    // ──────────────────────────────────────────────────────────────────────
    openapi(
        {
            method: 'get',
            path: '/department/{id}',
            tags: ['Org-Department'],
            summary: 'Fetch department by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Department ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Department details',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                name: z.string(),
                                code: z.string().optional(),
                                department_head_id: z.string().optional(),
                                department_head_start_date: z.string().optional(),
                                description: z.string().optional(),
                                note: z.string().optional(),
                                created_at: z.string().optional(),
                                updated_at: z.string().optional(),
                                deleted_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Department not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.GetDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!response) {
                    return c.json({ error: 'Department not found' }, 404);
                }

                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // ──────────────────────────────────────────────────────────────────────
    // GET /departments (List with filters)
    // ──────────────────────────────────────────────────────────────────────
    openapi(
        {
            method: 'get',
            path: '/departments/employee-list',
            tags: ['Org-Department'],
            summary: 'List all employees inside a department (including head)',
            request: {
                query: z.object({
                    organization_id: z.string(),
                    department_id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'List of department employees',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        full_name: z.string(),
                                        email: z.string(),
                                        phone: z.string(),
                                        employee_code: z.string().optional(),

                                        designation: z.string().optional(),
                                        category: z.string().optional(),
                                        profile: z.string().optional(),
                                        reporting: z.any().optional(),

                                        isHead: z.boolean(),
                                    })
                                ),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const payload = {
                    organization_id: query.organization_id,
                    department_id: query.department_id,
                };

                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.ListDepartmentEmployees(payload, (err, resp) => {
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

    openapi(
        {
            method: 'get',
            path: '/departments',
            tags: ['Org-Department'],
            summary: 'List departments with pagination, search, and sorting',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
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
                        .enum(['name', 'code', 'created_at', 'updated_at'])
                        .optional()
                        .default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of departments',
                    content: {
                        'application/json': {
                            schema: z.object({
                                departments: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        name: z.string(),
                                        code: z.string().optional(),
                                        department_head_id: z.string().optional(),
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

                const payload = {
                    organization_id: query.organization_id,
                    page: query.page,
                    limit: query.limit,
                    search: query.search,
                    sort_by: query.sort_by,
                    sort_order: query.sort_order,
                };

                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.ListDepartments(payload, (err, resp) => {
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
    // ──────────────────────────────────────────────────────────────────────
    // GET /departments (List with filters)
    // ──────────────────────────────────────────────────────────────────────
    openapi(
        {
            method: 'get',
            path: '/departments/all',
            tags: ['Org-Department'],
            summary: 'List departments with pagination, search, and sorting',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of departments',
                    content: {
                        'application/json': {
                            schema: z.object({
                                departments: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        name: z.string(),
                                        code: z.string().optional(),
                                        department_head_id: z.string().optional(),
                                        created_at: z.string().optional(),
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
                const query = c.req.valid('query');

                const payload = {
                    organization_id: query.organization_id,
                };

                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.ListDepartments(payload, (err, resp) => {
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

    // ──────────────────────────────────────────────────────────────────────
    // PUT /departments/{id}
    // ──────────────────────────────────────────────────────────────────────
    const updateDeptSchema = createDeptSchema
        .extend({
            id: z.string({ required_error: 'Department ID is required' }),
        })
        .partial()
        .omit({ organization_id: false }); // allow org change

    openapi(
        {
            method: 'put',
            path: '/departments/{id}',
            tags: ['Org-Department'],
            summary: 'Update department details',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Department ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: updateDeptSchema.omit({ id: true }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Department updated',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Department not found' },
                409: { description: 'Name conflict' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateDeptSchema.parse({ ...body, id });

                const payload = {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    name: parsed.name ?? null,
                    code: parsed.code ?? null,
                    department_head_id: parsed.department_head_id ?? null,
                    department_head_start_date: parsed.department_head_start_date ?? null,
                    description: parsed.description ?? null,
                    note: parsed.note ?? null,
                };

                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.UpdateDepartment(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
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

    // ──────────────────────────────────────────────────────────────────────
    // DELETE /departments/{id}
    // ──────────────────────────────────────────────────────────────────────
    openapi(
        {
            method: 'delete',
            path: '/departments/{id}',
            tags: ['Org-Department'],
            summary: 'Soft delete a department',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Department ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Department deleted',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Department not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    orgDepartmentClient.DeleteDepartment({ id }, (err, resp) => {
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