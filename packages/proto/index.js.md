# `proto/index.js` — gRPC Proto Loader

Provides a generic helper to load `.proto` files from the same directory and return the gRPC package definition.

## Exports

### `loadProto(name)`
Loads a `.proto` file named `{name}.proto` (located alongside this file) and returns the corresponding gRPC service definition using the proto's own package name.

```js
const orgService = loadProto('organization');
// => grpc service object for 'organization' package
```

The loader uses these proto-loader options:
- `keepCase: true` — preserves original field names (no camelCase conversion)
- `longs: String` — converts Long types to strings
- `enums: String` — converts enums to strings
- `defaults: true` — fills in default values
- `arrays: true` — ensures repeated fields are always arrays

### `grpc`
Re-exports `@grpc/grpc-js` for use by consumers.

```js
import { loadProto, grpc } from '../proto/index.js';
```

## Dependencies

- `@grpc/grpc-js` — gRPC core library
- `@grpc/proto-loader` — `.proto` file loading utilities
