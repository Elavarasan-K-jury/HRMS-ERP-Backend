# jobs/cron.js

**Purpose:** Registers all scheduled cron jobs for the traffic-reporting service — hourly aggregation, daily aggregation, anomaly checks, and retention cleanup — with in-memory run-locks to prevent overlaps.

## Key Exports / Functions

| Function | Description |
|---|---|
| `safeRun(name, fn)` | Wraps a job with an in-memory lock; logs start/duration/failure |

## Dependencies

| Package | Purpose |
|---|---|
| `node-cron` | CRON scheduler |
| `./aggregate.hourly.js` | `runHourlyAggregation` |
| `./aggregate.daily.js` | `runDailyAggregation` |
| `./anomaly.checks.js` | `runAnomalyChecks` |
| `./retention.cleanup.js` | `runRetentionCleanup` |

## Important Logic

### In-memory lock (lines 13–30)
```js
const locks = new Map();

async function safeRun(name, fn) {
    if (locks.get(name)) {
        console.log(`[cron] skip ${name} (already running)`);
        return;
    }
    locks.set(name, true);
    try { await fn(); } finally { locks.set(name, false); }
}
```
Prevents concurrent execution of the same job. If a job is still running when its next tick fires, it is skipped.

### Fast mode vs Production mode (lines 36–102)
When `CRON_FAST_MODE=true` is set, jobs run at aggressive intervals (every 5s–30s) for testing. In production mode:

| Job | Schedule |
|---|---|
| Hourly agg | `*/5 * * * *` (every 5 min) |
| Daily agg | `20 0 * * *` (00:20 daily) |
| Anomaly checks | `* * * * *` (every minute) |
| Retention cleanup | `30 0 * * *` (00:30 daily, only if `TRAFFIC_RETENTION_CRON_ENABLED=true`) |
