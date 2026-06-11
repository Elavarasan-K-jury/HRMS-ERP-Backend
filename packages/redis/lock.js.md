# `lock.js` — Distributed Locking via Redlock

Provides distributed mutex locks across multiple Redis instances (or a single instance) using the `redlock` library.

## Exports

### `getLock()`
Returns a singleton `Redlock` instance configured with:
- `retryCount: 10` — retry up to 10 times
- `retryDelay: 100` — 100ms between retries
- `retryJitter: 50` — ±50ms jitter

```js
const lock = getLock();
const acquired = await lock.acquire(['resource:1'], 5000);
await acquired.release();
```

### `runWithLock(resource, ttlMs, fn)`
Acquires a lock on the given resource key, executes `fn`, and releases the lock in a `finally` block. The lock release failure is silently caught.

```js
const result = await runWithLock('lock:org:acme.com', 5000, async () => {
    return await doCriticalWork();
});
```

## Dependencies

- `redlock` — Distributed lock implementation
- `./client.js` — `getRedis` (provides the Redis client)
