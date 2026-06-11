# jobs/aggregate.daily.js

**Purpose:** Aggregates raw `TrafficEvent` records into daily stats (`trafficDailyStat`) using a MongoDB aggregation pipeline with percentile calculations.

## Key Exports

```js
export async function runDailyAggregation()
```

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### Incremental window (lines 5–11)
```js
const lastDaily = await prisma.trafficDailyStat.findFirst({ orderBy: { date: 'desc' } });
const since = lastDaily
    ? new Date(lastDaily.date)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
```
Starts aggregation from the last existing daily stat date (or 90 days back if none exist), providing an overlap window for consistency.

### MongoDB aggregation pipeline (lines 12–112)
- **`$match`** — Filters events from the `since` date using `$expr` + `$toDate` (handles both Date and string timestamps)
- **`$group`** — Groups by day, org, service, module; collects latencies into an array for percentile calculation
- **`$project`** — Uses `$percentile` (MongoDB 5.0+) for p95/p99 latency, formats date as ISO string

### Delete-then-insert pattern (lines 139–169)
```js
await prisma.trafficDailyStat.deleteMany({ where: { date: { in: dates } } });
await prisma.trafficDailyStat.createMany({ data: docs.map(/* validate & reshape */).filter(Boolean) });
```
Idempotent upsert: deletes existing records for the same dates, then bulk-inserts the new aggregation.
