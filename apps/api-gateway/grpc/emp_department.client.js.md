# empDepartment

## Purpose
Employee department microservice for managing employee-department assignments.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpDepartmentProto = loadProto('employee_department');
const EMP_DEPT_SERVICE_ADDR = process.env.EMP_DEPT_SERVICE_ADDR || 'localhost:50056';

export const empDepartment = new EmpDepartmentProto.EmployeeDepartmentService(
    EMP_DEPT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_DEPT_SERVICE_ADDR` | `localhost:50056` |

## Proto Service
- **Proto loaded:** `employee_department`
- **Exported client:** `empDepartment`
- **Constructor:** `EmpDepartmentProto.EmployeeDepartmentService`

## gRPC Methods
```
AssignDepartment
GetEmployeeDepartment
ListEmployeeDepartments
ListEmployeeInDepartments
UpdateEmployeeDepartment
RemoveEmployeeDepartment
```
