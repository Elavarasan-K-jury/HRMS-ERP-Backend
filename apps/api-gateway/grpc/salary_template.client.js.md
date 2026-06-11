# salaryTemplateClient

## Purpose
Salary template microservice for managing salary template definitions.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const SalaryTemplateProto = loadProto('salary_template');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const salaryTemplateClient = new SalaryTemplateProto.SalaryTemplateService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SALARY_PAYROLL_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `salary_template`
- **Exported client:** `salaryTemplateClient`
- **Constructor:** `SalaryTemplateProto.SalaryTemplateService`

## gRPC Methods
```
ListSalaryTemplates
UpsertSalaryTemplate
DeleteSalaryTemplate
```
