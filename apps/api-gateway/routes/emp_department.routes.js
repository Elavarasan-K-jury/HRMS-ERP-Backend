import { z, ZodError } from 'zod';
import { empDepartment } from '../grpc/emp_department.client.js';

export default function registerEmployeeDepartmentRoutes({ openapi }) {
    const assignSchema = z.object({
        department_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid department_id'),
        employee_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee_id'),
        start_date: z.string().refine((d) => !isNaN(Date.parse(d)), {
            message: 'start_date must be a valid ISO date',
        }),
        end_date: z.string().refine((d) => !d || !isNaN(Date.parse(d)), {
            message: 'end_date must be a valid ISO date',
        }).optional().nullable(),
    }).strict();

    // POST /employees/departments
    openapi(
        {
            method: 'post',
            path: '/employees/departments',
            tags: ['Employee Department'],
            summary: 'Assign employee to department',
            request: { body: { content: { 'application/json': { schema: assignSchema } } } },
            responses: {
                201: { description: 'Assigned' },
                400: { description: 'Validation error' },
                404: { description: 'Department or Employee not found' },
                409: { description: 'Already assigned' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = assignSchema.parse(body);

                const payload = {
                    department_id: parsed.department_id,
                    employee_id: parsed.employee_id,
                    start_date: parsed.start_date,
                    end_date: parsed.end_date ?? null,
                };

                const res = await new Promise((resolve, reject) => {
                    empDepartment.AssignDepartment(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                return c.json(res, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        { error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) },
                        400
                    );
                }
                if (error.code === grpc.status.NOT_FOUND) return c.json({ error: error.message }, 404);
                if (error.code === grpc.status.ALREADY_EXISTS) return c.json({ error: error.message }, 409);
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // GET /employees/departments/{id}
    openapi(
        {
            method: 'get',
            path: '/employees/departments/{id}',
            tags: ['Employee Department'],
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const res = await new Promise((resolve, reject) => {
                    empDepartment.GetEmployeeDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });
                if (!res) return c.json({ error: 'Not found' }, 404);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // GET /employees/{employeeId}/departments
    openapi(
        {
            method: 'get',
            path: '/employees/{employeeId}/departments',
            tags: ['Employee Department'],
            request: {
                params: z.object({ employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/) }),
                query: z.object({
                    department_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['start_date', 'end_date']).default('start_date'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: { 200: { description: 'List of department assignments' } },
        },
        async (c) => {
            try {
                const employeeId = c.req.param('employeeId');
                const q = c.req.valid('query');
                const payload = { employee_id: employeeId, ...q };

                const res = await new Promise((resolve, reject) => {
                    empDepartment.ListEmployeeDepartments(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // PUT /employees/departments/{id}
    const updateSchema = assignSchema.extend({ id: z.string() }).partial();
    openapi(
        {
            method: 'put',
            path: '/employees/departments/{id}',
            tags: ['Employee Department'],
            request: {
                params: z.object({ id: z.string() }),
                body: { content: { 'application/json': { schema: updateSchema.omit({ id: true }) } } },
            },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateSchema.parse({ ...body, id });

                const payload = {
                    id: parsed.id,
                    department_id: parsed.department_id ?? null,
                    employee_id: parsed.employee_id ?? null,
                    start_date: parsed.start_date ?? null,
                    end_date: parsed.end_date ?? null,
                };

                const res = await new Promise((resolve, reject) => {
                    empDepartment.UpdateEmployeeDepartment(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.employee_department);
                    });
                });

                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // DELETE /employees/departments/{id}
    openapi(
        {
            method: 'delete',
            path: '/employees/departments/{id}',
            tags: ['Employee Department'],
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) } } } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const res = await new Promise((resolve, reject) => {
                    empDepartment.RemoveEmployeeDepartment({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );
}