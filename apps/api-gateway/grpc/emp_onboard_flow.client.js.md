# onboardingFlowClient

## Purpose
Employee onboarding flow microservice for defining onboarding process flows.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingFlowProto = loadProto('emp_onboarding_flow');
const EMP_ONBOARDING_FLOW_SERVICE_ADDR = process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR || 'localhost:50057';

export const onboardingFlowClient = new EmpOnboardingFlowProto.EmployeeOnboardingFlowService(
    EMP_ONBOARDING_FLOW_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_ONBOARDING_FLOW_SERVICE_ADDR` | `localhost:50057` |

## Proto Service
- **Proto loaded:** `emp_onboarding_flow`
- **Exported client:** `onboardingFlowClient`
- **Constructor:** `EmpOnboardingFlowProto.EmployeeOnboardingFlowService`

## gRPC Methods
```
CreateEmployeeOnboardingFlow
GetEmployeeOnboardingFlow
ListEmployeeOnboardingFlows
UpdateEmployeeOnboardingFlow
DeleteEmployeeOnboardingFlow
```
