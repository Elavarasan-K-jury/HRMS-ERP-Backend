# Employee Onboarding Step Service

## Purpose
Manages individual steps within an employee onboarding flow, providing CRUD with flow validation and duplicate name checking.

## Key gRPC Methods
- **CreateEmployeeOnboardingStep** - Creates a step within an onboarding flow with name and active status. Validates flow existence and prevents duplicate step names within the same flow.
- **GetEmployeeOnboardingStep** - Fetches a single step by ID.
- **ListEmployeeOnboardingSteps** - Paginated listing with flow filter and search by step name.
- **UpdateEmployeeOnboardingStep** - Updates step name and active status.
- **DeleteEmployeeOnboardingStep** - Soft-deletes a step.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapStep(step)` | Maps step to API format with onboarding_id, name, is_active, and timestamps |

**Server port:** `process.env.EMP_ONBOARDING_STEP_SERVICE_PORT || 5058`
