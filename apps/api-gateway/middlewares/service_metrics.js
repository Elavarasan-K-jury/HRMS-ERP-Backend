// src/middlewares/service_metrics.js
export const serviceMetrics = {};

// ensure service has an entry
function ensureService(name) {
    if (!serviceMetrics[name]) {
        serviceMetrics[name] = {
            totalRequests: 0,
            successCount: 0,
            errorCount: 0,
            lastErrorMessage: null,
            lastErrorAt: null,
            lastLatencyMs: null,
            avgLatencyMs: null,
            inFlight: 0,
        };
    }
    return serviceMetrics[name];
}

// wrapper for route handlers
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
            m.avgLatencyMs =
                m.avgLatencyMs == null
                    ? latency
                    : Math.round(m.avgLatencyMs * 0.8 + latency * 0.2);

            m.successCount += 1;

            return res;
        } catch (err) {
            const latency = Date.now() - start;
            m.lastLatencyMs = latency;
            m.avgLatencyMs =
                m.avgLatencyMs == null
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
