# adminClient

## Purpose
Admin microservice for authentication, admin user CRUD, and token management.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const adminProto = loadProto('admin');
const ADMIN_SERVICE_ADDR = process.env.ADMIN_SERVICE_ADDR || 'localhost:50060';

export const adminClient = new adminProto.AdminService(
    ADMIN_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ADMIN_SERVICE_ADDR` | `localhost:50060` |

## Proto Service
- **Proto loaded:** `admin`
- **Exported client:** `adminClient`
- **Constructor:** `adminProto.AdminService`

## gRPC Methods
```
RequestLoginOtp
VerifyLoginOtp
RefreshTokens
VerifyToken
CreateAdmin
UpdateAdmin
GetAdmin
ListAdmins
DeleteAdmin
```
