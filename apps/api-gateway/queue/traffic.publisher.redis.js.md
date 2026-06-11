# traffic.publisher.redis.js — Traffic Event Publisher (Redis Streams)

## Purpose
Buffers traffic events in memory and periodically publishes them to a Redis Stream for downstream consumers.

## Key Components

### Redis Connection
Creates an ioredis client with retry and ready-check enabled:

```js
const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
});
```

### Configuration
```js
const STREAM = process.env.TRAFFIC_STREAM || "traffic.events";
const FLUSH_INTERVAL_MS = Number(process.env.TRAFFIC_STREAM_FLUSH_MS || 300);
const MAX_BATCH_SIZE = Number(process.env.TRAFFIC_STREAM_BATCH || 200);
const MAX_BUFFER_SIZE = Number(process.env.TRAFFIC_STREAM_BUFFER || 10000);
const STREAM_MAXLEN = Number(process.env.TRAFFIC_STREAM_MAXLEN || 200000);
```

### `publishTrafficEvent` — Buffer Append
Normalizes event fields and pushes to the internal buffer:

```js
export function publishTrafficEvent(event) {
    if (!event || !event.service || !event.endpoint) return;
    if (buffer.length >= MAX_BUFFER_SIZE) { dropped++; return; }
    buffer.push({
        timestamp: event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp || Date.now()),
        // all event fields mapped with defaults
    });
}
```

### `flush` — Redis Stream Publish
Uses a Redis pipeline with `XADD` commands, capped at `STREAM_MAXLEN`:

```js
async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer.splice(0, MAX_BATCH_SIZE);

    try {
        const pipeline = redis.pipeline();
        for (const e of batch) {
            pipeline.xadd(STREAM, "MAXLEN", "~", STREAM_MAXLEN, "*",
                "timestamp", s(e.timestamp),
                "organizationId", s(e.organizationId),
                // ... all fields as key-value pairs
            );
        }
        await pipeline.exec();
    } catch (err) {
        // Best-effort requeue
        buffer = batch.concat(buffer).slice(0, MAX_BUFFER_SIZE);
    } finally {
        flushing = false;
    }
}
```

The `s()` helper safely stringifies values:

```js
function s(v) {
    if (v === undefined || v === null) return "";
    return String(v);
}
```

### Periodic Flush + Graceful Shutdown
```js
setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        await shutdownFlush();
        await redis.quit();
        process.exit(0);
    });
}
```

## Dependencies
- `ioredis` — Redis client with pipeline support and stream operations

## Patterns
- **Redis Streams**: Uses `XADD` with capped `MAXLEN ~` (approximate trimming).
- **Pipeline batching**: Efficiently batches multiple `XADD` calls in a single Redis round-trip.
- **Buffer-and-flush**: Same buffering pattern as the MongoDB publisher but targeting Redis.
- **Graceful shutdown**: Drains buffer and quits Redis connection on termination.
