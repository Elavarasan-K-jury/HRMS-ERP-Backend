# shiftClient

## Purpose
Shift microservice for managing shift definitions.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const shiftProto = loadProto('shift');
const SHIFT_SERVICE_ADDR = process.env.SHIFT_SERVICE_ADDR || 'localhost:5063';
console.log(SHIFT_SERVICE_ADDR);

export const shiftClient = new shiftProto.ShiftService(
    SHIFT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SHIFT_SERVICE_ADDR` | `localhost:5063` |

## Proto Service
- **Proto loaded:** `shift`
- **Exported client:** `shiftClient`
- **Constructor:** `shiftProto.ShiftService`

## gRPC Methods
```
CreateShift
GetShift
ListShifts
UpdateShift
DeleteShift
```
