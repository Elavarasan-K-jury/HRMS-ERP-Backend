# `keys.js` — Redis Key Builders

Centralized Redis key generation functions, prefixed with a namespace (`REDIS_NAMESPACE` or `"jury"`).

## Exports

### `keys`

```js
export const keys = {
    orgById:        (id)     => `${NS}:org:${id}`,
    orgByDomain:    (domain) => `${NS}:org:domain:${domain}`,
    orgListPage:    (page)   => `${NS}:org:list:page:${page}`,
    lockOrg:        (domain) => `${NS}:lock:org:${domain}`,
};
```

Usage:

```js
const key = keys.orgById('64a...');  // => "jury:org:64a..."
```

## Dependencies

None (pure string functions).
