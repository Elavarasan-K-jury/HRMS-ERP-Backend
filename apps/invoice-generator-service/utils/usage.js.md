# utils/usage.js

**Purpose:** Aggregates organization usage events (`OrganizationUsageEvent`) for a given billing period, returning total usage count, event count, and a per-module breakdown.

## Key Exports

```js
export async function getOrgUsageSummary({ organizationId, periodStart, periodEnd })
```

Returns `{ totalUsageCount, totalEvents, modules: [{ module, usageCount, events }] }`.

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### Total aggregation (lines 9–18)
```js
const totalAgg = await prisma.organizationUsageEvent.aggregate({
    where: { organizationId, occurredAt: { gte: periodStart, lt: periodEnd }, deletedAt: null, success: true },
    _sum: { usageCount: true },
    _count: { _all: true },
});
```
Sums `usageCount` across all successful (non-deleted) usage events in the period.

### Per-module breakdown (lines 21–31)
```js
const byModule = await prisma.organizationUsageEvent.groupBy({
    by: ["module"],
    where: { organizationId, occurredAt: { gte: periodStart, lt: periodEnd }, deletedAt: null, success: true },
    _sum: { usageCount: true },
    _count: { _all: true },
});
```
Groups the same events by `module` to provide breakdown details.

### Return shape (lines 35–43)
Returns both the total and per-module data, defaulting to 0 when no events exist.
