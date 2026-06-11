# Health Routes

**Service:** In-memory metrics (uses `serviceMetrics` middleware)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/service-metrics` | Get per-microservice runtime metrics |

## Code Snippet

```js
async (c) => {
    const array = Object.entries(serviceMetrics).map(([service, m]) => {
        const total = m.totalRequests || 1;
        const errorRate = Number(((m.errorCount / total) * 100).toFixed(1));
        const status =
            m.errorCount === 0 ? 'UP'
            : errorRate > 50 ? 'UNSTABLE' : 'DEGRADED';
        return { service, ...m, errorRate, status, lastErrorAt: m.lastErrorAt ?? null };
    });
    return c.json(array, 200);
}
```

## Request/Response Schemas

- **Metrics** (array): `[{ service, totalRequests, successCount, errorCount, lastErrorMessage, lastErrorAt, lastLatencyMs, avgLatencyMs, inFlight, errorRate, status }]`

## Unique Logic

- No gRPC call; reads from an in-memory `serviceMetrics` object populated by middleware.
- Computes `errorRate` and derives `status` (UP / DEGRADED / UNSTABLE) on the fly.
