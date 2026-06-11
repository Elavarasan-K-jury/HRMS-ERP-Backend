# assetCategoryClient

## Purpose
Asset category microservice for managing asset category definitions.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AsssetCategoryProto = loadProto('asset_categories');
const ASSET_CAT_SERVICE_ADDR = process.env.ASSET_CAT_SERVICE_ADDR || 'localhost:50063';

export const assetCategoryClient = new AsssetCategoryProto.AssetCategoryService(
    ASSET_CAT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ASSET_CAT_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `asset_categories`
- **Exported client:** `assetCategoryClient`
- **Constructor:** `AsssetCategoryProto.AssetCategoryService`

## gRPC Methods
```
CreateAssetCategory
GetAssetCategory
ListAssetCategories
UpdateAssetCategory
DeleteAssetCategory
```
