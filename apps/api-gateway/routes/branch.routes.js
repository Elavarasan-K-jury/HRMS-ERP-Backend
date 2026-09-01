import { z } from 'zod';
import { ZodError } from 'zod';
import { branchClient } from '../grpc/branch.client.js';
import dotenv from 'dotenv';
dotenv.config();

export default function registerBranchRoutes({ openapi }) {

    /* ──────────────────────────────────────────────────────────
       POST /api/v1/organizations/{organization_id}/branches
       Create branch
    ────────────────────────────────────────────────────────── */
    const createBranchSchema = z.object({
        name: z.string().min(2, 'Name must have at least 2 characters'),
        code: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
    }).strict();

    openapi(
        {
            method: 'post',
            path: '/api/v1/organizations/{organization_id}/branches',
            tags: ['Branch'],
            summary: 'Create a new branch under an organization',
            request: {
                params: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: createBranchSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Branch created successfully' },
                400: { description: 'Invalid input' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = createBranchSchema.parse(body);

                const grpcPayload = {
                    organization_id,
                    name: parsed.name,
                    code: parsed.code || '',
                    description: parsed.description || '',
                };

                const response = await new Promise((resolve, reject) => {
                    branchClient.CreateBranch(grpcPayload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ──────────────────────────────────────────────────────────
       GET /api/v1/organizations/{organization_id}/branches
       List branches (paginated)
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'get',
            path: '/api/v1/organizations/{organization_id}/branches',
            tags: ['Branch'],
            summary: 'List branches under an organization',
            request: {
                params: z.object({
                    organization_id: z.string(),
                }),
                query: z.object({
                    page: z
                        .string()
                        .optional()
                        .default('1')
                        .transform((v) => parseInt(v, 10)),
                    limit: z
                        .string()
                        .optional()
                        .default('10')
                        .transform((v) => parseInt(v, 10)),
                    search: z.string().optional(),
                    sort_by: z.enum(['created_at', 'name']).optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: { description: 'List of branches' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const query = c.req.valid('query');

                const grpcPayload = {
                    organization_id,
                    page: query.page,
                    limit: query.limit,
                    search: query.search || '',
                    sort_by: query.sort_by,
                    sort_order: query.sort_order,
                };

                const response = await new Promise((resolve, reject) => {
                    branchClient.ListBranches(grpcPayload, (err, resp) => {
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

    /* ──────────────────────────────────────────────────────────
       GET /api/v1/branches/{id}
       Get single branch
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'get',
            path: '/api/v1/branches/{id}',
            tags: ['Branch'],
            summary: 'Get a branch by ID',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid branch ID format'),
                }),
            },
            responses: {
                200: { description: 'Branch details' },
                404: { description: 'Branch not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    branchClient.GetBranch({ id }, (err, resp) => {
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

    /* ──────────────────────────────────────────────────────────
       PUT /api/v1/branches/{id}
       Update branch
    ────────────────────────────────────────────────────────── */
    const updateBranchSchema = z.object({
        name: z.string().min(2).optional(),
        code: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        is_active: z.boolean().optional(),
    });

    openapi(
        {
            method: 'put',
            path: '/api/v1/branches/{id}',
            tags: ['Branch'],
            summary: 'Update a branch',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid branch ID format'),
                }),
                body: {
                    content: { 'application/json': { schema: updateBranchSchema } },
                },
            },
            responses: {
                200: { description: 'Branch updated' },
                400: { description: 'Invalid input' },
                404: { description: 'Branch not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = updateBranchSchema.parse(body);

                const grpcPayload = {
                    id,
                    name: parsed.name || '',
                    code: parsed.code,
                    description: parsed.description,
                    is_active: parsed.is_active,
                };

                const response = await new Promise((resolve, reject) => {
                    branchClient.UpdateBranch(grpcPayload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ──────────────────────────────────────────────────────────
       DELETE /api/v1/branches/{id}
       Soft delete branch
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'delete',
            path: '/api/v1/branches/{id}',
            tags: ['Branch'],
            summary: 'Soft delete a branch',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid branch ID format'),
                }),
            },
            responses: {
                200: { description: 'Branch deleted' },
                404: { description: 'Branch not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    branchClient.DeleteBranch({ id }, (err, resp) => {
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
