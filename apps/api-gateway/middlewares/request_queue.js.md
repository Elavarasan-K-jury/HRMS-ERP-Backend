# request_queue.js — Request Queue Middleware

## Purpose
Limits concurrency of gRPC backend calls by wrapping route handlers in a `p-queue` instance, with a configurable queue size cap.

## Key Components

### Queue Setup
A `p-queue` instance with fixed concurrency:

```js
const concurrency = 10;
const queueLimit = Number(process.env.REQUEST_QUEUE_LIMIT || 50);

export const queue = new PQueue({ concurrency });
```

### `withQueue` Wrapper
Returns an async middleware function that checks queue size and enqueues the handler:

```js
export function withQueue(handler) {
    return async (c, next) => {
        if (queue.size >= queueLimit) {
            return c.json({ error: 'Server is busy. Try again shortly.' }, 429);
        }
        return queue.add(() => handler(c, next));
    };
}
```

## Dependencies
- `p-queue` — Promise-based queue with configurable concurrency
- `dotenv` — Environment configuration

## Patterns
- **Decorator function**: `withQueue(handler)` wraps a route handler with queue logic.
- **Bounded queue**: Rejects requests with 429 when the pending queue exceeds the limit.
- **Concurrency control**: Limits simultaneous gRPC calls to prevent resource exhaustion.
