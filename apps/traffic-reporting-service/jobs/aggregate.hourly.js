import { prisma } from "@jury-hrms/db/client.js";

export async function runHourlyAggregation() {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const result = await prisma.$runCommandRaw({
        aggregate: "TrafficEvent",
        pipeline: [
            {
                $match: {
                    $expr: {
                        $gte: [{ $toDate: "$timestamp" }, since]
                    }
                }
            },
            {
                $group: {
                    _id: {
                        hour: {
                            $dateTrunc: {
                                date: { $toDate: "$timestamp" },
                                unit: "hour"
                            }
                        },
                        organizationId: "$organizationId",
                        service: "$service",
                        module: "$module"
                    },

                    requestCount: { $sum: 1 },
                    successCount: {
                        $sum: { $cond: [{ $lt: ["$statusCode", 400] }, 1, 0] }
                    },
                    errorCount: {
                        $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] }
                    },

                    // Collect all latencies for percentile calculation
                    latencies: { $push: "$responseTimeMs" },
                    avgLatencyMs: { $avg: "$responseTimeMs" },

                    uniqueUsers: {
                        $addToSet: { $ifNull: ["$userId", "$ip"] }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    // Safe ISO string conversion
                    hour: {
                        $dateToString: {
                            date: "$_id.hour",
                            format: "%Y-%m-%dT%H:00:00.000Z"
                        }
                    },
                    organizationId: "$_id.organizationId",
                    service: "$_id.service",
                    module: "$_id.module",

                    requestCount: 1,
                    successCount: 1,
                    errorCount: 1,
                    avgLatencyMs: 1,

                    // Calculate percentiles using $percentile (MongoDB 5.0+)
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

                    uniqueUsers: { $size: "$uniqueUsers" }
                }
            }
        ],
        cursor: {}
    });

    const docs = result?.cursor?.firstBatch || [];
    if (!docs.length) {
        console.log('[hourly_agg] No data to aggregate');
        return;
    }

    // Safe date parsing with validation
    const hours = [
        ...new Set(
            docs
                .map(d => {
                    const date = new Date(d.hour);
                    return isNaN(date.getTime()) ? null : date;
                })
                .filter(Boolean)
        )
    ];

    if (!hours.length) {
        console.error('[hourly_agg] No valid dates found in aggregation results');
        return;
    }

    await prisma.trafficHourlyStat.deleteMany({
        where: { hour: { in: hours } }
    });

    await prisma.trafficHourlyStat.createMany({
        data: docs
            .map(d => {
                const hourDate = new Date(d.hour);
                if (isNaN(hourDate.getTime())) return null;

                return {
                    hour: hourDate,
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

                    uniqueUsers: Number(d.uniqueUsers || 0),
                    createdAt: new Date()
                };
            })
            .filter(Boolean)
    });

    console.log(`[hourly_agg] Processed ${docs.length} stat(s) for ${hours.length} hour(s)`);
}