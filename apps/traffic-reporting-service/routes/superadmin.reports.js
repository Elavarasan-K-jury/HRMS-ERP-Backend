import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@jury-hrms/db/client.js";

export const superAdminReports = new OpenAPIHono();

/* ===========================================================
   COMMON SCHEMAS
=========================================================== */

const MetaSchema = z.object({
    generatedAt: z.string()
});

const ServiceStatSchema = z.object({
    service: z.string(),
    requests: z.number(),
    errors: z.number(),
    avgLatencyMs: z.number()
});

const RouteStatSchema = z.object({
    route: z.string(),
    method: z.string(),
    requests: z.number(),
    errors: z.number()
});

const ErrorStatSchema = z.object({
    statusClass: z.string(),
    count: z.number()
});

const AlertSchema = z.object({
    id: z.string(),
    type: z.string(),
    message: z.string(),
    triggeredAt: z.string()
});

/* ===========================================================
   1️⃣ PLATFORM OVERVIEW (FIXED)
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/overview",
        summary: "Platform traffic overview",
        tags: ["Traffic Reports"],
        request: {
            query: z.object({
                days: z.coerce.number().min(1).max(90).default(1)
            })
        },
        responses: {
            200: {
                description: "Traffic overview",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: z.object({
                                generatedAt: z.string(),
                                rangeDays: z.number(),
                                granularity: z.enum(["hourly", "daily"])
                            }),
                            data: z.object({
                                totals: z.object({
                                    requests: z.number(),
                                    errors: z.number(),
                                    errorRate: z.number()
                                }),
                                trend: z.array(z.object({
                                    date: z.string(),
                                    requests: z.number(),
                                    errors: z.number(),
                                    avgLatencyMs: z.number(),
                                    p95LatencyMs: z.number(),
                                    p99LatencyMs: z.number()
                                }))
                            })
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const { days } = c.req.valid("query");

        const granularity = days === 1 ? "hourly" : "daily";

        const since = new Date(Date.now() - days * 86400000);

        // ✅ CRITICAL FIX: normalize daily dates
        if (granularity === "daily") {
            since.setHours(0, 0, 0, 0);
        }

        const model =
            granularity === "hourly"
                ? prisma.trafficHourlyStat
                : prisma.trafficDailyStat;

        const rows = await model.findMany({
            where:
                granularity === "daily"
                    ? { date: { gte: since } }
                    : { hour: { gte: since } },
            orderBy:
                granularity === "daily"
                    ? { date: "asc" }
                    : { hour: "asc" }
        });

        let totalRequests = 0;
        let totalErrors = 0;

        const trend = rows.map((r) => {
            totalRequests += r.requestCount;
            totalErrors += r.errorCount;

            return {
                date: (r.date ?? r.hour).toISOString(),
                requests: r.requestCount,
                errors: r.errorCount,
                avgLatencyMs: Math.round(r.avgLatencyMs ?? 0),
                p95LatencyMs: Math.round(r.p95LatencyMs ?? 0),
                p99LatencyMs: Math.round(r.p99LatencyMs ?? 0)
            };
        });

        return c.json({
            meta: {
                generatedAt: new Date().toISOString(),
                rangeDays: days,
                granularity
            },
            data: {
                totals: {
                    requests: totalRequests,
                    errors: totalErrors,
                    errorRate:
                        totalRequests > 0
                            ? Number(((totalErrors / totalRequests) * 100).toFixed(2))
                            : 0
                },
                trend
            }
        });
    }
);

/* ===========================================================
   2️⃣ SERVICE HEALTH (FIXED FOR DAILY)
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/services",
        summary: "Service health summary",
        tags: ["Traffic Reports"],
        request: {
            query: z.object({
                days: z.coerce.number().min(1).max(90).default(1)
            })
        },
        responses: {
            200: {
                description: "Service health metrics",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: MetaSchema,
                            data: z.array(
                                z.object({
                                    service: z.string(),
                                    requests: z.number(),
                                    errors: z.number(),
                                    errorRate: z.number(),
                                    avgLatencyMs: z.number(),
                                    p95LatencyMs: z.number(),
                                    status: z.enum(["HEALTHY", "DEGRADED", "UNHEALTHY"]),
                                    score: z.number(),
                                    reason: z.string()
                                })
                            )
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const { days } = c.req.valid("query");

        /* ----------------------------------
           TIME WINDOW (SAFE)
        ---------------------------------- */
        const since = new Date();
        since.setHours(since.getHours() - days * 24);
        since.setMinutes(0, 0, 0);

        console.log("[traffic-report] since:", since.toISOString());

        /* ----------------------------------
           FETCH DATA (NO SERVICE FILTER)
        ---------------------------------- */
        const rows = await prisma.trafficHourlyStat.findMany({
            where: {
                hour: { gte: since }
            },
            select: {
                service: true,
                requestCount: true,
                errorCount: true,
                avgLatencyMs: true,
                p95LatencyMs: true
            }
        });

        /* ----------------------------------
           MANUAL GROUPING (SAFE & FAST)
        ---------------------------------- */
        const map = new Map();

        for (const r of rows) {
            if (!r.service) continue; // ✅ filter null/empty here

            if (!map.has(r.service)) {
                map.set(r.service, {
                    service: r.service,
                    requests: 0,
                    errors: 0,
                    avgLatencySum: 0,
                    latencyCount: 0,
                    p95LatencyMs: 0
                });
            }

            const acc = map.get(r.service);
            acc.requests += r.requestCount ?? 0;
            acc.errors += r.errorCount ?? 0;
            acc.avgLatencySum += r.avgLatencyMs ?? 0;
            acc.latencyCount += 1;
            acc.p95LatencyMs = Math.max(
                acc.p95LatencyMs,
                r.p95LatencyMs ?? 0
            );
        }

        /* ----------------------------------
           MAP → HEALTH
        ---------------------------------- */
        const data = Array.from(map.values()).map((r) => {
            const errorRate =
                r.requests > 0 ? (r.errors / r.requests) * 100 : 0;

            const avgLatency =
                r.latencyCount > 0
                    ? Math.round(r.avgLatencySum / r.latencyCount)
                    : 0;

            let status = "HEALTHY";
            let score = 100;
            let reason = "Operating normally";

            if (errorRate > 5 || r.p95LatencyMs > 2000) {
                status = "UNHEALTHY";
                score = 40;
                reason =
                    errorRate > 5
                        ? `High error rate (${errorRate.toFixed(2)}%)`
                        : `High tail latency (${r.p95LatencyMs}ms)`;
            } else if (errorRate > 1 || r.p95LatencyMs > 1000) {
                status = "DEGRADED";
                score = 70;
                reason =
                    errorRate > 1
                        ? `Elevated error rate (${errorRate.toFixed(2)}%)`
                        : `Elevated latency (${r.p95LatencyMs}ms)`;
            }

            return {
                service: r.service,
                requests: r.requests,
                errors: r.errors,
                errorRate: Number(errorRate.toFixed(2)),
                avgLatencyMs: avgLatency,
                p95LatencyMs: r.p95LatencyMs,
                status,
                score,
                reason
            };
        });

        return c.json({
            meta: {
                generatedAt: new Date().toISOString(),
                since: since.toISOString(),
                source: "prisma.findMany + in-memory group"
            },
            data: data.sort((a, b) => a.score - b.score)
        });
    }
);



/* ===========================================================
   3️⃣ TOP ROUTES
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/routes",
        summary: "Top routes by traffic",
        tags: ["Traffic Reports"],
        responses: {
            200: {
                description: "Route usage",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: MetaSchema,
                            data: z.array(RouteStatSchema)
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const result = await prisma.$runCommandRaw({
            aggregate: "TrafficEvent",
            pipeline: [
                {
                    $group: {
                        _id: {
                            route: { $ifNull: ["$routeKey", "$endpoint"] },
                            method: "$method"
                        },
                        requests: { $sum: 1 },
                        errors: {
                            $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] }
                        }
                    }
                },
                { $sort: { requests: -1 } },
                { $limit: 20 }
            ],
            cursor: {}
        });

        const rows = result?.cursor?.firstBatch || [];

        return c.json({
            meta: { generatedAt: new Date().toISOString() },
            data: rows.map((r) => ({
                route: r._id.route,
                method: r._id.method,
                requests: r.requests,
                errors: r.errors
            }))
        });
    }
);

/* ===========================================================
   4️⃣ ERROR BREAKDOWN
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/errors",
        summary: "Error breakdown",
        tags: ["Traffic Reports"],
        responses: {
            200: {
                description: "Errors by class",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: MetaSchema,
                            data: z.array(ErrorStatSchema)
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const result = await prisma.$runCommandRaw({
            aggregate: "TrafficEvent",
            pipeline: [
                { $group: { _id: "$statusClass", count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ],
            cursor: {}
        });

        const rows = result?.cursor?.firstBatch || [];

        return c.json({
            meta: { generatedAt: new Date().toISOString() },
            data: rows.map((r) => ({
                statusClass: r._id,
                count: r.count
            }))
        });
    }
);

/* ===========================================================
   5️⃣ LATENCY SUMMARY (UNCHANGED – WORKS WITH SWAGGER)
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/latency",
        summary: "Latency summary",
        tags: ["Traffic Reports"],
        responses: {
            200: {
                description: "Latency metrics",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: MetaSchema,
                            data: z.object({
                                avgLatencyMs: z.number(),
                                minLatencyMs: z.number(),
                                maxLatencyMs: z.number(),
                                p95LatencyMs: z.number(),
                                p99LatencyMs: z.number()
                            })
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const result = await prisma.$runCommandRaw({
            aggregate: "TrafficEvent",
            pipeline: [
                {
                    $group: {
                        _id: null,
                        avg: { $avg: "$responseTimeMs" },
                        min: { $min: "$responseTimeMs" },
                        max: { $max: "$responseTimeMs" },
                        p95: {
                            $percentile: {
                                input: "$responseTimeMs",
                                p: [0.95],
                                method: "approximate"
                            }
                        },
                        p99: {
                            $percentile: {
                                input: "$responseTimeMs",
                                p: [0.99],
                                method: "approximate"
                            }
                        }
                    }
                }
            ],
            cursor: {}
        });

        const r = result?.cursor?.firstBatch?.[0] || {};

        return c.json({
            meta: { generatedAt: new Date().toISOString() },
            data: {
                avgLatencyMs: Math.round(r.avg ?? 0),
                minLatencyMs: r.min ?? 0,
                maxLatencyMs: r.max ?? 0,
                p95LatencyMs: Math.round(r.p95?.[0] ?? 0),
                p99LatencyMs: Math.round(r.p99?.[0] ?? 0)
            }
        });
    }
);

/* ===========================================================
   6️⃣ RECENT ALERTS
=========================================================== */
superAdminReports.openapi(
    createRoute({
        method: "get",
        path: "/superadmin/traffic/alerts",
        summary: "Recent traffic alerts",
        tags: ["Traffic Reports"],
        responses: {
            200: {
                description: "Alerts",
                content: {
                    "application/json": {
                        schema: z.object({
                            meta: MetaSchema,
                            data: z.array(AlertSchema)
                        })
                    }
                }
            }
        }
    }),
    async (c) => {
        const alerts = await prisma.trafficAlert.findMany({
            orderBy: { triggeredAt: "desc" },
            take: 20
        });

        return c.json({
            meta: { generatedAt: new Date().toISOString() },
            data: alerts.map((a) => ({
                id: a.id,
                type: a.type,
                message: a.message,
                triggeredAt: a.triggeredAt.toISOString()
            }))
        });
    }
);
