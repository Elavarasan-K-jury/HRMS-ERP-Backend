# Employee Category Service

## Purpose
Manages employee categories (e.g., Permanent, Probation, Intern) with configuration for training, probation, notice periods, benefits, and ID prefix generation.

## Key gRPC Methods
- **CreateEmployeeCategory** - Creates or restores (if previously soft-deleted) a category with comprehensive employment configuration fields. Checks for duplicate names.
- **GetEmployeeCategory** - Fetches a single category by ID with organization include.
- **ListEmployeeCategories** - Paginated listing with search (name, code, idPrefix) and sorting.
- **ListEmployeeAllCategories** - Unpaginated listing of all categories for an organization.
- **UpdateEmployeeCategory** - Updates all category configuration fields with organization validation.
- **DeleteEmployeeCategory** - Soft-deletes a category.

```js
// Comprehensive category configuration
const mappedData = {
    organizationId: data.organization_id,
    name: data.name,
    code: data.code ?? null,
    description: data.description ?? null,
    idPrefix: data.id_prefix ?? null,
    isPermanent: data.is_permanent,
    benefitsApplicable: data.benefits_applicable,
    isActive: data.is_active,
    trainingRequired: data.training_required,
    trainingMonths: data.training_months,
    probationRequired: data.probation_required,
    probationMonths: data.probation_months,
    noticeRequired: data.notice_required,
    noticeMonths: data.notice_months,
    ...
};
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `formatDate(date)` | Formats date to Indian locale (DD/MM/YYYY, HH:MM AM/PM) |
| `mapOrg(org)` | Maps organization with all fields |
| `mapCategory(category)` | Maps category with nested organization and all configuration fields |

**Server port:** `process.env.EMP_CAT_SERVICE_PORT || 5052`
