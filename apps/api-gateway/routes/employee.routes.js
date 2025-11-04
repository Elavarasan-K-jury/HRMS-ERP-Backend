import { z, ZodError } from 'zod';
import { ObjectId } from "mongodb";
import { employeeClient } from '../grpc/employee.client.js';

export default function registerEmployeeCategoryRoutes(app) {
    // ✅ Schema for creating Employee Category
    const createEmployeeCategorySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z.string({ required_error: 'Category name is required' }).min(2, 'Name must have at least 2 characters'),
        code: z.string().optional(),
        description: z.string().optional(),
        id_prefix: z.string().optional(),
        is_permanent: z.boolean({ required_error: 'is_permanent is required' }),
        benefits_applicable: z.boolean({ required_error: 'benefits_applicable is required' }),
        onboarding_workflow: z.string().optional(),
        is_active: z.boolean().default(true),
        training_required: z.boolean().default(true),
        training_months: z.number().int().min(0).default(6),
        probation_required: z.boolean().default(true),
        probation_months: z.number().int().min(0).default(3),
        notice_required: z.boolean().default(true),
        notice_months: z.number().int().min(0).default(2)
    });

    // 🟢 Create Employee Category
    app.openapi(
        {
            method: 'post',
            path: '/employee-categories',
            tags: ['Employee Categories'],
            summary: 'Create a new employee category',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createEmployeeCategorySchema
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: 'Employee Category created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                created_at: z.string()
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createEmployeeCategorySchema.parse(body);

                const payload = {
                    ...parsed
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.CreateEmployeeCategory(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.category);
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

    // 🟣 Get Employee Category by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee-categories/{id}',
            tags: ['Employee Categories'],
            summary: 'Get an employee category by ID',
            request: {
                params: z.object({ id: z.string({ required_error: 'ID is required' }) })
            },
            responses: {
                200: {
                    description: 'Employee category details',
                    content: {
                        'application/json': {
                            schema: createEmployeeCategorySchema.extend({
                                id: z.string(),
                                created_at: z.string(),
                                updated_at: z.string().optional()
                            })
                        }
                    }
                },
                404: { description: 'Employee category not found' }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployeeCategory({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.category);
                    });
                });

                if (!response) return c.json({ error: 'Employee category not found' }, 404);

                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List All Employee Categories
    app.openapi(
        {
            method: 'get',
            path: '/employee-categories',
            tags: ['Employee Categories'],
            summary: 'List all employee categories for an organization',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'List of employee categories',
                    content: {
                        'application/json': {
                            schema: z.array(
                                z.object({
                                    id: z.string(),
                                    name: z.string(),
                                    code: z.string().optional(),
                                    organization_id: z.string()
                                })
                            )
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const query = c.req.query();
                const parsed = z.object({
                    organization_id: z.string()
                }).parse(query);

                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListEmployeeCategories(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.categories);
                    });
                });

                return c.json(response);
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

    // 🔵 Update Employee Category
    app.openapi(
        {
            method: 'put',
            path: '/employee-categories/{id}',
            tags: ['Employee Categories'],
            summary: 'Update an existing employee category',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Category ID is required' })
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: createEmployeeCategorySchema.partial().extend({
                                organization_id: z.string({ required_error: 'Organization ID is required' })
                            })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Employee category updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                name: z.string(),
                                organization_id: z.string(),
                                updated_at: z.string().optional()
                            })
                        }
                    }
                },
                400: { description: 'Validation failed' },
                404: { description: 'Category not found' }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                // Validate input
                const parsed = createEmployeeCategorySchema.partial().extend({
                    organization_id: z.string({ required_error: 'Organization ID is required' })
                }).parse(body);

                const payload = {
                    id,
                    ...parsed
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.UpdateEmployeeCategory(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.category);
                    });
                });

                if (!response) return c.json({ error: 'Employee category not found' }, 404);

                return c.json(response);
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
    // 🔴 Delete Employee Category
    app.openapi(
        {
            method: 'delete',
            path: '/employee-categories/{id}',
            tags: ['Employee Categories'],
            summary: 'Soft delete an employee category by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Category ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'Employee category deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string()
                            })
                        }
                    }
                },
                400: { description: 'Validation failed' },
                404: { description: 'Category not found' },
                500: { description: 'Internal server error' }
            }
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                // Validate ObjectId format
                if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                    return c.json({ error: 'Invalid category ID format' }, 400);
                }

                const response = await new Promise((resolve, reject) => {
                    employeeClient.DeleteEmployeeCategory({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DeleteEmployeeCategory API Error:', error);
                return c.json({ error: error.message }, 500);
            }
        }
    );

}

