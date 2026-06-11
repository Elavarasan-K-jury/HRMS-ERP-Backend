# payslipClient

## Purpose
Payslip microservice for managing EJS payslip templates and rendering.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const PayslipProto = loadProto('payslip');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const payslipClient = new PayslipProto.PayslipService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SALARY_PAYROLL_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `payslip`
- **Exported client:** `payslipClient`
- **Constructor:** `PayslipProto.PayslipService`

## gRPC Methods
```
GetEjsTemplate
SaveEjsTemplate
RenderEjsTemplate
```
