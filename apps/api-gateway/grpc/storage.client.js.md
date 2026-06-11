# storageClient

## Purpose
Storage microservice for file/folder management, sharing, and uploads.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const storageProto = loadProto('storage');
const STORAGE_SERVICE_ADDR = process.env.STORAGE_SERVICE_ADDR || 'localhost:5084';
console.log(STORAGE_SERVICE_ADDR);

export const storageClient = new storageProto.StorageService(
    STORAGE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `STORAGE_SERVICE_ADDR` | `localhost:5084` |

## Proto Service
- **Proto loaded:** `storage`
- **Exported client:** `storageClient`
- **Constructor:** `storageProto.StorageService`

## gRPC Methods
```
CreateFolder
GetFolder
ListFolders
UpdateFolder
DeleteFolder
UploadFileToFolder
ListFiles
DeleteFile
ShareFolder
UnshareFolder
ListFolderShares
```
