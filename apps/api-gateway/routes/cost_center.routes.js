import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { costCenterClient } from '../grpc/cost_center.client.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

function grpcToHttpStatus(code) {
    switch (code) {
        case grpc.status.INVALID_ARGUMENT: return 400;
        case grpc.status.NOT_FOUND: return 404;
        case grpc.status.ALREADY_EXISTS: return 409;
        case grpc.status.PERMISSION_DENIED: return 403;
        case grpc.status.FAILED_PRECONDITION: return 412;
        case grpc.status.UNAVAILABLE: return 503;
        default: return 500;
    }
}

function grpcCall(client, method, payload) {
    return new Promise((resolve, reject) => {
        client[method](payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
        });
    });
}

export default function registerCostCenterRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Name is required').transform(s => s.trim()),
        code: z.string().min(1, 'Code is required').transform(s => s.trim()),
        description: z.string().optional().nullable(),
        is_active: z.boolean().optional(),
    }).strict();

    const updateSchema = createSchema.extend({ id: objectId }).partial();

    // POST /cost-centers
    openapi(
        {
            method: 'post',
            path: '/cost-centers',
            tags: ['Cost-Center'],
            summary: 'Create a new cost center',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: {
                201: { description: 'Created' },
                400: { description: 'Validation error' },
                409: { description: 'Name/Code already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);

                const res = await grpcCall(costCenterClient, 'CreateCostCenter', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    code: parsed.code,
                    description: parsed.description ?? null,
                });

                return c.json(res, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /cost-centers/{id}
    openapi(
        {
            method: 'get',
            path: '/cost-centers/{id}',
            tags: ['Cost-Center'],
            summary: 'Get a cost center',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: { description: 'Cost center' }, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(costCenterClient, 'GetCostCenter', { id: c.req.param('id') });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /cost-centers
    openapi(
        {
            method: 'get',
            path: '/cost-centers',
            tags: ['Cost-Center'],
            summary: 'List cost centers',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'code', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(costCenterClient, 'ListCostCenters', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PUT /cost-centers/{id}
    openapi(
        {
            method: 'put',
            path: '/cost-centers/{id}',
            tags: ['Cost-Center'],
            summary: 'Update a cost center',
            request: {
                params: z.object({ id: objectId }),
                body: { content: { 'application/json': { schema: updateSchema.omit({ id: true }) } } },
            },
            responses: { 200: {}, 400: {}, 404: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = updateSchema.parse({ ...body, id: c.req.param('id') });

                const payload = {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    name: parsed.name ?? null,
                    code: parsed.code ?? null,
                    description: parsed.description ?? null,
                };
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;

                const res = await grpcCall(costCenterClient, 'UpdateCostCenter', payload);
                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // DELETE /cost-centers/{id}
    openapi(
        {
            method: 'delete',
            path: '/cost-centers/{id}',
            tags: ['Cost-Center'],
            summary: 'Delete a cost center',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: {}, 404: {}, 412: { description: 'Has employees assigned' } },
        },
        async (c) => {
            try {
                const res = await grpcCall(costCenterClient, 'DeleteCostCenter', { id: c.req.param('id') });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /cost-centers/{id}/employees
    openapi(
        {
            method: 'get',
            path: '/cost-centers/{id}/employees',
            tags: ['Cost-Center'],
            summary: 'List employees assigned to a cost center',
            request: {
                params: z.object({ id: objectId }),
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(costCenterClient, 'ListCostCenterEmployees', {
                    cost_center_id: c.req.param('id'),
                    organization_id: q.organization_id ?? '',
                    page: q.page,
                    limit: q.limit,
                    search: q.search,
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // POST /cost-centers/{id}/assign-employees
    openapi(
        {
            method: 'post',
            path: '/cost-centers/{id}/assign-employees',
            tags: ['Cost-Center'],
            summary: 'Assign employees to a cost center',
            request: {
                params: z.object({ id: objectId }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: objectId.optional(),
                                employee_ids: z.array(objectId).min(1, 'Select at least one employee'),
                            }),
                        },
                    },
                },
            },
            responses: { 200: {}, 400: {}, 404: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(costCenterClient, 'AssignEmployeesToCostCenter', {
                    cost_center_id: c.req.param('id'),
                    organization_id: body.organization_id ?? '',
                    employee_ids: body.employee_ids,
                });
                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // POST /cost-centers/{id}/remove-employee
    openapi(
        {
            method: 'post',
            path: '/cost-centers/{id}/remove-employee',
            tags: ['Cost-Center'],
            summary: 'Remove an employee from a cost center',
            request: {
                params: z.object({ id: objectId }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: objectId.optional(),
                                employee_id: objectId,
                            }),
                        },
                    },
                },
            },
            responses: { 200: {}, 400: {}, 404: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(costCenterClient, 'RemoveEmployeeFromCostCenter', {
                    cost_center_id: c.req.param('id'),
                    organization_id: body.organization_id ?? '',
                    employee_id: body.employee_id,
                });
                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );
}