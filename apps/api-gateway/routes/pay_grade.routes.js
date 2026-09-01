import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { payGradeClient } from '../grpc/pay_grade.client.js';

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

export default function registerPayGradeRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Name is required').max(100, 'Name must be at most 100 characters').transform(s => s.trim()),
        description: z.string().max(2000).optional().nullable(),
    }).strict();

    const updateSchema = createSchema.extend({ id: objectId }).partial();

    // POST /pay-grades
    openapi(
        {
            method: 'post',
            path: '/pay-grades',
            tags: ['Pay-Grade'],
            summary: 'Create a new pay grade',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: {
                201: { description: 'Created' },
                400: { description: 'Validation error' },
                409: { description: 'Name already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);

                const res = await grpcCall(payGradeClient, 'CreatePayGrade', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
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

    // GET /pay-grades/{id}
    openapi(
        {
            method: 'get',
            path: '/pay-grades/{id}',
            tags: ['Pay-Grade'],
            summary: 'Get a pay grade',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: { description: 'Pay grade' }, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(payGradeClient, 'GetPayGrade', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /pay-grades
    openapi(
        {
            method: 'get',
            path: '/pay-grades',
            tags: ['Pay-Grade'],
            summary: 'List pay grades',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(payGradeClient, 'ListPayGrades', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PUT /pay-grades/{id}
    openapi(
        {
            method: 'put',
            path: '/pay-grades/{id}',
            tags: ['Pay-Grade'],
            summary: 'Update a pay grade',
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

                const res = await grpcCall(payGradeClient, 'UpdatePayGrade', {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    name: parsed.name ?? null,
                    description: parsed.description ?? null,
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

    // DELETE /pay-grades/{id}
    openapi(
        {
            method: 'delete',
            path: '/pay-grades/{id}',
            tags: ['Pay-Grade'],
            summary: 'Delete a pay grade',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: {}, 404: {}, 412: { description: 'Has employees assigned' } },
        },
        async (c) => {
            try {
                const res = await grpcCall(payGradeClient, 'DeletePayGrade', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );
}