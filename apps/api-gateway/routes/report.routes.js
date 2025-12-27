import { z } from 'zod';
import { reportClient } from '../grpc/report.client.js'; // your grpc client

export default function registerReportsRoutes({ openapi }) {

    /* ------------------------------------------------------------------ */
    /* 🧩 Schema                                                          */
    /* ------------------------------------------------------------------ */
    const EmployeeReportResponseSchema = z.object({
        employee_id: z.string(),
        template_id: z.string(),
        html: z.string()
    });

    /* ------------------------------------------------------------------ */
    /* 🟣 Employee Insight Report                                         */
    /* ------------------------------------------------------------------ */
    openapi(
        {
            method: 'get',
            path: '/reports/employee/{employeeId}',
            tags: ['Reports'],
            summary: 'Generate employee report from template',
            request: {
                params: z.object({
                    employeeId: z.string()
                }),
            },
            responses: {
                200: {
                    description: 'Rendered employee report HTML',
                    content: {
                        'application/json': {
                            schema: EmployeeReportResponseSchema
                        },
                        'text/html': {
                            schema: z.string()
                        }
                    }
                }
            }
        },
        async (c) => {
            const { employeeId } = c.req.valid('param');

            // -------------------------------
            // Call gRPC
            // -------------------------------
            const result = await new Promise((resolve, reject) => {
                reportClient.GenerateEmployeeInsightTemplateReport(
                    {
                        employee_id: employeeId,
                    },
                    (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    }
                );
            });

            // --------------------------------
            // Decide response type
            // --------------------------------
            const accept = c.req.header('accept') || '';

            if (accept.includes('text/html')) {
                return c.html(result.html, 200);
            }

            return c.json(
                {
                    employee_id: employeeId,
                    html: result.html
                },
                200
            );
        }
    );
}
