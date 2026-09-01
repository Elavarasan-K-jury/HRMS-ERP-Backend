import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { usageTypeClient } from '../grpc/usage_type.client.js';

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

export default function registerUsageTypeRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Type Name is required').transform(s => s.trim()),
        description: z.string().optional().nullable(),
        is_active: z.boolean().optional(),
    }).strict();

    const updateSchema = z.object({
        name: z.string().min(1).transform(s => s.trim()).optional(),
        description: z.string().optional().nullable(),
        is_active: z.boolean().optional(),
    }).strict();

    // POST /usage-types
    openapi(
        {
            method: 'post',
            path: '/usage-types',
            tags: ['Usage-Type'],
            summary: 'Create a new usage type',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: { 201: { description: 'Created' }, 400: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);
                const res = await grpcCall(usageTypeClient, 'CreateUsageType', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    description: parsed.description ?? '',
                    is_active: parsed.is_active ?? true,
                });
                return c.json(res, 201);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /usage-types/{id}
    openapi(
        {
            method: 'get',
            path: '/usage-types/{id}',
            tags: ['Usage-Type'],
            summary: 'Get a usage type',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(usageTypeClient, 'GetUsageType', { id: c.req.param('id') });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /usage-types
    openapi(
        {
            method: 'get',
            path: '/usage-types',
            tags: ['Usage-Type'],
            summary: 'List usage types',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                    is_active_only: z.enum(['true', 'false']).optional(),
                }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(usageTypeClient, 'ListUsageTypes', {
                    organization_id: q.organization_id ?? '',
                    page: q.page,
                    limit: q.limit,
                    search: q.search,
                    sort_by: q.sort_by,
                    sort_order: q.sort_order,
                    is_active_only: q.is_active_only === 'true',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PUT /usage-types/{id}
    openapi(
        {
            method: 'put',
            path: '/usage-types/{id}',
            tags: ['Usage-Type'],
            summary: 'Update a usage type',
            request: { params: z.object({ id: objectId }), body: { content: { 'application/json': { schema: updateSchema } } } },
            responses: { 200: {}, 400: {}, 404: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = updateSchema.parse(body);
                const payload = {
                    id: c.req.param('id'),
                    name: parsed.name ?? '',
                    description: parsed.description ?? '',
                };
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                // organization_id not required for update but pass if provided
                if (body.organization_id) payload.organization_id = body.organization_id;
                const res = await grpcCall(usageTypeClient, 'UpdateUsageType', payload);
                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PATCH /usage-types/{id}/status
    openapi(
        {
            method: 'patch',
            path: '/usage-types/{id}/status',
            tags: ['Usage-Type'],
            summary: 'Activate/Deactivate usage type',
            request: {
                params: z.object({ id: objectId }),
                body: { content: { 'application/json': { schema: z.object({ is_active: z.boolean(), organization_id: objectId.optional() }) } } },
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(usageTypeClient, 'UpdateUsageTypeStatus', {
                    id: c.req.param('id'),
                    organization_id: body.organization_id ?? '',
                    is_active: body.is_active,
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // DELETE /usage-types/{id}
    openapi(
        {
            method: 'delete',
            path: '/usage-types/{id}',
            tags: ['Usage-Type'],
            summary: 'Delete a usage type',
            request: { params: z.object({ id: objectId }), query: z.object({ organization_id: objectId.optional() }) },
            responses: { 200: {}, 404: {}, 412: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(usageTypeClient, 'DeleteUsageType', { id: c.req.param('id'), organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );
}
