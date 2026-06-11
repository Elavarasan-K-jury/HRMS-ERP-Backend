# onboardingFeatureClient

## Purpose
Employee onboarding feature microservice for defining onboarding features.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingFeatureProto = loadProto('emp_onboarding_feature');
const EMP_ONBOARDING_FEATURE_SERVICE_ADDR = process.env.EMP_ONBOARDING_FEATURE_SERVICE_ADDR || 'localhost:50059';

export const onboardingFeatureClient = new EmpOnboardingFeatureProto.EmployeeOnboardingFeatureService(
    EMP_ONBOARDING_FEATURE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `EMP_ONBOARDING_FEATURE_SERVICE_ADDR` | `localhost:50059` |

## Proto Service
- **Proto loaded:** `emp_onboarding_feature`
- **Exported client:** `onboardingFeatureClient`
- **Constructor:** `EmpOnboardingFeatureProto.EmployeeOnboardingFeatureService`

## gRPC Methods
```
CreateEmployeeOnboardingFeature
GetEmployeeOnboardingFeature
ListEmployeeOnboardingFeatures
UpdateEmployeeOnboardingFeature
DeleteEmployeeOnboardingFeature
```
