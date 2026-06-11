# salaryClient

## Purpose
Salary engine microservice for employee salary assignment, calculation, and structure management.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const SalaryPayrollProto = loadProto('employee_salary');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const salaryClient = new SalaryPayrollProto.SalaryEngineService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SALARY_PAYROLL_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `employee_salary`
- **Exported client:** `salaryClient`
- **Constructor:** `SalaryPayrollProto.SalaryEngineService`

## gRPC Methods
```
AssignSalary
UpdateSalary
ApplyTemplate
Recalculate
GetStructure
GetStructureById
GetRevisionHistory
OverrideComponent
BulkRecalculate
PreviewTemplateCalculation
```
