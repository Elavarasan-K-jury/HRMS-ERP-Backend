# Employee Onboarding Progress Service

## Purpose
Tracks individual employee progress through onboarding flows by recording feature values filled in during the onboarding process.

## Key gRPC Methods
- **CreateEmployeeOnboardingProgress** - Creates a progress record linking an employee, flow, step, and feature with the value filled in. Validates all related entities exist and prevents duplicate records.
```js
const existing = await prisma.onboardingProgress.findFirst({
    where: {
        employeeId: data.employee_id,
        flowId: data.flow_id,
        stepId: data.step_id,
        stepFeatureId: data.step_feature_id,
    },
});
```
- **GetEmployeeOnboardingProgress** - Fetches a single progress record by ID.
- **ListEmployeeOnboardingProgresses** - Lists progress records filtered by employee and/or flow.
- **UpdateEmployeeOnboardingProgress** - Updates the feature value for a progress record.
- **DeleteEmployeeOnboardingProgress** - Hard-deletes a progress record.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapProgress(progress)` | Maps progress record to API format (employee_id, flow_id, step_id, step_feature_id, step_feature_value) |

**Server port:** `process.env.EMP_ONBOARDING_PROGRESS_SERVICE_PORT || 5061`
