# req_logged.js — Request Logger Middleware

## Purpose
Logs every incoming HTTP request and its corresponding response status and duration for observability.

## Key Components

### `requestLogger` Middleware
An async Hono middleware that captures start time, awaits the downstream handler, then logs the result:

```js
export const requestLogger = async (c, next) => {
    const start = Date.now();
    const { method, url } = c.req;
    const startedAt = new Date().toISOString();

    console.log(`➡️ [${startedAt}] ${method} ${url}`);

    try {
        await next();
    } finally {
        const ms = Date.now() - start;
        const endedAt = new Date().toISOString();
        const status = c.res.status;
        console.log(`⬅️ [${endedAt}] ${method} ${url} -> ${status} (${ms}ms)`);
    }
};
```

The `try/finally` block ensures response logging happens even if the downstream handler throws.

## Dependencies
- No external dependencies (uses only `console.log`)

## Patterns
- **Timing wrapper**: Measures elapsed time via `Date.now()` diff.
- **Fire-and-log**: Non-blocking; uses `await next()` then logs after response.
- **Error-safe**: `finally` guarantees logging regardless of downstream errors.
