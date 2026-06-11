# orgDepartmentClient

## Purpose
Organization department microservice for managing organizational departments.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const OrgDepartment = loadProto('org_department');
const ORG_DEP_SERVICE_ADDR = process.env.ORG_DEPT_SERVICE_ADDR || 'localhost:50054';

export const orgDepartmentClient = new OrgDepartment.OrgDepartmentService(
    ORG_DEP_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ORG_DEPT_SERVICE_ADDR` | `localhost:50054` |

## Proto Service
- **Proto loaded:** `org_department`
- **Exported client:** `orgDepartmentClient`
- **Constructor:** `OrgDepartment.OrgDepartmentService`

## gRPC Methods
```
CreateDepartment
GetDepartment
ListDepartments
ListDepartmentEmployees
UpdateDepartment
DeleteDepartment
```
