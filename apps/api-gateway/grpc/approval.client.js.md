# approvalFlowClient

## Purpose
Approval flow microservice for defining approval flows and managing approval instances.

## Source
```js
// src/grpc/approval.client.js
import { grpc, loadProto } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const approvalProto = loadProto('approval');

// Always ensure a string host:port
const APPROVAL_SERVICE_ADDR =
  process.env.APPROVAL_SERVICE_ADDR || 'localhost:5063';

console.log('[gateway] APPROVAL_SERVICE_ADDR =', APPROVAL_SERVICE_ADDR);

export const approvalFlowClient = new approvalProto.ApprovalFlowService(
  APPROVAL_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);

export const approvalInstanceClient = new approvalProto.ApprovalInstanceService(
  APPROVAL_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `APPROVAL_SERVICE_ADDR` | `localhost:5063` |

## Proto Service
- **Proto loaded:** `approval`
- **Exported client:** `approvalFlowClient`
- **Constructor:** `approvalProto.ApprovalFlowService`

## gRPC Methods
```
CreateFlow
GetFlow
ListFlows
UpdateFlow
DeleteFlow
StartApproval
GetApproval
Approve
Reject
ListPending
```
