# leaveRequestClient

## Purpose
Leave request microservice for applying, approving, and managing leave requests.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';

const leaveRequestProto = loadProto('leave_request');

// SAME pattern as leaveTypeClient
const LEAVE_REQUEST_SERVICE_ADDR =
    process.env.LEAVE_REQUEST_SERVICE_ADDR || 'localhost:5078';

export const leaveRequestClient = new leaveRequestProto.LeaveRequestService(
    LEAVE_REQUEST_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `LEAVE_REQUEST_SERVICE_ADDR` | `localhost:5078` |

## Proto Service
- **Proto loaded:** `leave_request`
- **Exported client:** `leaveRequestClient`
- **Constructor:** `leaveRequestProto.LeaveRequestService`

## gRPC Methods
```
ApplyLeave
CancelLeave
ApproveLeave
RejectLeave
GetLeaveRequest
ListLeaveRequests
GetLeaveBalance
GetLeaveCalendar
```
