# traffic.publisher.js — Traffic Event Publisher (MongoDB)

## Purpose
Buffers traffic events in memory and periodically flushes them to MongoDB using `$runCommandRaw` for efficient batch insertion.

## Key Components

### Configuration
```js
const FLUSH_INTERVAL_MS = 500;
const MAX_BATCH_SIZE = 300;
const MAX_BUFFER_SIZE = 10000;
const INSTANCE_ID = process.env.INSTANCE_ID || null;
```

### Buffer State
```js
let buffer = [];
let flushing = false;
let droppedEvents = 0;
```

### `publishTrafficEvent` — Public API
Validates the event, checks buffer capacity, and pushes to the buffer:

```js
export function publishTrafficEvent(event) {
    if (!event || !event.service || !event.endpoint) return;
    if (buffer.length >= MAX_BUFFER_SIZE) {
        droppedEvents++;
        return;
    }
    buffer.push({
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        organizationId: event.organizationId ?? null,
        userId: event.userId ?? null,
        // ... all event fields mapped with null defaults
    });
}
```

### `flush` — Batch Insert
Splices a batch from the buffer and inserts into MongoDB via raw command:

```js
async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer.splice(0, MAX_BATCH_SIZE);

    try {
        await prisma.$runCommandRaw({
            insert: "TrafficEvent",
            documents: batch,
            ordered: false
        });
    } catch (err) {
        // Best-effort requeue
        buffer.unshift(...batch.slice(0, MAX_BUFFER_SIZE - buffer.length));
    } finally {
        flushing = false;
    }
}
```

### Periodic Flush
Runs every `FLUSH_INTERVAL_MS` (500ms):

```js
setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
```

### Graceful Shutdown
Drains remaining events on `SIGINT`/`SIGTERM`:

```js
async function shutdownFlush() {
    while (buffer.length > 0) { await flush(); }
}
for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        await shutdownFlush();
        process.exit(0);
    });
}
```

## Dependencies
- `@jury-hrms/db/client.js` — Prisma client for `$runCommandRaw` (MongoDB native insert)

## Patterns
- **Batch buffering**: Accumulates events and flushes in batches to reduce DB writes.
- **Backpressure handling**: Drops events when buffer exceeds `MAX_BUFFER_SIZE`; tracks dropped count.
- **Debounced flush**: Periodic interval prevents thundering herd on the database.
- **Best-effort requeue**: Failed batches are re-inserted at the front of the buffer.
- **Graceful shutdown**: Drains all pending events before exit.
