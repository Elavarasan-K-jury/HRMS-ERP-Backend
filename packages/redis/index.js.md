# `redis/index.js` — Redis Package Barrel

Re-exports all Redis utilities from the submodules for convenient single-import access.

```js
import { getRedis, cache, setJSON, keys, runWithLock, publish, subscribe } from '../redis/index.js';
```

## Exports

| Symbol | Source |
|---|---|
| `getRedis` | `./client.js` |
| `hsetObject`, `hgetObject`, `hdel`, `expire` | `./hash.js` |
| `setJSON`, `getJSON`, `del` | `./json.js` |
| `cache` | `./cache.js` |
| `publish`, `subscribe`, `getSubscriber` | `./pubsub.js` |
| `getLock`, `runWithLock` | `./lock.js` |
| `keys` | `./keys.js` |
