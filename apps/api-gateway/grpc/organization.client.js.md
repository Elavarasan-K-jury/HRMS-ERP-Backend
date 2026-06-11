# orgClient

## Purpose
Organization microservice for organization CRUD and hierarchy management.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const organizationProto = loadProto('organization');
const ORG_SERVICE_ADDR = process.env.ORG_SERVICE_ADDR || 'localhost:50051';

export const orgClient = new organizationProto.OrganizationService(
    ORG_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ORG_SERVICE_ADDR` | `localhost:50051` |

## Proto Service
- **Proto loaded:** `organization`
- **Exported client:** `orgClient`
- **Constructor:** `organizationProto.OrganizationService`

## gRPC Methods
```
CreateOrganization
GetOrganization
ListOrganizations
UpdateOrganization
DeleteOrganization
OrganizationHierarchy
DepartmentHierarchy
```
