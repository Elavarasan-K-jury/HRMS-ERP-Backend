import { z } from 'zod';
import { serviceMetrics } from '../middlewares/service_metrics.js';

export default function registerServiceMetricsRoutes({ openapi }) {
    const MetricsSchema = z.array(
        z.object({
            service: z.string(),
            totalRequests: z.number(),
            successCount: z.number(),
            errorCount: z.number(),
            lastErrorMessage: z.string().nullable(),
            lastErrorAt: z.string().nullable(),
            lastLatencyMs: z.number().nullable(),
            avgLatencyMs: z.number().nullable(),
            inFlight: z.number(),
            errorRate: z.number(),
            status: z.string(),
        })
    );

    openapi(
        {
            method: 'get',
            path: '/service-metrics',
            tags: ['System'],
            summary: 'Get per-microservice runtime metrics',
            responses: {
                200: {
                    description: 'Metrics list',
                    content: {
                        'application/json': { schema: MetricsSchema },
                    },
                },
            },
        },
        async (c) => {
            const array = Object.entries(serviceMetrics).map(([service, m]) => {
                const total = m.totalRequests || 1;
                const errorRate = Number(((m.errorCount / total) * 100).toFixed(1));

                const status =
                    m.errorCount === 0
                        ? 'UP'
                        : errorRate > 50
                            ? 'UNSTABLE'
                            : 'DEGRADED';

                return {
                    service,
                    ...m,
                    errorRate,
                    status,
                    lastErrorAt: m.lastErrorAt ?? null,
                };
            });

            return c.json(array, 200);
        }
    );
}
