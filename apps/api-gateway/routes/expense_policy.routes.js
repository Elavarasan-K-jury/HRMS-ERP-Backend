import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { expensePolicyClient } from '../grpc/expense_policy.client.js';

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

const approvalLevelSchema = z.object({
    level: z.number().int().min(1).optional(),
    approver_type: z.enum(['EMPLOYEE', 'ROLE']),
    approver_id: objectId,
    approver_name: z.string().optional().nullable(),
    auto_approve: z.boolean().optional(),
    auto_approve_days: z.number().int().min(1).optional().nullable(),
});

export default function registerExpensePolicyRoutes({ openapi }) {
    const createSchema = z.object({
        organization_id: objectId,
        name: z.string().min(1, 'Policy Name is required').transform(s => s.trim()),
        description: z.string().optional().nullable(),
        base_currency: z.string().min(1, 'Base Currency is required').transform(s => s.trim()),
        payout_mode: z.string().optional().nullable(),
        allow_future_date_claims: z.boolean().optional(),
        approval_required: z.boolean().optional(),
        approval_mode: z.enum(['SAME_FOR_ALL', 'BY_CATEGORY']).optional().nullable(),
        is_active: z.boolean().optional(),
        approval_levels: z.array(approvalLevelSchema).optional(),
    }).strict();

    const updateSchema = z.object({
        organization_id: objectId.optional(),
        name: z.string().min(1).transform(s => s.trim()).optional(),
        description: z.string().optional().nullable(),
        base_currency: z.string().min(1).transform(s => s.trim()).optional(),
        payout_mode: z.string().optional().nullable(),
        allow_future_date_claims: z.boolean().optional(),
        approval_required: z.boolean().optional(),
        approval_mode: z.enum(['SAME_FOR_ALL', 'BY_CATEGORY']).optional().nullable(),
        is_active: z.boolean().optional(),
        approval_levels: z.array(approvalLevelSchema).optional(),
    }).strict();

    openapi({ method: 'post', path: '/expense-policies', tags: ['Expense-Policy'], summary: 'Create expense policy', request: { body: { content: { 'application/json': { schema: createSchema } } } }, responses: { 201: {}, 400: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);
                const res = await grpcCall(expensePolicyClient, 'CreateExpensePolicy', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    description: parsed.description ?? '',
                    base_currency: parsed.base_currency,
                    payout_mode: parsed.payout_mode ?? '',
                    allow_future_date_claims: parsed.allow_future_date_claims ?? false,
                    approval_required: parsed.approval_required ?? false,
                    approval_mode: parsed.approval_mode ?? '',
                    is_active: parsed.is_active ?? true,
                    approval_levels: (parsed.approval_levels || []).map(l => ({
                        level: l.level ?? 0,
                        approver_type: l.approver_type,
                        approver_id: l.approver_id,
                        approver_name: l.approver_name ?? '',
                        auto_approve: l.auto_approve ?? false,
                        auto_approve_days: l.auto_approve_days ?? 0,
                    })),
                });
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/expense-policies/{id}', tags: ['Expense-Policy'], summary: 'Get expense policy', request: { params: z.object({ id: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'GetExpensePolicy', { id: c.req.param('id'), organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/expense-policies', tags: ['Expense-Policy'], summary: 'List expense policies', request: { query: z.object({ organization_id: objectId.optional(), page: z.string().transform(Number).default('1'), limit: z.string().transform(Number).default('10'), search: z.string().default(''), sort_by: z.enum(['name', 'base_currency', 'created_at', 'updated_at']).default('created_at'), sort_order: z.enum(['asc', 'desc']).default('desc'), is_active_only: z.enum(['true', 'false']).optional() }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'ListExpensePolicies', {
                    organization_id: q.organization_id ?? '',
                    page: q.page,
                    limit: q.limit,
                    search: q.search,
                    sort_by: q.sort_by,
                    sort_order: q.sort_order,
                    is_active_only: q.is_active_only === 'true',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'put', path: '/expense-policies/{id}', tags: ['Expense-Policy'], summary: 'Update expense policy', request: { params: z.object({ id: objectId }), body: { content: { 'application/json': { schema: updateSchema } } } }, responses: { 200: {}, 400: {}, 404: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = updateSchema.parse(body);
                const payload = {
                    id: c.req.param('id'),
                    name: parsed.name ?? '',
                    description: parsed.description ?? '',
                    base_currency: parsed.base_currency ?? '',
                    payout_mode: parsed.payout_mode ?? '',
                };
                if (parsed.allow_future_date_claims !== undefined) payload.allow_future_date_claims = parsed.allow_future_date_claims;
                if (parsed.approval_required !== undefined) payload.approval_required = parsed.approval_required;
                if (parsed.approval_mode !== undefined) payload.approval_mode = parsed.approval_mode ?? '';
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                if (parsed.organization_id) payload.organization_id = parsed.organization_id;
                if (parsed.approval_levels !== undefined) {
                    payload.approval_levels = (parsed.approval_levels || []).map(l => ({
                        level: l.level ?? 0,
                        approver_type: l.approver_type,
                        approver_id: l.approver_id,
                        approver_name: l.approver_name ?? '',
                        auto_approve: l.auto_approve ?? false,
                        auto_approve_days: l.auto_approve_days ?? 0,
                    }));
                }
                const res = await grpcCall(expensePolicyClient, 'UpdateExpensePolicy', payload);
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'patch', path: '/expense-policies/{id}/status', tags: ['Expense-Policy'], summary: 'Activate/Deactivate', request: { params: z.object({ id: objectId }), body: { content: { 'application/json': { schema: z.object({ is_active: z.boolean(), organization_id: objectId.optional() }) } } } }, responses: { 200: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const res = await grpcCall(expensePolicyClient, 'UpdateExpensePolicyStatus', { id: c.req.param('id'), organization_id: body.organization_id ?? '', is_active: body.is_active });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'delete', path: '/expense-policies/{id}', tags: ['Expense-Policy'], summary: 'Delete expense policy', request: { params: z.object({ id: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 412: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'DeleteExpensePolicy', { id: c.req.param('id'), organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // POST /expense-policies/{id}/categories - Add categories
    openapi(
        {
            method: 'post',
            path: '/expense-policies/{id}/categories',
            tags: ['Expense-Policy'],
            summary: 'Add expense categories to policy',
            request: {
                params: z.object({ id: objectId }),
                body: { content: { 'application/json': { schema: z.object({ organization_id: objectId.optional(), expense_category_ids: z.array(objectId).min(1, 'Select at least one category') }) } } },
            },
            responses: { 200: {}, 400: {}, 404: {}, 409: {} },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId.optional(), expense_category_ids: z.array(objectId).min(1) }).parse(body);
                const res = await grpcCall(expensePolicyClient, 'AddPolicyCategories', {
                    expense_policy_id: c.req.param('id'),
                    organization_id: parsed.organization_id ?? '',
                    expense_category_ids: parsed.expense_category_ids,
                });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        }
    );

    // GET /expense-policies/{id}/categories
    openapi(
        {
            method: 'get',
            path: '/expense-policies/{id}/categories',
            tags: ['Expense-Policy'],
            summary: 'List expense categories attached to policy',
            request: {
                params: z.object({ id: objectId }),
                query: z.object({
                    organization_id: objectId.optional(),
                    page: z.string().transform(Number).default('1'),
                    limit: z.string().transform(Number).default('10'),
                    search: z.string().default(''),
                }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'ListPolicyCategories', {
                    expense_policy_id: c.req.param('id'),
                    organization_id: q.organization_id ?? '',
                    page: q.page,
                    limit: q.limit,
                    search: q.search,
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // DELETE /expense-policies/{id}/categories/{categoryId}
    openapi(
        {
            method: 'delete',
            path: '/expense-policies/{id}/categories/{categoryId}',
            tags: ['Expense-Policy'],
            summary: 'Remove expense category from policy',
            request: {
                params: z.object({ id: objectId, categoryId: objectId }),
                query: z.object({ organization_id: objectId.optional() }),
            },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'RemovePolicyCategory', {
                    expense_policy_id: c.req.param('id'),
                    expense_category_id: c.req.param('categoryId'),
                    organization_id: q.organization_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // GET /expense-policies/{id}/categories/{categoryId}/rules
    openapi(
        {
            method: 'get',
            path: '/expense-policies/{id}/categories/{categoryId}/rules',
            tags: ['Expense-Policy'],
            summary: 'Get category rules',
            request: {
                params: z.object({ id: objectId, categoryId: objectId }),
                query: z.object({ organization_id: objectId.optional() }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'GetCategoryRules', {
                    expense_policy_id: c.req.param('id'),
                    expense_category_id: c.req.param('categoryId'),
                    organization_id: q.organization_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // PUT /expense-policies/{id}/categories/{categoryId}/rules
    openapi(
        {
            method: 'put',
            path: '/expense-policies/{id}/categories/{categoryId}/rules',
            tags: ['Expense-Policy'],
            summary: 'Update category rules',
            request: {
                params: z.object({ id: objectId, categoryId: objectId }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: objectId.optional(),
                                amount_cap_enabled: z.boolean().optional(),
                                amount_cap_currency: z.string().optional().nullable(),
                                amount_cap_amount: z.number().optional().nullable(),
                                amount_cap_period: z.string().optional().nullable(),
                                combination_enabled: z.boolean().optional(),
                                combination_category_id: z.string().optional().nullable(),
                                combination_period: z.string().optional().nullable(),
                                instances_enabled: z.boolean().optional(),
                                max_instances: z.number().int().optional().nullable(),
                                instances_period: z.string().optional().nullable(),
                                expiry_enabled: z.boolean().optional(),
                                expiry_days: z.number().int().optional().nullable(),
                                cost_center_required: z.boolean().optional(),
                                comment_threshold_enabled: z.boolean().optional(),
                                comment_threshold_amount: z.number().optional().nullable(),
                                receipt_threshold_enabled: z.boolean().optional(),
                                receipt_threshold_amount: z.number().optional().nullable(),
                                threshold_approval_enabled: z.boolean().optional(),
                                threshold_currency: z.string().optional().nullable(),
                                threshold_amount: z.number().optional().nullable(),
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
                const res = await grpcCall(expensePolicyClient, 'UpdateCategoryRules', {
                    expense_policy_id: c.req.param('id'),
                    expense_category_id: c.req.param('categoryId'),
                    organization_id: body.organization_id ?? '',
                    rule: {
                        amount_cap_enabled: body.amount_cap_enabled ?? false,
                        amount_cap_currency: body.amount_cap_currency ?? '',
                        amount_cap_amount: body.amount_cap_amount ?? 0,
                        amount_cap_period: body.amount_cap_period ?? '',
                        combination_enabled: body.combination_enabled ?? false,
                        combination_category_id: body.combination_category_id ?? '',
                        combination_period: body.combination_period ?? '',
                        instances_enabled: body.instances_enabled ?? false,
                        max_instances: body.max_instances ?? 0,
                        instances_period: body.instances_period ?? '',
                        expiry_enabled: body.expiry_enabled ?? false,
                        expiry_days: body.expiry_days ?? 0,
                        cost_center_required: body.cost_center_required ?? false,
                        comment_threshold_enabled: body.comment_threshold_enabled ?? false,
                        comment_threshold_amount: body.comment_threshold_amount ?? 0,
                        receipt_threshold_enabled: body.receipt_threshold_enabled ?? false,
                        receipt_threshold_amount: body.receipt_threshold_amount ?? 0,
                        threshold_approval_enabled: body.threshold_approval_enabled ?? false,
                        threshold_currency: body.threshold_currency ?? '',
                        threshold_amount: body.threshold_amount ?? 0,
                    },
                });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        }
    );

    // GET /expense-policies/{id}/categories/{categoryId}/approval
    openapi(
        {
            method: 'get',
            path: '/expense-policies/{id}/categories/{categoryId}/approval',
            tags: ['Expense-Policy'],
            summary: 'Get category approval chain',
            request: {
                params: z.object({ id: objectId, categoryId: objectId }),
                query: z.object({ organization_id: objectId.optional() }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'GetCategoryApproval', {
                    expense_policy_id: c.req.param('id'),
                    expense_category_id: c.req.param('categoryId'),
                    organization_id: q.organization_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // PUT /expense-policies/{id}/categories/{categoryId}/approval
    openapi(
        {
            method: 'put',
            path: '/expense-policies/{id}/categories/{categoryId}/approval',
            tags: ['Expense-Policy'],
            summary: 'Update category approval chain',
            request: {
                params: z.object({ id: objectId, categoryId: objectId }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: objectId.optional(),
                                levels: z.array(approvalLevelSchema).min(1, 'At least one level required'),
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
                const parsed = z.object({ organization_id: objectId.optional(), levels: z.array(approvalLevelSchema).min(1) }).parse(body);
                const res = await grpcCall(expensePolicyClient, 'UpdateCategoryApproval', {
                    expense_policy_id: c.req.param('id'),
                    expense_category_id: c.req.param('categoryId'),
                    organization_id: parsed.organization_id ?? '',
                    levels: parsed.levels.map(l => ({
                        level: l.level ?? 0,
                        approver_type: l.approver_type,
                        approver_id: l.approver_id,
                        approver_name: l.approver_name ?? '',
                        auto_approve: l.auto_approve ?? false,
                        auto_approve_days: l.auto_approve_days ?? 0,
                    })),
                });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        }
    );

    // GET /expense-policies/{id}/employees
    openapi(
        {
            method: 'get',
            path: '/expense-policies/{id}/employees',
            tags: ['Expense-Policy'],
            summary: 'List policy employees',
            request: {
                params: z.object({ id: objectId }),
                query: z.object({
                    organization_id: objectId.optional(),
                    search: z.string().optional(),
                    page: z.coerce.number().int().min(1).optional(),
                    limit: z.coerce.number().int().min(1).max(100).optional(),
                }),
            },
            responses: { 200: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'ListPolicyEmployees', {
                    expense_policy_id: c.req.param('id'),
                    organization_id: q.organization_id ?? '',
                    search: q.search ?? '',
                    page: q.page ?? 1,
                    limit: q.limit ?? 10,
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // POST /expense-policies/{id}/employees
    openapi(
        {
            method: 'post',
            path: '/expense-policies/{id}/employees',
            tags: ['Expense-Policy'],
            summary: 'Assign employees to policy',
            request: {
                params: z.object({ id: objectId }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: objectId.optional(),
                                employee_ids: z.array(z.string()).min(1),
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
                const res = await grpcCall(expensePolicyClient, 'AssignPolicyEmployees', {
                    expense_policy_id: c.req.param('id'),
                    organization_id: body.organization_id ?? '',
                    employee_ids: body.employee_ids || [],
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );

    // DELETE /expense-policies/{id}/employees/{employeeId}
    openapi(
        {
            method: 'delete',
            path: '/expense-policies/{id}/employees/{employeeId}',
            tags: ['Expense-Policy'],
            summary: 'Remove employee from policy',
            request: {
                params: z.object({ id: objectId, employeeId: objectId }),
                query: z.object({ organization_id: objectId.optional() }),
            },
            responses: { 200: {}, 404: {} },
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(expensePolicyClient, 'RemovePolicyEmployee', {
                    expense_policy_id: c.req.param('id'),
                    employee_id: c.req.param('employeeId'),
                    organization_id: q.organization_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        }
    );
}
