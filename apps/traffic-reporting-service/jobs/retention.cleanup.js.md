# jobs/retention.cleanup.js

**Purpose:** Batch-deletes `TrafficEvent` records older than a configurable retention period (default 30 days) to prevent unbounded data growth.

## Key Exports

```js
export async function runRetentionCleanup()
```

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### Configurable retention (line 3)
```js
const RETENTION_DAYS = Number(process.env.TRAFFIC_RETENTION_DAYS || 30);
const BATCH_SIZE = 5000;
```
Default retention is 30 days; deletes are done in batches of 5,000 to avoid long-running transactions.

### Batched delete with event-loop yield (lines 13–33)
```js
while (true) {
    const oldDocs = await prisma.trafficEvent.findMany({
        where: { timestamp: { lt: cutoff } },
        select: { id: true },
        take: BATCH_SIZE
    });
    if (!oldDocs.length) break;
    await prisma.trafficEvent.deleteMany({ where: { id: { in: ids } } });
    await new Promise((r) => setTimeout(r, 50));  // yield to event loop
}
```
First fetches only IDs (uses the indexed `timestamp` column), deletes them, then yields 50ms to avoid starving the event loop.
