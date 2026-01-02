import { prisma } from "@jury-hrms/db/client.js";

export async function runDailyAggregation() {
    // look back 2 days (safe overlap window)
    const lastDaily = await prisma.trafficDailyStat.findFirst({
        orderBy: { date: 'desc' }
    });

    const since = lastDaily
        ? new Date(lastDaily.date)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await prisma.$runCommandRaw({
        aggregate: "TrafficEvent",
        pipeline: [
            /* -----------------------------------------
               SAFE MATCH (Date OR String timestamp)
            ----------------------------------------- */
            {
                $match: {
                    $expr: {
                        $gte: [{ $toDate: "$timestamp" }, since]
                    }
                }
            },

            /* -----------------------------------------
               GROUP BY DAY
            ----------------------------------------- */
            {
                $group: {
                    _id: {
                        date: {
                            $dateTrunc: {
                                date: { $toDate: "$timestamp" },
                                unit: "day"
                            }
                        },
                        organizationId: "$organizationId",
                        service: "$service",
                        module: "$module"
                    },

                    requestCount: { $sum: 1 },

                    successCount: {
                        $sum: {
                            $cond: [{ $lt: ["$statusCode", 400] }, 1, 0]
                        }
                    },

                    errorCount: {
                        $sum: {
                            $cond: [{ $gte: ["$statusCode", 400] }, 1, 0]
                        }
                    },

                    // Collect all latencies for percentile calculation
                    latencies: { $push: "$responseTimeMs" },
                    avgLatencyMs: { $avg: "$responseTimeMs" },

                    activeUsers: {
                        $addToSet: {
                            $ifNull: ["$userId", "$ip"]
                        }
                    }
                }
            },

            /* -----------------------------------------
               FINAL SHAPE with percentiles
            ----------------------------------------- */
            {
                $project: {
                    _id: 0,
                    // Safe ISO string conversion
                    date: {
                        $dateToString: {
                            date: "$_id.date",
                            format: "%Y-%m-%dT00:00:00.000Z"
                        }
                    },
                    organizationId: "$_id.organizationId",
                    service: "$_id.service",
                    module: "$_id.module",

                    requestCount: 1,
                    successCount: 1,
                    errorCount: 1,
                    avgLatencyMs: 1,

                    // Calculate percentiles
                    p95LatencyMs: {
                        $percentile: {
                            input: "$latencies",
                            p: [0.95],
                            method: "approximate"
                        }
                    },
                    p99LatencyMs: {
                        $percentile: {
                            input: "$latencies",
                            p: [0.99],
                            method: "approximate"
                        }
                    },

                    activeUsers: { $size: "$activeUsers" }
                }
            }
        ],
        cursor: {}
    });

    const docs = result?.cursor?.firstBatch || [];
    if (!docs.length) {
        console.log('[daily_agg] No data to aggregate');
        return;
    }

    /* -----------------------------------------
       DELETE + INSERT with validation
    ----------------------------------------- */
    const dates = [
        ...new Set(
            docs
                .map(d => {
                    const date = new Date(d.date);
                    return isNaN(date.getTime()) ? null : date;
                })
                .filter(Boolean)
        )
    ];

    if (!dates.length) {
        console.error('[daily_agg] No valid dates found in aggregation results');
        return;
    }

    await prisma.trafficDailyStat.deleteMany({
        where: { date: { in: dates } }
    });

    await prisma.trafficDailyStat.createMany({
        data: docs
            .map(d => {
                const dateObj = new Date(d.date);
                if (isNaN(dateObj.getTime())) return null;

                return {
                    date: dateObj,
                    organizationId: d.organizationId || null,
                    service: d.service,
                    module: d.module || null,

                    requestCount: Number(d.requestCount || 0),
                    successCount: Number(d.successCount || 0),
                    errorCount: Number(d.errorCount || 0),

                    avgLatencyMs: Number(d.avgLatencyMs || 0),
                    // $percentile returns array, grab first element
                    p95LatencyMs: Number(d.p95LatencyMs?.[0] || 0),
                    p99LatencyMs: Number(d.p99LatencyMs?.[0] || 0),

                    activeUsers: Number(d.activeUsers || 0),
                    createdAt: new Date()
                };
            })
            .filter(Boolean)
    });

    console.log(`[daily_agg] Processed ${docs.length} stat(s) for ${dates.length} date(s)`);
}