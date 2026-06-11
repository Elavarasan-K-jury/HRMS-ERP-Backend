# onboardingStepClient

## Purpose
Employee onboarding step microservice for defining individual onboarding steps.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingStepProto = loadProto('emp_onboarding_step');
const EMP_ONBOARDING_STEP_SERVICE_ADDR = process.env.EMP_ONBOARDING_STEP_SERVICE_ADDR || 'localhost:50058';

export const onboardingStepClient = new EmpOnboardingStepProto.EmployeeOnboardingStepService(
    EMP_ONBOARDING_STEP_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_ONBOARDING_STEP_SERVICE_ADDR` | `localhost:50058` |

## Proto Service
- **Proto loaded:** `emp_onboarding_step`
- **Exported client:** `onboardingStepClient`
- **Constructor:** `EmpOnboardingStepProto.EmployeeOnboardingStepService`

## gRPC Methods
```
CreateEmployeeOnboardingStep
GetEmployeeOnboardingStep
ListEmployeeOnboardingSteps
UpdateEmployeeOnboardingStep
DeleteEmployeeOnboardingStep
```
