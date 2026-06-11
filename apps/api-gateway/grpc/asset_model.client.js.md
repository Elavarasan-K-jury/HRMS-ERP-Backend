# assetModelClient

## Purpose
Asset model microservice for managing asset model definitions.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetModalProto = loadProto('asset_models');
const ASSET_MOD_SERVICE_ADDR = process.env.ASSET_MOD_SERVICE_ADDR || 'localhost:50064';

export const assetModelClient = new AssetModalProto.AssetModelService(
    ASSET_MOD_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSET_MOD_SERVICE_ADDR` | `localhost:50064` |

## Proto Service
- **Proto loaded:** `asset_models`
- **Exported client:** `assetModelClient`
- **Constructor:** `AssetModalProto.AssetModelService`

## gRPC Methods
```
CreateAssetModel
GetAssetModel
ListAssetModels
UpdateAssetModel
DeleteAssetModel
```
