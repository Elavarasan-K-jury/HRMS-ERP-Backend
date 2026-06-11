# financeClient

## Purpose
Finance microservice for managing PF, ESI, PTax settings and finance configuration.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const FinanceProto = loadProto('finance');

const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const financeClient = new FinanceProto.FinanceService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SALARY_PAYROLL_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `finance`
- **Exported client:** `financeClient`
- **Constructor:** `FinanceProto.FinanceService`

## gRPC Methods
```
CheckIfFinanceEnabledOrNot
EnableAndSavePfDetails
EnableAndSaveEsiDetails
EnableAndSavePtaxDetails
GetOrganizationFinanceDetails
EnableDisablePfDetails
EnableDisableEsiDetails
EnableDisablePtaxDetails
```
