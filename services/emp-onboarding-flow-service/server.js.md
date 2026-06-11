# Employee Onboarding Flow Service

## Purpose
Manages onboarding flow templates that define the sequence of steps and features for onboarding new employees.

## Key gRPC Methods
- **CreateEmployeeOnboardingFlow** - Creates an onboarding flow for an organization with name, description, step count, and estimated duration.
- **GetEmployeeOnboardingFlow** - Fetches a single flow by ID.
- **ListEmployeeOnboardingFlows** - Paginated listing with organization filter and search by name. Includes nested `steps_list` with `features` for each step.
```js
const flows = await prisma.employeeOnboardingFlows.findMany({
    where,
    include: {
        organization: true,
        stepsList: { include: { features: true } }
    },
    ...paginate,
    orderBy: { [sortField]: sortOrder },
});
```
- **UpdateEmployeeOnboardingFlow** - Updates flow fields.
- **DeleteEmployeeOnboardingFlow** - Soft-deletes a flow.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `formatDate(date)` | Formats to Indian locale (DD/MM/YYYY, HH:MM AM/PM) |
| `mapOrg(org)` | Maps organization with all fields |
| `normalizeOptions(opts)` | Safely converts options to JSON string regardless of input type |
| `mapFeature(f)` | Maps feature with normalized options |
| `mapStep(s)` | Maps step with nested features array |
| `mapFlow(flow)` | Maps flow with nested organization, steps_list, and features |

**Server port:** `process.env.EMP_ONBOARDING_FLOW_SERVICE_PORT || 5056`
