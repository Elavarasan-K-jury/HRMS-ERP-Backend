import { prisma } from "@jury-hrms/db/client.js";

/**
 * Usage aggregation based on OrganizationUsageEvent
 * We treat usageCount as "requests" by default (usageUnit optional).
 */
export async function getOrgUsageSummary({ organizationId, periodStart, periodEnd }) {
    // Total usageCount for the period
    const totalAgg = await prisma.organizationUsageEvent.aggregate({
        where: {
            organizationId,
            occurredAt: { gte: periodStart, lt: periodEnd },
            deletedAt: null,
            success: true,
        },
        _sum: { usageCount: true },
        _count: { _all: true },
    });

    // Per-module breakdown
    const byModule = await prisma.organizationUsageEvent.groupBy({
        by: ["module"],
        where: {
            organizationId,
            occurredAt: { gte: periodStart, lt: periodEnd },
            deletedAt: null,
            success: true,
        },
        _sum: { usageCount: true },
        _count: { _all: true },
    });

    const totalUsageCount = totalAgg._sum.usageCount ?? 0;

    return {
        totalUsageCount,
        totalEvents: totalAgg._count._all ?? 0,
        modules: byModule.map((m) => ({
            module: m.module,
            usageCount: m._sum.usageCount ?? 0,
            events: m._count._all ?? 0,
        })),
    };
}
