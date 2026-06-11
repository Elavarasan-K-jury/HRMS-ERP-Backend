# `client.js` — Redis Client Singleton

Creates and returns a shared Redis (ioredis) client, configured from environment variables. The client is cached in a module-level variable and reused across all calls.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `REDIS_DB` | `0` | Redis database number |

## Exports

### `getRedis()`

Returns the singleton `Redis` instance, creating it on first call with:
- `retryStrategy`: exponential backoff (200ms × attempt, capped at 2000ms)
- `maxRetriesPerRequest`: `null` (infinite retries)
- Event listeners for `connect` and `error`

Registers `SIGINT`/`SIGTERM` handlers to cleanly disconnect on shutdown.

```js
import { getRedis } from './client.js';
const redis = getRedis();
await redis.set('foo', 'bar');
```

## Dependencies

- `ioredis` — Redis client library
