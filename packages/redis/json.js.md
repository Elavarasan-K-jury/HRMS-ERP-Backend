# `json.js` — Redis JSON String Operations

Serializes JavaScript values to JSON strings for storage and deserializes them on retrieval, with optional TTL support.

## Exports

### `setJSON(key, value, ttlSeconds)`
Stores a value as a JSON string. If `ttlSeconds` is positive, sets the key with a `"EX"` expiry.

```js
await setJSON('org:123', { name: 'Acme' }, 300);
// SET org:123 '{"name":"Acme"}' EX 300
```

### `getJSON(key)`
Retrieves and parses a JSON-stored value. Returns `null` if the key does not exist. If parsing fails, returns the raw string.

```js
const data = await getJSON('org:123');
// => { name: 'Acme' }  (or null)
```

### `del(key)`
Deletes a key.

```js
await del('org:123');
```

## Dependencies

- `./client.js` — `getRedis`
