# rate_limiter.js — Rate Limiter Middleware

## Purpose
Limits API request rates per-organization (or per-IP as fallback) using Redis for distributed tracking, with an in-memory fallback when Redis is unavailable.

## Key Components

### Configuration
```js
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW || 60) * 1000;
const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_MAX || 100);
const MAX_QUEUE = Number(process.env.REQUEST_QUEUE_LIMIT || 0);
```

### Redis Client
Attempts to connect to Redis; falls back to in-memory `Map`:

```js
let redis;
try {
    redis = getRedis();
} catch {
    console.warn('[rateLimiter] Redis not available, using in-memory fallback');
    redis = null;
}
const memoryStore = new Map();
```

### Organization ID Resolution
Searches headers, query params, route params, and JSON body for org ID using normalized key matching:

```js
async function resolveOrganizationId(c) {
    // 1) Headers
    // 2) Query params
    // 3) Route params
    // 4) JSON body (with nested org/org.id support)
}
```

### Rate Limit Middleware
The key is scoped as `ratelimit:org:{id}` or `ratelimit:ip:{addr}`. Organization-level rate limits can be dynamically loaded from the database:

```js
if (organizationId) {
    const org = await prisma.organizations.findUnique({
        where: { id: organizationId },
        select: { maxApiRatePerMin: true }
    });
    if (org?.maxApiRatePerMin) LIMIT = org.maxApiRatePerMin;
}
```

**Redis path**: Uses `getJSON`/`setJSON` with TTL for sliding window counting:

```js
if (redis) {
    const data = await getJSON(key);
    record = data ? { count: Number(data.count), startTime: Number(data.startTime) }
                  : { count: 0, startTime: now };
    // Handle window reset or increment
    await setJSON(key, record, Math.ceil(ttl / 1000));
}
```

**Memory path**: Same logic using a `Map` with no TTL (in-memory only):

```js
else {
    record = memoryStore.get(key) || { count: 0, startTime: now };
    // window check + increment
    memoryStore.set(key, record);
}
```

**Queue control**: If the count exceeds `MAX_QUEUE`, returns `503`:

```js
if (MAX_QUEUE > 0 && record.count > MAX_QUEUE) {
    return c.json({ error: 'Server overloaded', message: `...${ttl}...` }, 503);
}
```

**Limit check**: If `record.count > LIMIT`, returns `429`:

```js
if (record.count > LIMIT) {
    return c.json({ error: 'Rate limit exceeded', message: `Try again in ${Math.ceil(ttl/1000)} second(s).`, scope: organizationId ? 'organization' : 'ip' }, 429);
}
```

### Cleanup
```js
process.on('exit', () => { if (redis) redis.quit(); });
```

## Dependencies
- `@jury-hrms/redis` — `getRedis`, `setJSON`, `getJSON` for Redis-backed rate state
- `@jury-hrms/db/client.js` — Prisma client for loading org-level rate limits
- `dotenv` — Environment configuration

## Patterns
- **Sliding window**: Each request checks elapsed time since window start; resets if expired.
- **Redis fallback**: Gracefully degrades to in-memory when Redis is down.
- **Per-org rate limiting**: Fetches custom `maxApiRatePerMin` from the database.
- **IP fallback scoping**: Falls back to IP-based limiting when org ID cannot be resolved.
