# reportClient

## Purpose
Report microservice for generating employee insight template reports.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const reportProto = loadProto('reports');

const REPORT_SERVICE_ADDR = process.env.REPORT_SERVICE_ADDR || 'localhost:50060';

export const reportClient = new reportProto.ReportService(
    REPORT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `REPORT_SERVICE_ADDR` | `localhost:50060` |

## Proto Service
- **Proto loaded:** `reports`
- **Exported client:** `reportClient`
- **Constructor:** `reportProto.ReportService`

## gRPC Methods
```
GenerateEmployeeInsightTemplateReport
```
