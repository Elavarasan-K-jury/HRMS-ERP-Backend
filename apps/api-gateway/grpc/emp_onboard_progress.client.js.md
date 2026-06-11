# onboardingProgressClient

## Purpose
Employee onboarding progress microservice for tracking employee onboarding progress.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingProgressProto = loadProto('emp_onboarding_progress');
const EMP_ONBOARDING_PROGRESS_SERVICE_ADDR = process.env.EMP_ONBOARDING_PROGRESS_SERVICE_ADDR || 'localhost:50061';

export const onboardingProgressClient = new EmpOnboardingProgressProto.EmployeeOnboardingProgressService(
    EMP_ONBOARDING_PROGRESS_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_ONBOARDING_PROGRESS_SERVICE_ADDR` | `localhost:50061` |

## Proto Service
- **Proto loaded:** `emp_onboarding_progress`
- **Exported client:** `onboardingProgressClient`
- **Constructor:** `EmpOnboardingProgressProto.EmployeeOnboardingProgressService`

## gRPC Methods
```
CreateEmployeeOnboardingProgress
GetEmployeeOnboardingProgress
ListEmployeeOnboardingProgresses
UpdateEmployeeOnboardingProgress
DeleteEmployeeOnboardingProgress
```
