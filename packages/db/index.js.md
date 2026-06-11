# `db/index.js` — Prisma Client Re-export

Re-exports all named exports from `@prisma/client`, giving consumers access to Prisma-generated types, enums, and helpers without an extra import.

```js
import { PrismaClient, Gender, AttendanceStatus } from '../db/index.js';
```

## Dependencies

- `@prisma/client`
