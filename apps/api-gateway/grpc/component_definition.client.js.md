# componentClient

## Purpose
Component definition microservice for defining salary/payroll components.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const ComponentDefinitionProto = loadProto('component_definition');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const componentClient = new ComponentDefinitionProto.ComponentDefinitionService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SALARY_PAYROLL_SERVICE_ADDR` | `localhost:50063` |

## Proto Service
- **Proto loaded:** `component_definition`
- **Exported client:** `componentClient`
- **Constructor:** `ComponentDefinitionProto.ComponentDefinitionService`

## gRPC Methods
```
FetchComponentDefinitions
CreateComponentDefinition
UpdateComponentDefinition
DeleteComponentDefinition
```
