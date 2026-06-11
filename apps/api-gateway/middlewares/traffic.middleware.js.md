# traffic.middleware.js — Traffic Event Middleware

## Purpose
Captures detailed per-request traffic telemetry (timing, status, error classification, IP, user agent) and publishes it asynchronously for observability.

## Key Components

### Configuration
```js
const IGNORE_PATHS = ["/swagger", "/doc", "/favicon.ico", "/health", "/metrics"];
const IGNORE_METHODS = ["OPTIONS"];
const SAMPLE_RATE = Number(process.env.TRAFFIC_SAMPLE_RATE || 1);
const INSTANCE_ID = process.env.INSTANCE_ID || null;
```

### Helpers
- `getIp(c)` — Extracts client IP from proxy headers
- `normalizeRoute(path)` — Replaces dynamic segments with `:id`/`:uuid` patterns
- `classifyStatus(code)` — Groups status codes into `2xx`, `3xx`, `4xx`, `5xx`
- `classifyError(code)` — Categorizes errors: `auth`, `rate_limit`, `validation`, `server`
- `shouldIgnore()` / `shouldSample()` — Filtering and probabilistic sampling

### Organization ID Resolution
Multi-source search (headers → query params → route params → JSON body) with normalized key matching:

```js
async function resolveOrganizationId(c) {
    // headers, query, params, body (with nested org/org.id support)
}
```

### Middleware
The `trafficMiddleware` factory accepts resolver functions and a `publish` callback, then builds a rich event object:

```js
export function trafficMiddleware({ serviceNameResolver, moduleResolver, publish }) {
    return async (c, next) => {
        const start = Date.now();
        // skip/ignore/sample checks
        await next();

        const event = {
            timestamp: new Date(),
            organizationId: await resolveOrganizationId(c),
            userId: c.req.header("x-user-id") || null,
            role: c.req.header("x-role") || null,
            service: typeof serviceNameResolver === "function" ? serviceNameResolver(c) : "api-gateway",
            endpoint: path,
            routeKey: normalizeRoute(path),
            method: c.req.method,
            statusCode: status,
            statusClass: classifyStatus(status),
            success: status < 400,
            responseTimeMs: duration,
            errorType: classifyError(status),
            requestSizeBytes: Number(c.req.header("content-length")) || null,
            responseSizeBytes: Number(c.res?.headers?.get("content-length")) || null,
            ip: getIp(c),
            userAgent: c.req.header("user-agent") || null,
            source: c.req.header("x-client-type") || "web",
            serverInstance: INSTANCE_ID,
            isSystem: false,
        };

        Promise.resolve().then(() => publish(event)).catch(console.log);
    };
}
```

The `publish` call is fire-and-forget (wrapped in `Promise.resolve().then()`).

## Dependencies
- `crypto` — `randomUUID()` for request ID generation

## Patterns
- **Factory function**: Accepts resolvers and publish callback for pluggable backends.
- **Fire-and-forget publishing**: Never blocks the request response.
- **Rich event structure**: Captures timing, classification, identity, network metadata.
- **Probabilistic sampling**: Reduces volume via `TRAFFIC_SAMPLE_RATE`.
- **Error classification**: Categorizes 4xx/5xx errors into business-relevant types.
