# shiftAssignmentClient

## Purpose
Shift assignment microservice for managing employee shift assignments.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const shiftAssignmentProto = loadProto('shift_assignment');
const SHIFT_ASSIGNMENT_SERVICE_ADDR = process.env.SHIFT_ASSIGNMENT_SERVICE_ADDR || 'localhost:5064';

export const shiftAssignmentClient = new shiftAssignmentProto.ShiftAssignmentService(
  SHIFT_ASSIGNMENT_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SHIFT_ASSIGNMENT_SERVICE_ADDR` | `localhost:5064` |

## Proto Service
- **Proto loaded:** `shift_assignment`
- **Exported client:** `shiftAssignmentClient`
- **Constructor:** `shiftAssignmentProto.ShiftAssignmentService`

## gRPC Methods
```
AssignShift
GetShiftAssignment
ListShiftAssignments
UpdateShiftAssignment
DeleteShiftAssignment
```
