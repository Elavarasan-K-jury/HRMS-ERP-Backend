# @jury-hrms/redis

Shared Redis utilities for Jury HRMS microservices.

### Features
- Singleton Redis client (`ioredis`)
- Hash helpers (HSET/HGETALL with object mapping)
- JSON get/set with TTL
- Generic cache wrapper
- Pub/Sub with separate subscriber connection
- Distributed locks (redlock)
- Namespaced key helpers

### Env
| Var | Default | Description |
|-----|----------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Connection string |
| `REDIS_DB` | `0` | Database index |
| `REDIS_NAMESPACE` | `jury` | Key namespace prefix |

### Example

```js
import { getRedis, hsetObject, hgetObject, keys } from "@jury-hrms/redis";

// Save hash
await hsetObject(keys.orgById("123"), { name: "JurySoft", industry: "IT" });

// Read hash
const data = await hgetObject(keys.orgById("123"));
console.log(data.name); // => JurySoft
