import { z, ZodError } from 'zod';
import { employeeClient } from '../grpc/employee.client.js';

export default function registerEmployeeRoutes(app) {
    // ✅ Schema for creating an employee
    const createEmployeeSchema = z.object({
        organizationId: z.string({ required_error: 'Organization ID is required' }),
        categoryId: z.string({ required_error: 'Category ID is required' }),
        designationId: z.string().optional(),               // ← NEW
        firstName: z.string().min(2, 'First name must have at least 2 characters').optional(),
        lastName: z.string().min(1, 'Last name must have at least 1 characters').optional(),
        fullName: z.string().optional(),
        email: z.string().email('Invalid email format').optional(),
        phone: z.string().regex(/^[0-9]{10}$/, 'Phone number must be 10 digits'),
        altPhone: z.string().optional(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional(),
        dateOfBirth: z.string().refine(v => !isNaN(Date.parse(v)), {
            message: 'dateOfBirth must be a valid ISO date',
        }).optional(),
    });

    // 🟢 Create Employee
    app.openapi(
        {
            method: 'post',
            path: '/employees',
            tags: ['Employee'],
            summary: 'Create a new employee',
            request: {
                body: { content: { 'application/json': { schema: createEmployeeSchema } } },
            },
            responses: {
                201: {
                    description: 'Employee created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                designation_id: z.string().optional(),
                                first_name: z.string().optional(),
                                last_name: z.string().optional(),
                                full_name: z.string(),
                                email: z.string().optional(),
                                phone: z.string(),
                                alt_phone: z.string().optional(),
                                gender: z.number(),
                                date_of_birth: z.string(),
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
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createEmployeeSchema.parse(body);

                const grpcPayload = {
                    organization_id: parsed.organizationId,
                    category_id: parsed.categoryId,
                    designation_id: parsed.designationId ?? null,
                    first_name: parsed.firstName ?? null,
                    last_name: parsed.lastName ?? null,
                    full_name: parsed.fullName ?? null,
                    email: parsed.email ?? null,
                    phone: parsed.phone,
                    alt_phone: parsed.altPhone ?? null,
                    gender: parsed.gender,
                    date_of_birth: parsed.dateOfBirth ?? null,
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.CreateEmployee(grpcPayload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
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
        },
    );

    // 🟣 Get Employee by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee/{id}',
            tags: ['Employee'],
            summary: 'Fetch employee by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'Employee details',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                designation_id: z.string().optional(),
                                first_name: z.string().optional(),
                                last_name: z.string().optional(),
                                full_name: z.string(),
                                email: z.string().optional(),
                                phone: z.string(),
                                alt_phone: z.string().optional(),
                                gender: z.number(),
                                date_of_birth: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
                            })
                        }
                    }
                },
                404: {
                    description: 'Employee not found'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!response) {
                    return c.json({ error: 'Employee not found' }, 404);
                }

                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List Employees — Paginated + Search + Sort
    app.openapi(
        {
            method: 'get',
            path: '/employees/all',
            tags: ['Employee'],
            summary: 'List employees for single organization',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    department_id: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of employees',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        designation_id: z.string().optional(),
                                        first_name: z.string().optional(),
                                        last_name: z.string().optional(),
                                        full_name: z.string(),
                                        email: z.string().optional(),
                                        phone: z.string(),
                                        alt_phone: z.string().optional(),
                                        gender: z.number(),
                                        date_of_birth: z.string(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListAllEmployees(
                        {
                            organization_id: query.organization_id,
                            department_id: query.department_id
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


    app.openapi(
        {
            method: 'get',
            path: '/employees',
            tags: ['Employee'],
            summary: 'List employees with pagination, search, and sorting',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    category_id: z.string().optional(),
                    designation_id: z.string().optional(),   // ← NEW filter
                    search: z.string().optional(),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                    limit: z.coerce.number().optional().default(10),
                    page: z.coerce.number().optional().default(1),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of employees',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        designation_id: z.string().optional(),
                                        first_name: z.string().optional(),
                                        last_name: z.string().optional(),
                                        full_name: z.string(),
                                        email: z.string().optional(),
                                        phone: z.string(),
                                        alt_phone: z.string().optional(),
                                        gender: z.number(),
                                        date_of_birth: z.string(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListEmployees(
                        {
                            organization_id: query.organization_id,
                            category_id: query.category_id,
                            designation_id: query.designation_id,
                            page: query.page,
                            limit: query.limit,
                            search: query.search,
                            sort_by: query.sort_by,
                            sort_order: query.sort_order
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

    const updateEmployeeSchema = createEmployeeSchema
        .extend({ id: z.string({ required_error: 'Employee ID is required' }) })
        .partial();

    // 🟠 Update Employee
    app.openapi(
        {
            method: 'put',
            path: '/employees/{id}',
            tags: ['Employee'],
            summary: 'Update employee details',
            request: {
                params: z.object({ id: z.string() }),
                body: {
                    content: {
                        'application/json': { schema: updateEmployeeSchema.omit({ id: true }) },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Employee updated successfully'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateEmployeeSchema.parse({ ...body, id });

                const grpcPayload = {
                    id,
                    organization_id: parsed.organizationId,
                    category_id: parsed.categoryId,
                    designation_id: parsed.designationId,
                    first_name: parsed.firstName,
                    last_name: parsed.lastName,
                    full_name: parsed.fullName,
                    email: parsed.email,
                    phone: parsed.phone,
                    alt_phone: parsed.altPhone,
                    gender: parsed.gender,
                    date_of_birth: parsed.dateOfBirth,
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.UpdateEmployee(grpcPayload, (err, resp) => {
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
                            message: e.message
                        }))
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        },
    );


    // 🔴 Delete Employee
    app.openapi(
        {
            method: 'delete',
            path: '/employees/{id}',
            tags: ['Employee'],
            summary: 'Delete an employee',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'Employee deleted successfully'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    employeeClient.DeleteEmployee({ id }, (err, resp) => {
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

    app.openapi(
        {
            method: 'post',
            path: '/employee/login/request-otp',
            tags: ['Employee'],
            summary: 'Request login OTP (email-only delivery)',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                purpose: z.string().optional().default('login'),
                            })
                                .refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'OTP sent',
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } }
                },
                404: { description: 'Admin not found' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.RequestLoginOtp(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    // ===== Verify Token
    app.openapi({
        method: 'post',
        path: '/employee/auth/verify-token',
        tags: ['Employee'],
        summary: 'Verify a JWT token and return decoded data',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({ token: z.string() })
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Token data',
                content: {
                    'application/json': {
                        schema: z.object({
                            sub: z.string(),
                            user: z.object(),
                            email: z.string().optional(),
                            scope: z.string().optional(),
                            typ: z.string(),
                            iat: z.string(),
                            exp: z.string(),
                            success: z.boolean(),
                            message: z.string()
                        })
                    }
                }
            }
        }
    }, async (c) => {
        try {
            const { token } = await c.req.json();
            const response = await new Promise((resolve, reject) => {
                employeeClient.VerifyToken({ token }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json({
                ...response,
                success: true,
                message: 'Token verified successfully',
                user: response.user
            }, 200);
        } catch (error) {
            return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
        }
    });

    // ===== Verify OTP
    app.openapi(
        {
            method: 'post',
            path: '/employee/login/verify',
            tags: ['Employee'],
            summary: 'Verify OTP and get tokens',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                otp: z.string().regex(/^\d{6}$/)
                            }).refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Tokens', content: {
                        'application/json': {
                            schema: z.object({
                                access_token: z.string(),
                                refresh_token: z.string(),
                                token_type: z.string(),
                                expires_in: z.string(),
                                admin: z.object({
                                    id: z.string(),
                                    email: z.string(),
                                    phone: z.string(),
                                    created_at: z.string().optional(),
                                    updated_at: z.string().optional(),
                                    deleted_at: z.string().optional(),
                                })
                            })
                        }
                    }
                },
                403: { description: 'Invalid/expired OTP' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.VerifyLoginOtp(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                const code = error.code === 7 ? 403 : (error.code === 5 ? 404 : 500);
                return c.json({ error: error.message }, code);
            }
        }
    );

    // ===== Refresh tokens
    app.openapi(
        {
            method: 'post',
            path: '/employee/token/refresh',
            tags: ['Employee'],
            summary: 'Issue new tokens using refresh token',
            request: {
                body: { content: { 'application/json': { schema: z.object({ refresh_token: z.string() }) } } }
            },
            responses: { 200: { description: 'Tokens' } }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.RefreshTokens(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 7 ? 403 : 500);
            }
        }
    );
}
