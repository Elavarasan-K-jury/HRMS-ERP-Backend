# service_metrics.js — Per-Service Runtime Metrics Middleware

## Purpose
Collects and exposes runtime metrics (request count, success/error rates, latency, in-flight requests) for each backend microservice.

## Key Components

### Global Metrics Store
An in-memory object keyed by service name:

```js
export const serviceMetrics = {};
```

### `ensureService` — Lazy Initialization
Creates a metrics entry for a service if it doesn't exist:

```js
function ensureService(name) {
    if (!serviceMetrics[name]) {
        serviceMetrics[name] = {
            totalRequests: 0, successCount: 0, errorCount: 0,
            lastErrorMessage: null, lastErrorAt: null,
            lastLatencyMs: null, avgLatencyMs: null, inFlight: 0,
        };
    }
    return serviceMetrics[name];
}
```

### `withServiceMetrics` — Handler Wrapper
Wraps a route handler, tracking timing, success/error counts, and an exponential moving average for latency:

```js
export function withServiceMetrics(serviceName, handler) {
    return async (c, next) => {
        const m = ensureService(serviceName);
        const start = Date.now();
        m.totalRequests += 1;
        m.inFlight += 1;

        try {
            const res = await handler(c, next);
            const latency = Date.now() - start;
            m.lastLatencyMs = latency;
            m.avgLatencyMs = m.avgLatencyMs == null
                ? latency
                : Math.round(m.avgLatencyMs * 0.8 + latency * 0.2);
            m.successCount += 1;
            return res;
        } catch (err) {
            const latency = Date.now() - start;
            m.lastLatencyMs = latency;
            m.avgLatencyMs = m.avgLatencyMs == null
                ? latency
                : Math.round(m.avgLatencyMs * 0.8 + latency * 0.2);
            m.errorCount += 1;
            m.lastErrorMessage = err?.message || String(err);
            m.lastErrorAt = new Date().toISOString();
            throw err;
        } finally {
            m.inFlight = Math.max(0, m.inFlight - 1);
        }
    };
}
```

The exponential moving average uses `avgLatencyMs * 0.8 + latency * 0.2`, weighting recent samples more heavily.

## Dependencies
- None (pure in-memory tracking)

## Patterns
- **Decorator wrapper**: `withServiceMetrics(serviceName, handler)` wraps handlers transparently.
- **Exponential moving average**: Smooths latency measurements toward recent values.
- **Error propagation**: Errors are still re-thrown after recording, preserving normal flow.
- **In-flight tracking**: `inFlight` is incremented/decremented around handler execution.
