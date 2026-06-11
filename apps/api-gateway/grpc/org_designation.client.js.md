# orgDesignationClient

## Purpose
Organization designation microservice for managing job designations.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const OrgDesignation = loadProto('org_designation');
const ORG_DESG_SERVICE_ADDR = process.env.ORG_DESG_SERVICE_ADDR || 'localhost:50055';

export const orgDesignationClient = new OrgDesignation.OrgDesignationService(
    ORG_DESG_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ORG_DESG_SERVICE_ADDR` | `localhost:50055` |

## Proto Service
- **Proto loaded:** `org_designation`
- **Exported client:** `orgDesignationClient`
- **Constructor:** `OrgDesignation.OrgDesignationService`

## gRPC Methods
```
CreateDesignation
GetDesignation
ListDesignations
ListAllDesignations
UpdateDesignation
DeleteDesignation
```
