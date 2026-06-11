# assetRequestClient

## Purpose
Asset request microservice for handling employee asset requests and approvals.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetRequestsProto = loadProto('asset_request');
const ASSET_REQ_SERVICE_ADDR = process.env.ASSET_REQ_SERVICE_ADDR || 'localhost:50066';

export const assetRequestClient = new AssetRequestsProto.AssetRequestService(
    ASSET_REQ_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSET_REQ_SERVICE_ADDR` | `localhost:50066` |

## Proto Service
- **Proto loaded:** `asset_request`
- **Exported client:** `assetRequestClient`
- **Constructor:** `AssetRequestsProto.AssetRequestService`

## gRPC Methods
```
CreateAssetRequest
GetAssetRequest
ListAssetRequests
UpdateAssetRequest
ApproveRejectAssetRequest
DeleteAssetRequest
```
