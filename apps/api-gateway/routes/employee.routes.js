import { z, ZodError } from 'zod';
import { employeeClient } from '../grpc/employee.client.js';

export default function registerEmployeeRoutes(app) {
    // ✅ Schema for creating an employee
    const createEmployeeSchema = z.object({
        firstName: z.string({ required_error: 'First name is required' })
            .min(2, 'First name must have at least 2 characters'),
        lastName: z.string({ required_error: 'Last name is required' })
            .min(2, 'Last name must have at least 2 characters'),
        email: z.string({ required_error: 'Email is required' })
            .email('Invalid email format'),
        phone: z.string({ required_error: 'Phone number is required' })
            .regex(/^[0-9]{10}$/, 'Phone number must be 10 digits'),
        organizationId: z.string({ required_error: 'Organization ID is required' }),
        departmentId: z.string().optional(),
        designation: z.string().optional(),
        salary: z.number().optional(),
        dateOfJoining: z.string().optional(), // ISO date
        address: z.string().optional()
    });

    // 🟢 Create Employee
    app.openapi(
        {
            method: 'post',
            path: '/employees',
            tags: ['Employee'],
            summary: 'Create a new employee',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createEmployeeSchema
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: 'Employee created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                firstName: z.string(),
                                lastName: z.string(),
                                email: z.string(),
                                organizationId: z.string(),
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
                const parsed = createEmployeeSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    employeeClient.CreateEmployee(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee);
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

    // 🟣 Get Employee by ID
    app.openapi(
        {
            method: 'get',
            path: '/employees/{id}',
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
                                firstName: z.string(),
                                lastName: z.string(),
                                email: z.string(),
                                organizationId: z.string(),
                                departmentId: z.string().optional(),
                                designation: z.string().optional(),
                                salary: z.number().optional(),
                                dateOfJoining: z.string().optional(),
                                address: z.string().optional(),
                                created_at: z.string().optional()
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
                        resolve(resp.employee);
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
            path: '/employees',
            tags: ['Employee'],
            summary: 'List employees with pagination, search, and sorting',
            request: {
                query: z.object({
                    page: z.string().optional().default('1').transform(v => parseInt(v, 10)),
                    limit: z.string().optional().default('10').transform(v => parseInt(v, 10)),
                    search: z.string().optional().default(''),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.string().optional().default('desc')
                        .refine(val => ['asc', 'desc'].includes(val.toLowerCase()), {
                            message: 'Sort order must be "asc" or "desc"'
                        })
                })
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
                                        firstName: z.string(),
                                        lastName: z.string(),
                                        email: z.string(),
                                        organizationId: z.string(),
                                        created_at: z.string().optional()
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number()
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

    // 🟠 Update Employee
    const updateEmployeeSchema = createEmployeeSchema.extend({
        id: z.string({ required_error: 'Employee ID is required' })
    });

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
                        'application/json': {
                            schema: updateEmployeeSchema.omit({ id: true })
                        }
                    }
                }
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

                const response = await new Promise((resolve, reject) => {
                    employeeClient.UpdateEmployee(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee);
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
        }
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
}
