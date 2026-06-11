# subscription-service/utils/usage.js

## Purpose
Usage aggregation utility that queries `OrganizationUsageEvent` records to produce summary statistics for billing and monitoring.

## Exported Function

**`getOrgUsageSummary({ organizationId, periodStart, periodEnd })`** — Returns total usage count, total events, and a per-module breakdown.

### Logic

Aggregates successful usage events within a date range, both for totals and grouped by module:

```js
export async function getOrgUsageSummary({ organizationId, periodStart, periodEnd }) {
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

    return {
        totalUsageCount: totalAgg._sum.usageCount ?? 0,
        totalEvents: totalAgg._count._all ?? 0,
        modules: byModule.map((m) => ({
            module: m.module,
            usageCount: m._sum.usageCount ?? 0,
            events: m._count._all ?? 0,
        })),
    };
}
```
