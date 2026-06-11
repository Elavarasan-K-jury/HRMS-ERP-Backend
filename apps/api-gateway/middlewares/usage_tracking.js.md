# usage_tracking.js — Organization Usage Tracking Middleware

## Purpose
Records per-organization API usage events into the database by sampling requests and extracting organization identity from headers, query params, or body.

## Key Components

### Configuration
Defines paths/methods to ignore and a sample rate (default 1 = log every request):

```js
const IGNORE_PATHS = ["/swagger", "/doc", "/favicon.ico", "/health", "/metrics"];
const IGNORE_METHODS = ["OPTIONS"];
const SAMPLE_RATE = Number(process.env.USAGE_SAMPLE_RATE || 1);
```

### Helpers
- `shouldIgnore(path, method)` — Skips ignored paths and methods
- `shouldSample()` — Probabilistic sampling based on `SAMPLE_RATE`
- `normalizeRoute(path)` — Replaces numeric/hex/uuid segments with `:id`/`:uuid` placeholders

### Organization ID Resolution
Searches multiple locations for the organization identifier, supporting header key variations:

```js
const ORG_KEYS = ["organizationid", "organization_id", "orgid", "org_id",
                   "xorganizationid", "xorganization-id", "xorgid", "xorg-id"];

function resolveOrganizationIdFromHeaders(c) {
    return (
        findInHeaders(c.req.raw?.headers) ||
        findInObject({
            "x-org-id": c.req.header("x-org-id"),
            "x-organization-id": c.req.header("x-organization-id"),
            organizationId: c.req.header("organizationId"),
        })
    );
}
```

Key matching is case-insensitive and ignores `_`/`-` via `normalizeKey()`.

### Middleware
The `usageMiddleware` factory accepts resolver functions and returns a Hono middleware:

```js
export function usageMiddleware({ serviceNameResolver, moduleResolver, featureResolver }) {
    return async (c, next) => {
        // ... skip checks, sampling
        await next(); // NEVER BLOCK BEFORE THIS
        // Build and persist event
        const event = {
            organizationId,
            employeeId: c.req.header("x-employee-id") || null,
            role: c.req.header("x-role") || null,
            module: typeof moduleResolver === "function" ? moduleResolver(c) : null,
            action: c.req.method,
            endpoint: path,
            durationMs: duration,
            statusCode: status,
            success: status < 400,
            // ...
        };
        // Fire-and-forget (NO await)
        Promise.resolve()
            .then(() => prisma.organizationUsageEvent.create({ data: event }))
            .catch((err) => console.error("usage.middleware:", err.message));
    };
}
```

The database write is deliberately fire-and-forget (no `await`) to never block the response.

## Dependencies
- `crypto` — `randomUUID()` for generating request IDs
- `@jury-hrms/db/client.js` — Prisma client for `organizationUsageEvent` persistence

## Patterns
- **Factory middleware**: `usageMiddleware({...})` returns a configured middleware closure.
- **Fire-and-forget persistence**: DB writes happen asynchronously after the response.
- **Probabilistic sampling**: Reduces database load by only recording a fraction of requests.
- **Multi-source org resolution**: Examines headers, query params, and JSON body for org ID.
