# `hash.js` — Redis Hash Operations

Convenience functions for working with Redis Hashes, automatically serializing/deserializing complex values as JSON strings.

## Exports

### `hsetObject(key, obj)`
Stores a flat JavaScript object as a Redis hash. String/number/null values are stored as strings; other types (objects, arrays) are `JSON.stringify`'d.

```js
await hsetObject('org:123', { name: 'Acme', settings: { theme: 'dark' } });
// HSET org:123 name "Acme" settings '{"theme":"dark"}'
```

### `hgetObject(key)`
Retrieves all fields of a hash. Each value is attempted to be `JSON.parse`'d; if parsing fails, the raw string value is returned.

```js
const obj = await hgetObject('org:123');
// => { name: 'Acme', settings: { theme: 'dark' } }
```

### `hdel(key, ...fields)`
Deletes one or more fields from a hash.

```js
await hdel('org:123', 'settings');
```

### `expire(key, seconds)`
Sets a TTL on a key.

```js
await expire('org:123', 300);
```

## Dependencies

- `./client.js` — `getRedis`
