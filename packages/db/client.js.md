# `client.js` — Prisma Client Singleton & Health Check

Creates a single shared PrismaClient instance (cached on `globalThis`) and exposes a lightweight database connectivity check.

## Exports

### `prisma`
A singleton `PrismaClient` instance. In non-production environments it is attached to `globalThis` to survive hot-reloads.

```js
import { prisma } from './client.js';
const orgs = await prisma.organizations.findMany();
```

### `checkDbConnection(serviceName)`
Sends a `ping: 1` via `$runCommandRaw` to verify the database is reachable. Logs success or calls `process.exit(1)` on failure.

```js
await checkDbConnection('my-service');
// [my-service] ✅ Database reachable
```

## Dependencies

- `@prisma/client` — Prisma ORM client
