# jobs/anomaly.checks.js

**Purpose:** Evaluates active traffic alert rules against aggregated hourly stats and persists alerts when thresholds are breached, respecting per-rule cooldowns.

## Key Exports

```js
export async function runAnomalyChecks()
```

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### Cooldown check (lines 14–20)
```js
if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMinutes * 60 * 1000) {
    continue;
}
```
Skips rules that were triggered recently to prevent alert fatigue.

### Rule types evaluated (switch on lines 68–103)

| Rule Type | Condition |
|---|---|
| `ERROR_RATE` | `(errors / requests) * 100 > threshold` |
| `LATENCY_P95` | `p95LatencyMs > threshold` |
| `LATENCY_AVG` | `avgLatencyMs > threshold` |
| `REQUEST_SPIKE` | `totalRequests > threshold` |

### Atomic alert persistence (lines 112–131)
```js
await prisma.$transaction([
    prisma.trafficAlert.create({ data: { ... } }),
    prisma.trafficAlertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } })
]);
```
Uses a Prisma transaction to atomically create the alert and update the rule's `lastTriggeredAt`.
