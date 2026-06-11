# salary-and-payroll-service/handlers/SalaryTemplate.handler.js

## Purpose
gRPC handlers for managing salary templates — the metadata shell that groups department/designation eligibility, ranges, and component definitions.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `listSalaryTemplatesFunc` | Paginated list with resolved department/designation names and range details |
| `getSalaryTemplateFunc` | Fetches a single template by ID |
| `upsertSalaryTemplateFunc` | Creates or updates template metadata (name, description, departments, designations) |
| `deleteSalaryTemplateFunc` | Soft-deletes a salary template |
| `PreviewSalaryForEmployee` | Computes a salary preview for a given employee + template + gross (delegated to calculation engine) |

## Important Logic

### Template Resolution with Employee Match
When previewing, the handler auto-selects the best template for an employee by matching department/designation:

```js
tpl = await prisma.salaryTemplate.findFirst({
    where: {
        organizationId: organization_id,
        deletedAt: null,
        isActive: true,
        OR: [
            { departments: { has: emp.departmentId } },
            { designations: { has: emp.designationId } },
        ],
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
});
```

### Range Matching (Gross-Based)
After selecting a template, the handler finds the salary range that encompasses the given gross:

```js
function rangeMatches(range, gross) {
    const low = Number(range.grossLow ?? 0);
    const high = range.grossHigh == null ? Infinity : Number(range.grossHigh);
    return gross >= low && gross <= high;
}

const picked = ranges.find((r) => rangeMatches(r, Number(gross)));
```

### Name Uniqueness (per Org)
Enforced on both create and update to prevent duplicate template names within an organization.

## Helper Functions

- **`rangeMatches(range, gross)`** — Checks if a gross value falls within a salary range's bounds.
