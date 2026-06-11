# employeeClient

## Purpose
Employee category microservice for managing employee category classifications.

## Source
```js
import { grpc, loadProto } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const employeeCategoryProto = loadProto('employee_category');
const EMP_CAT_SERVICE_ADDR = process.env.EMP_CAT_SERVICE_ADDR || 'localhost:50052';

export const employeeClient = new employeeCategoryProto.EmployeeCategoryService(
    EMP_CAT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_CAT_SERVICE_ADDR` | `localhost:50052` |

## Proto Service
- **Proto loaded:** `employee_category`
- **Exported client:** `employeeClient`
- **Constructor:** `employeeCategoryProto.EmployeeCategoryService`

## gRPC Methods
```
CreateEmployeeCategory
GetEmployeeCategory
ListEmployeeCategories
ListEmployeeAllCategories
UpdateEmployeeCategory
DeleteEmployeeCategory
```
