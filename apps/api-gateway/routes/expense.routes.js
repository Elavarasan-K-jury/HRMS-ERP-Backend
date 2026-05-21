import { z, ZodError } from 'zod';
import { expenseClient } from '../grpc/expense.client.js';

export default function registerExpenseRoutes({ openapi }) {
    /* ----------------------------------------------------
     🧩 Shared schemas
    ---------------------------------------------------- */
    const expenseTypeSchema = z.enum([
        'ALL',
        'TRAVEL',
        'FOOD',
        'ACCOMMODATION',
        'OTHER',
    ]);

    const expenseStatusSchema = z.enum([
        'ALL',
        'PENDING',
        'APPROVED',
        'REJECTED',
    ]);

    const expenseSchema = z.object({
        id: z.string(),
        organization_id: z.string(),
        employee_id: z.string(),

        employee_name: z.string().optional(),
        employee_code: z.string().optional(),

        type: expenseTypeSchema,
        amount: z.number(),
        description: z.string(),
        receipt_url: z.string().optional(),

        status: expenseStatusSchema,

        approver_id: z.string().optional(),
        approver_name: z.string().optional(),
        approved_at: z.string().optional(),

        created_at: z.string().optional(),
        updated_at: z.string().optional(),
        deleted_at: z.string().optional(),
    });

    const expenseListResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
        expenses: z.array(expenseSchema),
        total_count: z.number(),
        page: z.number(),
        limit: z.number(),
    });

    const expenseSingleResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
        expense: expenseSchema,
    });

    const defaultResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
    });

    const registerExpenseSchema = z.object({
        employee_id: z.string(),
        type: expenseTypeSchema.optional().default('OTHER'),
        amount: z.number(),
        description: z.string(),
        receipt_url: z.string().optional().default(''),
    });

    const updateExpenseSchema = z.object({
        employee_id: z.string(),
        type: expenseTypeSchema.optional(),
        amount: z.number().optional(),
        description: z.string().optional(),
        receipt_url: z.string().optional(),
    });

    const employeeExpenseQuerySchema = z.object({
        employee_id: z.string(),
        from_date: z.string().optional().default(''),
        to_date: z.string().optional().default(''),
        search: z.string().optional().default(''),
        type: expenseTypeSchema.optional(),
        status: expenseStatusSchema.optional(),
        page: z.coerce.number().optional().default(1),
        limit: z.coerce.number().optional().default(10),
    });

    const adminExpenseQuerySchema = z.object({
        from_date: z.string().optional().default(''),
        to_date: z.string().optional().default(''),
        employee_id: z.string().optional().default(''),
        type: expenseTypeSchema.optional(),
        status: expenseStatusSchema.optional(),
        search: z.string().optional().default(''),
        page: z.coerce.number().optional().default(1),
        limit: z.coerce.number().optional().default(10),
    });

    const updateStatusSchema = z.object({
        approver_id: z.string(),
        status: z.enum(['APPROVED', 'REJECTED']),
    });

    const organizationParamSchema = z.object({
        organization_id: z.string(),
    });

    const expenseParamSchema = z.object({
        organization_id: z.string(),
        expense_id: z.string(),
    });

    /* ----------------------------------------------------
     👤 Employee — Register Expense
    ---------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/organisation/{organization_id}/expense',
            tags: ['Expense'],
            summary: 'Employee register expense',
            request: {
                params: organizationParamSchema,
                body: {
                    content: {
                        'application/json': {
                            schema: registerExpenseSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Expense registered successfully',
                    content: {
                        'application/json': {
                            schema: expenseSingleResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const body = await c.req.json();
                const parsed = registerExpenseSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    expenseClient.RegisterExpense(
                        {
                            organization_id: params.organization_id,
                            ...parsed,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     👤 Employee — Fetch My Expenses
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/organisation/{organization_id}/expense',
            tags: ['Expense'],
            summary: 'Employee fetch own expenses with filters',
            request: {
                params: organizationParamSchema,
                query: employeeExpenseQuerySchema,
            },
            responses: {
                200: {
                    description: 'Expenses fetched successfully',
                    content: {
                        'application/json': {
                            schema: expenseListResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    expenseClient.GetMyExpenses(
                        {
                            organization_id: params.organization_id,
                            ...query,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🛠 Admin — Fetch All Expenses
     Keep this before /expense/{expense_id}
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/organisation/{organization_id}/expense/admin',
            tags: ['Expense Admin'],
            summary: 'Admin fetch all expenses with filters',
            request: {
                params: organizationParamSchema,
                query: adminExpenseQuerySchema,
            },
            responses: {
                200: {
                    description: 'Expenses fetched successfully',
                    content: {
                        'application/json': {
                            schema: expenseListResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    expenseClient.GetAllExpenses(
                        {
                            organization_id: params.organization_id,
                            ...query,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🛠 Admin — Approve / Reject Expense
    ---------------------------------------------------- */
    openapi(
        {
            method: 'patch',
            path: '/organisation/{organization_id}/expense/{expense_id}/status',
            tags: ['Expense Admin'],
            summary: 'Admin approve or reject expense',
            request: {
                params: expenseParamSchema,
                body: {
                    content: {
                        'application/json': {
                            schema: updateStatusSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Expense status updated successfully',
                    content: {
                        'application/json': {
                            schema: expenseSingleResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const body = await c.req.json();
                const parsed = updateStatusSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    expenseClient.UpdateExpenseStatus(
                        {
                            organization_id: params.organization_id,
                            expense_id: params.expense_id,
                            ...parsed,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🛠 Admin — View Expense Details
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/organisation/{organization_id}/expense/{expense_id}',
            tags: ['Expense Admin'],
            summary: 'Admin view expense details',
            request: {
                params: expenseParamSchema,
            },
            responses: {
                200: {
                    description: 'Expense details fetched successfully',
                    content: {
                        'application/json': {
                            schema: expenseSingleResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    expenseClient.GetExpenseDetails(
                        {
                            organization_id: params.organization_id,
                            expense_id: params.expense_id,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     👤 Employee — Update Expense
    ---------------------------------------------------- */
    openapi(
        {
            method: 'put',
            path: '/organisation/{organization_id}/expense/{expense_id}',
            tags: ['Expense'],
            summary: 'Employee update expense',
            request: {
                params: expenseParamSchema,
                body: {
                    content: {
                        'application/json': {
                            schema: updateExpenseSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Expense updated successfully',
                    content: {
                        'application/json': {
                            schema: expenseSingleResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const body = await c.req.json();
                const parsed = updateExpenseSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    expenseClient.UpdateExpense(
                        {
                            organization_id: params.organization_id,
                            expense_id: params.expense_id,
                            ...parsed,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     👤 Employee — Delete Expense
    ---------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/organisation/{organization_id}/expense/{expense_id}',
            tags: ['Expense'],
            summary: 'Employee delete expense',
            request: {
                params: expenseParamSchema,
                query: z.object({
                    employee_id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'Expense deleted successfully',
                    content: {
                        'application/json': {
                            schema: defaultResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    expenseClient.DeleteExpense(
                        {
                            organization_id: params.organization_id,
                            expense_id: params.expense_id,
                            employee_id: query.employee_id,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🛠 Admin — Delete Expense
    ---------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/organisation/{organization_id}/expense/admin/{expense_id}',
            tags: ['Expense Admin'],
            summary: 'Admin delete expense',
            request: {
                params: expenseParamSchema,
            },
            responses: {
                200: {
                    description: 'Expense deleted successfully',
                    content: {
                        'application/json': {
                            schema: defaultResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const params = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    expenseClient.AdminDeleteExpense(
                        {
                            organization_id: params.organization_id,
                            expense_id: params.expense_id,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return handleRouteError(c, error);
            }
        }
    );
}

/* ----------------------------------------------------
 🔥 Common Error Handler
---------------------------------------------------- */
function handleRouteError(c, error) {
    if (error instanceof ZodError) {
        return c.json(
            {
                error: 'Validation failed',
                details: error.errors.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            },
            400
        );
    }

    return c.json(
        {
            error: error.message,
        },
        error.code === 5 ? 404 : 500
    );
}