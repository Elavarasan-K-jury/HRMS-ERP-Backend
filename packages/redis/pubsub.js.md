# `pubsub.js` — Redis Pub/Sub

Provides publish/subscribe messaging using a dedicated Redis subscriber client (separate from the main client since Redis requires a distinct connection for subscriptions).

## Exports

### `getSubscriber()`
Returns a singleton subscriber client. Creates a new `Redis` instance with the same options as the main client (from `getRedis().options`).

### `publish(channel, message)`
Publishes a message to a channel. Non-string messages are JSON-stringified automatically.

```js
await publish('org:events', { type: 'employee.created', id: '...' });
```

### `subscribe(channel, handler)`
Subscribes to a channel. The handler receives parsed messages (JSON parsed if possible, raw string otherwise). Messages from other channels are ignored.

```js
await subscribe('org:events', (msg) => {
    console.log('Received:', msg);
});
```

## Dependencies

- `ioredis` — Redis client
- `./client.js` — `getRedis` (to copy connection options)
