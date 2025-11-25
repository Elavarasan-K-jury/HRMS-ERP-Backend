import { z, ZodError } from 'zod';
import { orgDesignationClient } from '../grpc/org_designation.client.js';

export default function registerorgDesignationRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid organization_id'),
        department_id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().nullable(),
        name: z.string().min(2, 'Name must be at least 2 characters'),
        level: z.string().optional(),
        description: z.string().optional(),
    }).strict();

    // POST /designations
    openapi(
        {
            method: 'post',
            path: '/designations',
            tags: ['Org-Designation'],
            summary: 'Create a new designation',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: {
                201: { description: 'Created', content: { 'application/json': { schema: z.object({ id: z.string(), name: z.string() }) } } },
                400: { description: 'Validation error' },
                409: { description: 'Name already exists' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);

                const payload = {
                    organization_id: parsed.organization_id,
                    department_id: parsed.department_id ?? null,
                    name: parsed.name,
                    level: parsed.level ?? null,
                    description: parsed.description ?? null,
                };

                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.CreateDesignation(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(res, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // GET /designations/{id}
    openapi(
        {
            method: 'get',
            path: '/designation/{id}',
            tags: ['Org-Designation'],
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Designation' }, 404: {} },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.GetDesignation({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                if (!res) return c.json({ error: 'Not found' }, 404);
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // GET /designations (list)
    openapi(
        {
            method: 'get',
            path: '/designations/all',
            tags: ['Org-Designation'],
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.ListAllDesignations(q, (err, resp) => {
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

    // GET /designations (list)
    openapi(
        {
            method: 'get',
            path: '/designations',
            tags: ['Org-Designation'],
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    department_id: z.string().optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'level', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                }),
            },
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.ListDesignations(q, (err, resp) => {
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

    // PUT /designations/{id}
    const updateSchema = createSchema.extend({ id: z.string() }).partial();
    openapi(
        {
            method: 'put',
            path: '/designations/{id}',
            tags: ['Org-Designation'],
            request: {
                params: z.object({ id: z.string() }),
                body: { content: { 'application/json': { schema: updateSchema.omit({ id: true }) } } },
            },
            responses: { 200: {}, 404: {}, 409: {} },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateSchema.parse({ ...body, id });

                const payload = {
                    id: parsed.id,
                    organization_id: parsed.organization_id ?? null,
                    department_id: parsed.department_id ?? null,
                    name: parsed.name ?? null,
                    level: parsed.level ?? null,
                    description: parsed.description ?? null,
                };

                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.UpdateDesignation(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // DELETE /designations/{id}
    openapi(
        {
            method: 'delete',
            path: '/designations/{id}',
            tags: ['Org-Designation'],
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) } } } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const res = await new Promise((resolve, reject) => {
                    orgDesignationClient.DeleteDesignation({ id }, (err, resp) => {
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