# `cache.js` — Cache-Aside Helper

Implements a simple cache-aside pattern: check Redis for a key, return it if found; otherwise call a loader function, store the result in Redis, and return it.

## Exports

### `cache(key, ttlSeconds, loaderFn)`

```js
const data = await cache('org:123', 300, () => fetchOrgFromDb(123));
```

Logic:
1. Calls `getJSON(key)` — if non-null, returns cached value.
2. Otherwise calls `loaderFn()`, stores result with `setJSON(key, data, ttlSeconds)`, and returns data.

## Dependencies

- `./json.js` — `getJSON`, `setJSON`
