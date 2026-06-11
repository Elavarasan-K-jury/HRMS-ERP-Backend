# jobs/aggregate.hourly.js

**Purpose:** Aggregates raw `TrafficEvent` records into hourly stats (`trafficHourlyStat`) using a MongoDB aggregation pipeline with percentile calculations.

## Key Exports

```js
export async function runHourlyAggregation()
```

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### MongoDB aggregation pipeline (lines 6–87)
Uses `prisma.$runCommandRaw` to run a native MongoDB aggregation:

- **`$match`** — Filters events from the last 2 hours (overlap window)
- **`$group`** — Groups by `hour`, `organizationId`, `service`, `module`; computes `requestCount`, `successCount`, `errorCount`, `avgLatencyMs`, pushes all latencies into an array, and collects unique users
- **`$project`** — Calculates `p95LatencyMs` and `p99LatencyMs` via `$percentile` (MongoDB 5.0+), formats `hour` as ISO string, and counts unique users

### Delete-then-insert pattern (lines 112–142)
```js
await prisma.trafficHourlyStat.deleteMany({ where: { hour: { in: hours } } });
await prisma.trafficHourlyStat.createMany({ data: docs.map(/* validate & reshape */).filter(Boolean) });
```
Deletes existing hourly stats for the same hours (idempotent), then bulk-inserts the freshly aggregated data. Includes date validation to skip malformed records.
