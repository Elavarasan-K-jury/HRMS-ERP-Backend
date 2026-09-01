import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { bandClient } from '../grpc/band.client.js';

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

export default function registerBandRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Name is required').max(100, 'Name must be at most 100 characters').transform(s => s.trim()),
        description: z.string().max(2000).optional().nullable(),
        order: z.coerce.number().int('Order must be an integer').min(0, 'Order must be 0 or greater').optional().default(0),
    }).strict();

    const updateSchema = createSchema.extend({ id: objectId }).partial();

    // POST /bands
    openapi(
        {
            method: 'post',
            path: '/bands',
            tags: ['Band'],
            summary: 'Create a new band',
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

                const res = await grpcCall(bandClient, 'CreateBand', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    description: parsed.description ?? null,
                    order: parsed.order,
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

    // GET /bands/all  (registered before /bands/{id} so "all" is not captured by {id})
    openapi(
        {
            method: 'get',
            path: '/bands/all',
            tags: ['Band'],
            summary: 'List all bands (lightweight, for dropdowns)',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(bandClient, 'ListAllBands', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /bands/{id}
    openapi(
        {
            method: 'get',
            path: '/bands/{id}',
            tags: ['Band'],
            summary: 'Get a band',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: { description: 'Band' }, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(bandClient, 'GetBand', {
                    id: c.req.param('id'),
                    organization_id: c.req.query('organization_id') || '',
                });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /bands
    openapi(
        {
            method: 'get',
            path: '/bands',
            tags: ['Band'],
            summary: 'List bands',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'order', 'created_at', 'updated_at']).default('order'),
                    sort_order: z.enum(['asc', 'desc']).default('asc'),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(bandClient, 'ListBands', q);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PUT /bands/{id}
    openapi(
        {
            method: 'put',
            path: '/bands/{id}',
            tags: ['Band'],
            summary: 'Update a band',
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

                const res = await grpcCall(bandClient, 'UpdateBand', {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    name: parsed.name ?? null,
                    description: parsed.description ?? null,
                    order: parsed.order ?? null,
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

    // DELETE /bands/{id}
    openapi(
        {
            method: 'delete',
            path: '/bands/{id}',
            tags: ['Band'],
            summary: 'Delete a band',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: {}, 404: {}, 412: { description: 'Has designations/employees assigned' } },
        },
        async (c) => {
            try {
                const res = await grpcCall(bandClient, 'DeleteBand', {
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