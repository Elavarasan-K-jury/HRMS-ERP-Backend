# assetClient

## Purpose
Assets microservice for managing the organization asset inventory.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetsProto = loadProto('assets');
const ASSETS_SERVICE_ADDR = process.env.ASSETS_SERVICE_ADDR || 'localhost:50065';

export const assetClient = new AssetsProto.AssetService(
    ASSETS_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSETS_SERVICE_ADDR` | `localhost:50065` |

## Proto Service
- **Proto loaded:** `assets`
- **Exported client:** `assetClient`
- **Constructor:** `AssetsProto.AssetService`

## gRPC Methods
```
CreateAsset
GetAsset
ListAssets
UpdateAsset
DeleteAsset
```
