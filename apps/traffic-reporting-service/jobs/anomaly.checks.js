import { prisma } from "@jury-hrms/db/client.js";

export async function runAnomalyChecks() {
    const now = new Date();

    const rules = await prisma.trafficAlertRule.findMany({
        where: { isActive: true }
    });

    for (const rule of rules) {
        /* ----------------------------------------
           COOLDOWN CHECK
        ---------------------------------------- */
        if (
            rule.lastTriggeredAt &&
            now - rule.lastTriggeredAt <
            rule.cooldownMinutes * 60 * 1000
        ) {
            continue;
        }

        const since = new Date(
            now.getTime() - rule.windowMinutes * 60 * 1000
        );

        /* ----------------------------------------
           FETCH AGGREGATED WINDOW DATA
        ---------------------------------------- */
        const stats = await prisma.trafficHourlyStat.aggregate({
            where: {
                hour: { gte: since },
                ...(rule.organizationId && {
                    organizationId: rule.organizationId
                }),
                ...(rule.service && { service: rule.service }),
                ...(rule.module && { module: rule.module })
            },
            _sum: {
                requestCount: true,
                errorCount: true
            },
            _max: {
                p95LatencyMs: true
            },
            _avg: {
                avgLatencyMs: true
            }
        });

        const totalReq = stats._sum.requestCount || 0;
        const totalErr = stats._sum.errorCount || 0;
        const maxP95 = stats._max.p95LatencyMs || 0;
        const avgLatency = stats._avg.avgLatencyMs || 0;

        /* ----------------------------------------
           MINIMUM SAMPLE GUARD
        ---------------------------------------- */
        const MIN_REQUESTS = rule.minRequests ?? 50;
        if (totalReq < MIN_REQUESTS) continue;

        /* ----------------------------------------
           RULE EVALUATION
        ---------------------------------------- */
        let triggered = false;
        let value = 0;
        let message = "";

        switch (rule.type) {
            case "ERROR_RATE": {
                value = (totalErr / totalReq) * 100;
                triggered = value > rule.threshold;
                message = `Error rate ${value.toFixed(
                    2
                )}% exceeded threshold ${rule.threshold}%`;
                break;
            }

            case "LATENCY_P95": {
                value = maxP95;
                triggered = value > rule.threshold;
                message = `P95 latency ${value}ms exceeded threshold ${rule.threshold}ms`;
                break;
            }

            case "LATENCY_AVG": {
                value = avgLatency;
                triggered = value > rule.threshold;
                message = `Average latency ${value.toFixed(
                    2
                )}ms exceeded threshold ${rule.threshold}ms`;
                break;
            }

            case "REQUEST_SPIKE": {
                value = totalReq;
                triggered = value > rule.threshold;
                message = `Request volume ${value} exceeded threshold ${rule.threshold}`;
                break;
            }

            default:
                continue;
        }

        if (!triggered) continue;

        console.log(message);

        /* ----------------------------------------
           PERSIST ALERT (ATOMIC)
        ---------------------------------------- */
        await prisma.$transaction([
            prisma.trafficAlert.create({
                data: {
                    ruleId: rule.id,
                    organizationId: rule.organizationId,
                    service: rule.service,
                    module: rule.module,
                    type: rule.type,
                    value: Number(value.toFixed(2)),
                    threshold: rule.threshold,
                    windowMinutes: rule.windowMinutes,
                    message
                }
            }),

            prisma.trafficAlertRule.update({
                where: { id: rule.id },
                data: { lastTriggeredAt: now }
            })
        ]);
    }
}
