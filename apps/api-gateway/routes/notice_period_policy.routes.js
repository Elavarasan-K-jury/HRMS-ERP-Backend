import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { noticePeriodPolicyClient } from '../grpc/notice_period_policy.client.js';

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

export default function registerNoticePeriodPolicyRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid organization_id'),
        title: z.string().min(1, 'Title is required').max(100, 'Title must be at most 100 characters').transform(s => s.trim()),
        description: z.string().max(500).optional().nullable(),
        duration_value: z.coerce.number().int('Duration must be an integer').min(1, 'Duration must be at least 1'),
        duration_unit: z.enum(['DAYS', 'MONTHS'], { errorMap: () => ({ message: 'Duration unit must be DAYS or MONTHS' }) }),
        is_default: z.boolean().optional().default(false),
    }).strict();

    const updateSchema = createSchema.extend({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }).partial();

    // POST /notice-period-policies
    openapi(
        {
            method: 'post',
            path: '/notice-period-policies',
            tags: ['Notice Period Policy'],
            summary: 'Create a new notice period policy',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: {
                201: { description: 'Created' },
                400: { description: 'Validation error' },
                409: { description: 'Title already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);

                const res = await grpcCall(noticePeriodPolicyClient, 'CreatePolicy', {
                    organization_id: parsed.organization_id,
                    title: parsed.title,
                    description: parsed.description ?? null,
                    duration_value: parsed.duration_value,
                    duration_unit: parsed.duration_unit,
                    is_default: parsed.is_default,
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

    // GET /notice-period-policies/all (lightweight for dropdowns)
    openapi(
        {
            method: 'get',
            path: '/notice-period-policies/all',
            tags: ['Notice Period Policy'],
            summary: 'List all policies (lightweight, for dropdowns)',
            request: {
                query: z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(noticePeriodPolicyClient, 'ListPolicies', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /notice-period-policies/{id}
    openapi(
        {
            method: 'get',
            path: '/notice-period-policies/{id}',
            tags: ['Notice Period Policy'],
            summary: 'Get a notice period policy',
            request: { params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }) },
            responses: { 200: { description: 'Policy' }, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(noticePeriodPolicyClient, 'GetPolicy', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /notice-period-policies
    openapi(
        {
            method: 'get',
            path: '/notice-period-policies',
            tags: ['Notice Period Policy'],
            summary: 'List notice period policies',
            request: {
                query: z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['title', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(noticePeriodPolicyClient, 'ListPolicies', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PUT /notice-period-policies/{id}
    openapi(
        {
            method: 'put',
            path: '/notice-period-policies/{id}',
            tags: ['Notice Period Policy'],
            summary: 'Update a notice period policy',
            request: {
                params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
                body: { content: { 'application/json': { schema: updateSchema.omit({ id: true }) } } },
            },
            responses: { 200: {}, 400: {}, 404: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = updateSchema.parse({ ...body, id: c.req.param('id') });

                const res = await grpcCall(noticePeriodPolicyClient, 'UpdatePolicy', {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    title: parsed.title ?? null,
                    description: parsed.description ?? null,
                    duration_value: parsed.duration_value ?? null,
                    duration_unit: parsed.duration_unit ?? null,
                    is_default: parsed.is_default ?? null,
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

    // PATCH /notice-period-policies/{id}/default
    openapi(
        {
            method: 'patch',
            path: '/notice-period-policies/{id}/default',
            tags: ['Notice Period Policy'],
            summary: 'Set or unset default policy',
            request: {
                params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
                body: { content: { 'application/json': { schema: z.object({ is_default: z.boolean() }) } } },
            },
            responses: { 200: {}, 400: {}, 404: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(noticePeriodPolicyClient, 'SetDefaultPolicy', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                    is_default: body.is_default,
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // DELETE /notice-period-policies/{id}
    openapi(
        {
            method: 'delete',
            path: '/notice-period-policies/{id}',
            tags: ['Notice Period Policy'],
            summary: 'Delete a notice period policy',
            request: { params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }) },
            responses: { 200: {}, 404: {}, 412: { description: 'Has employees assigned' } },
        },
        async (c) => {
            try {
                const res = await grpcCall(noticePeriodPolicyClient, 'DeletePolicy', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // Employee assignment routes

    // GET /notice-period-policies/{id}/employees
    openapi(
        {
            method: 'get',
            path: '/notice-period-policies/{id}/employees',
            tags: ['Notice Period Policy'],
            summary: 'Get employees assigned to a policy',
            request: {
                params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
                query: z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
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
                const res = await grpcCall(noticePeriodPolicyClient, 'GetPolicyEmployees', {
                    id: c.req.param('id'),
                    organization_id: q.organization_id || '',
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

    // POST /notice-period-policies/{id}/employees
    openapi(
        {
            method: 'post',
            path: '/notice-period-policies/{id}/employees',
            tags: ['Notice Period Policy'],
            summary: 'Assign employees to a policy',
            request: {
                params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
                body: { content: { 'application/json': { schema: z.object({ employee_ids: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1) }) } } },
            },
            responses: { 200: {}, 400: {}, 404: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(noticePeriodPolicyClient, 'AssignEmployees', {
                    policy_id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
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

    // DELETE /notice-period-policies/{id}/employees/{employeeId}
    openapi(
        {
            method: 'delete',
            path: '/notice-period-policies/{id}/employees/{employeeId}',
            tags: ['Notice Period Policy'],
            summary: 'Remove an employee from a policy',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                    employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid employee id'),
                }),
            },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(noticePeriodPolicyClient, 'RemoveEmployee', {
                    policy_id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                    employee_id: c.req.param('employeeId'),
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );
}
