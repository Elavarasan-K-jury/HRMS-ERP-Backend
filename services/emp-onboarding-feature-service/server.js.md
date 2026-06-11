# Employee Onboarding Feature Service

## Purpose
Manages features (form fields) within onboarding steps, supporting typed fields with optional configurable options.

## Key gRPC Methods
- **CreateEmployeeOnboardingFeature** - Creates a feature within a step with a name, type, optional has-options flag, and options (parsed from JSON string). Validates step existence.
- **GetEmployeeOnboardingFeature** - Fetches a single feature by ID.
- **ListEmployeeOnboardingFeatures** - Paginated listing with optional step_id filter and search by feature name.
- **UpdateEmployeeOnboardingFeature** - Updates feature fields (name, type, has_options, options).
- **DeleteEmployeeOnboardingFeature** - Hard-deletes a feature record.

```js
// Options stored as JSON in DB
options: data.options ? JSON.parse(data.options) : null,
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapFeature(feature)` | Maps feature to API format, serializing `options` as JSON string |

**Server port:** `process.env.EMP_ONBOARDING_FEATURE_SERVICE_PORT || 5059`
