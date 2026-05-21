import { z, ZodError } from 'zod';
import { payrollClient } from '../grpc/payroll.client.js';

export default function registerPayrollRoutes({ openapi }) {
    /* ----------------------------------------------------
     🟡 Get System Calculated Payroll
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/system-payroll',
            tags: ['Payroll'],
            summary: 'Get data calculated by system',
            request: {
                query: z.object({
                    year: z.string().openapi({ example: '2026' }),
                    month: z.string().openapi({ example: '05' }),
                    organisation_id: z.string().openapi({ example: 'org_123' }),
                }),
            },
            responses: {
                200: {
                    description: 'System payroll data fetched successfully',
                    content: {
                        'application/json': {
                            // Replace this with your actual response schema for better Swagger docs
                            schema: z.object({}).passthrough(),
                        },
                    },
                },
                400: {
                    description: 'Validation failed',
                },
                404: {
                    description: 'Payroll data not found',
                },
                500: {
                    description: 'Internal server error',
                },
            },
        },
        async (c) => {
            try {
                // Use c.req.valid to get the parsed and validated query
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    payrollClient.GetSystemPayroll(
                        {
                            year: query.year,
                            month: query.month,
                            organization_id: query.organisation_id,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                const statusCode = error.code === 5 ? 404 : 500;

                return c.json(
                    {
                        success: false,
                        error: error.message || 'An unexpected error occurred',
                    },
                    statusCode
                );
            }
        }
    );

    /* ----------------------------------------------------
     🟡 Calculate Payroll
    ---------------------------------------------------- */
    const calculatePayrollSchema = z.object({
        organization_id: z.string(),
        year: z.string(),
        month: z.string(),
        employee_id: z.string().optional(),
    });

    openapi(
        {
            method: 'post',
            path: '/calculate-payroll',
            tags: ['Payroll'],
            summary: 'Calculate payroll for employees',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: calculatePayrollSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Payroll calculated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                calculations: z.array(z.object({
                                    employee_id: z.string(),
                                    employee_name: z.string(),
                                    employee_code: z.string(),
                                    attendance: z.object({
                                        total_days: z.number(),
                                        present_days: z.number(),
                                        absent_days: z.number(),
                                        half_day_count: z.number(),
                                        late_count: z.number(),
                                        holiday_count: z.number(),
                                        weekoff_count: z.number(),
                                        total_working_hours: z.number(),
                                        effective_hours: z.number(),
                                        late_arrival_minutes: z.number(),
                                    }),
                                    leave: z.object({
                                        total_leave_days: z.number(),
                                        leaves: z.array(z.object({
                                            leave_type: z.string(),
                                            days: z.number(),
                                            status: z.string(),
                                        })),
                                    }),
                                    expenses: z.object({
                                        total_claimed: z.number(),
                                        total_approved: z.number(),
                                        approved_expenses: z.array(z.object({})),
                                    }),
                                    gross_monthly: z.number(),
                                    total_earnings: z.number(),
                                    total_deductions: z.number(),
                                    total_benefits: z.number(),
                                    expense_reimbursement: z.number(),
                                    net_pay: z.number(),
                                    ctc_monthly: z.number(),
                                    deduction_for_absences: z.number(),
                                    adjustment_for_leaves: z.number(),
                                    salary_components: z.array(z.object({
                                        component_key: z.string(),
                                        component_name: z.string(),
                                        component_type: z.string(),
                                        monthly_amount: z.number(),
                                        annual_amount: z.number(),
                                        formula: z.string(),
                                    })),
                                })),
                            }),
                        },
                    },
                },
                400: { description: 'Validation failed' },
                500: { description: 'Internal server error' },
            },
        },
        async (c) => {
            try {
                const body = calculatePayrollSchema.parse(await c.req.json());

                const response = await new Promise((resolve, reject) => {
                    payrollClient.CalculatePayroll(body, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            success: false,
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
                        success: false,
                        error: error.message || 'Internal server error',
                    },
                    500
                );
            }
        }
    );
}