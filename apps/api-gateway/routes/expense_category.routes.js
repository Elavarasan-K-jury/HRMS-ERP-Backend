import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { expenseCategoryClient } from '../grpc/expense_category.client.js';

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

export default function registerExpenseCategoryRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Name is required').transform(s => s.trim()),
        expense_code: z.string().min(1, 'Expense Code is required').transform(s => s.trim()),
        icon: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        usage_type_id: objectId,
        is_active: z.boolean().optional(),
    }).strict();

    const updateSchema = z.object({
        name: z.string().min(1).transform(s => s.trim()).optional(),
        expense_code: z.string().min(1).transform(s => s.trim()).optional(),
        icon: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        usage_type_id: objectId.optional(),
        is_active: z.boolean().optional(),
    }).strict();

    // POST /expense-categories
    openapi(
        {
            method: 'post',
            path: '/expense-categories',
            tags: ['Expense-Category'],
            summary: 'Create expense category',
            request: { body: { content: { 'application/json': { schema: createSchema } } } },
            responses: { 201: {}, 400: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);
                const res = await grpcCall(expenseCategoryClient, 'CreateExpenseCategory', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    expense_code: parsed.expense_code,
                    icon: parsed.icon ?? '',
                    description: parsed.description ?? '',
                    usage_type_id: parsed.usage_type_id,
                    is_active: parsed.is_active ?? true,
                });
                return c.json(res, 201);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /expense-categories/{id}
    openapi(
        {
            method: 'get',
            path: '/expense-categories/{id}',
            tags: ['Expense-Category'],
            summary: 'Get expense category',
            request: { params: z.object({ id: objectId }) },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const res = await grpcCall(expenseCategoryClient, 'GetExpenseCategory', { id: c.req.param('id') });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // GET /expense-categories
    openapi(
        {
            method: 'get',
            path: '/expense-categories',
            tags: ['Expense-Category'],
            summary: 'List expense categories',
            request: {
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                    sort_by: z.enum(['name', 'expense_code', 'created_at', 'updated_at']).default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).default('desc'),
                    is_active_only: z.enum(['true', 'false']).optional(),
                }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expenseCategoryClient, 'ListExpenseCategories', {
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

    // PUT /expense-categories/{id}
    openapi(
        {
            method: 'put',
            path: '/expense-categories/{id}',
            tags: ['Expense-Category'],
            summary: 'Update expense category',
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
                    expense_code: parsed.expense_code ?? '',
                    icon: parsed.icon ?? '',
                    description: parsed.description ?? '',
                };
                if (parsed.usage_type_id !== undefined) payload.usage_type_id = parsed.usage_type_id;
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                if (body.organization_id) payload.organization_id = body.organization_id;
                const res = await grpcCall(expenseCategoryClient, 'UpdateExpenseCategory', payload);
                return c.json(res);
            } catch (error) {
                if (error instanceof ZodError) return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );

    // PATCH /expense-categories/{id}/status
    openapi(
        {
            method: 'patch',
            path: '/expense-categories/{id}/status',
            tags: ['Expense-Category'],
            summary: 'Activate/Deactivate expense category',
            request: {
                params: z.object({ id: objectId }),
                body: { content: { 'application/json': { schema: z.object({ is_active: z.boolean(), organization_id: objectId.optional() }) } } },
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(expenseCategoryClient, 'UpdateExpenseCategoryStatus', {
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

    // DELETE /expense-categories/{id}
    openapi(
        {
            method: 'delete',
            path: '/expense-categories/{id}',
            tags: ['Expense-Category'],
            summary: 'Delete expense category',
            request: { params: z.object({ id: objectId }), query: z.object({ organization_id: objectId.optional() }) },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expenseCategoryClient, 'DeleteExpenseCategory', { id: c.req.param('id'), organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        }
    );
}
