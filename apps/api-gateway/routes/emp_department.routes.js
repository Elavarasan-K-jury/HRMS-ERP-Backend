import { z, ZodError } from 'zod';
import { empDepartment } from '../grpc/emp_department.client.js';

export default function registerEmployeeDepartmentRoutes(app) {
    // ✅ Validation schema for creating/assigning employee to department
    const createEmployeeDepartmentSchema = z.object({
        department_id: z.string({ required_error: 'Department ID is required' })
            .regex(/^[0-9a-fA-F]{24}$/, 'Invalid department ID format'),
        employee_id: z.string({ required_error: 'Employee ID is required' })
            .regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee ID format'),
        reporting_to: z.string({ required_error: 'Employee ID is required' }).optional().nullable(),
        start_date: z.string({ required_error: 'Start date is required' })
            .refine((d) => !isNaN(Date.parse(d)), { message: 'Start date must be a valid ISO date' }),
        end_date: z.string().optional().nullable()
            .refine((d) => !d || !isNaN(Date.parse(d)), { message: 'End date must be a valid ISO date' })
    });

    // 🟢 Create / Assign Employee to Department
    app.openapi(
        {
            method: 'post',
            path: '/employees/departments',
            tags: ['Employee Departments'],
            summary: 'Assign an employee to a department',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createEmployeeDepartmentSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Employee assigned to department successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                department_id: z.string(),
                                employee_id: z.string(),
                                start_date: z.string(),
                                end_date: z.string().optional(),
                                created_at: z.string(),
                                updated_at: z.string(),
                            }),
                        },
                    },
                },
                400: { description: 'Validation failed' },
                404: { description: 'Employee or department not found' },
                409: { description: 'Already assigned' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createEmployeeDepartmentSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    empDepartment.AssignDepartment(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError)
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);

                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟣 Get Employee Department by ID
    app.openapi(
        {
            method: 'get',
            path: '/employees/departments/{id}',
            tags: ['Employee Departments'],
            summary: 'Get department assignment details for an employee by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee Department ID is required' })
                        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
                }),
            },
            responses: {
                200: {
                    description: 'Employee department record details',
                    content: {
                        'application/json': {
                            schema: createEmployeeDepartmentSchema.extend({
                                id: z.string(),
                                created_at: z.string(),
                                updated_at: z.string().optional(),
                            }),
                        },
                    },
                },
                404: { description: 'Employee department record not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    empDepartment.GetEmployeeDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                if (!response) return c.json({ error: 'Employee department record not found' }, 404);
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List Employee Departments
    app.openapi(
        {
            method: 'get',
            path: '/employees/{employeeId}/departments',
            tags: ['Employee Departments'],
            summary: 'List departments assigned to an employee',
            request: {
                params: z.object({
                    employeeId: z.string({ required_error: 'Employee ID is required' })
                        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid Employee ID format'),
                }),
                query: z.object({
                    department_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
                    page: z.coerce.number().default(1),
                    limit: z.coerce.number().default(10),
                    search: z.string().optional(),
                    sort_by: z.enum(['start_date', 'end_date']).default('start_date'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: {
                200: {
                    description: 'List of employee department assignments',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    employee_id: z.string(),
                                    department_id: z.string(),
                                    start_date: z.string(),
                                    end_date: z.string().optional(),
                                    created_at: z.string(),
                                    updated_at: z.string().optional(),
                                })
                            ),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const employeeId = c.req.param('employeeId');
                const query = c.req.query();
                const parsed = z.object({
                    department_id: z.string().optional(),
                    page: z.coerce.number(),
                    limit: z.coerce.number(),
                    search: z.string().optional(),
                    sort_by: z.enum(['start_date', 'end_date']),
                    sort_order: z.enum(['asc', 'desc']),
                }).parse(query);

                const payload = { employee_id: employeeId, ...parsed };

                const response = await new Promise((resolve, reject) => {
                    empDepartment.ListEmployeeDepartments(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.departments);
                    });
                });

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError)
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);

                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get',
            path: '/employees/{department_id}/employees',
            tags: ['Employee Departments'],
            summary: 'List employees assigned to a department',
            request: {
                params: z.object({
                    department_id: z.string({ required_error: 'Department ID is required' })
                }),
            },
            responses: {
                200: {
                    description: 'List of employee department assignments',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    employee_id: z.string(),
                                    department_id: z.string(),
                                    start_date: z.string(),
                                    end_date: z.string().optional(),
                                    created_at: z.string(),
                                    updated_at: z.string().optional(),
                                })
                            ),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const department_id = c.req.param('department_id');

                const payload = { department_id };

                console.log('emp_department.routes.js @ Line 247:', payload);

                const response = await new Promise((resolve, reject) => {
                    empDepartment.ListEmployeeInDepartments(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                console.log('emp_department.routes.js @ Line 256:', response);

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError)
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);

                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🔵 Update Employee Department
    const updateEmployeeDepartmentSchema = createEmployeeDepartmentSchema.partial();

    app.openapi(
        {
            method: 'put',
            path: '/employees/departments/{id}',
            tags: ['Employee Departments'],
            summary: 'Update an existing employee department assignment',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee Department ID is required' })
                        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
                }),
                body: {
                    content: {
                        'application/json': { schema: updateEmployeeDepartmentSchema },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Employee department updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                department_id: z.string(),
                                employee_id: z.string(),
                                start_date: z.string(),
                                end_date: z.string().optional(),
                                updated_at: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Record not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateEmployeeDepartmentSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    empDepartment.UpdateEmployeeDepartment({ id, ...parsed }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError)
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);

                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🔴 Delete Employee Department (Soft Delete)
    app.openapi(
        {
            method: 'delete',
            path: '/employees/departments/{id}',
            tags: ['Employee Departments'],
            summary: 'Soft delete an employee department record',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee Department ID is required' })
                        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
                }),
            },
            responses: {
                200: {
                    description: 'Employee department deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Record not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const existing = await new Promise((resolve, reject) => {
                    empDepartment.GetEmployeeDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                if (!existing) return c.json({ error: 'Employee department record not found' }, 404);

                const response = await new Promise((resolve, reject) => {
                    empDepartment.RemoveEmployeeDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeDepartment API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
