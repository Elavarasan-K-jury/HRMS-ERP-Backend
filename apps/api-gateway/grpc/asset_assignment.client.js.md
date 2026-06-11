# assetAssignmentClient

## Purpose
Asset assignment microservice for managing asset assignments to employees.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const AssetAssignmentProto = loadProto('asset_assignment');
const ASSET_ASSIGN_SERVICE_ADDR = process.env.ASSET_ASSIGN_SERVICE_ADDR || 'localhost:50067';

export const assetAssignmentClient = new AssetAssignmentProto.AssetAssignmentService(
    ASSET_ASSIGN_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSET_ASSIGN_SERVICE_ADDR` | `localhost:50067` |

## Proto Service
- **Proto loaded:** `asset_assignment`
- **Exported client:** `assetAssignmentClient`
- **Constructor:** `AssetAssignmentProto.AssetAssignmentService`

## gRPC Methods
```
CreateAssetAssignment
GetAssetAssignment
ListAssetAssignments
UpdateAssetAssignment
DeleteAssetAssignment
```
