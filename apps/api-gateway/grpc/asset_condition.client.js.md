# assetConditionClient

## Purpose
Asset condition microservice for tracking asset condition statuses.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetConditionProto = loadProto('asset_condition');
const ASSET_CON_SERVICE_ADDR = process.env.ASSET_CON_SERVICE_ADDR || 'localhost:50068';

export const assetConditionClient = new AssetConditionProto.AssetConditionService(
    ASSET_CON_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSET_CON_SERVICE_ADDR` | `localhost:50068` |

## Proto Service
- **Proto loaded:** `asset_condition`
- **Exported client:** `assetConditionClient`
- **Constructor:** `AssetConditionProto.AssetConditionService`

## gRPC Methods
```
CreateAssetCondition
GetAssetCondition
ListAssetConditions
UpdateAssetCondition
DeleteAssetCondition
```
