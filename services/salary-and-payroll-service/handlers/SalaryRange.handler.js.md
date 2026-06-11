# salary-and-payroll-service/handlers/SalaryRange.handler.js

## Purpose
gRPC handlers for managing salary ranges within templates — each range defines a gross-salary bracket with its own set of component formulas/values.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateRange` | Creates a non-overlapping gross salary range for a template |
| `UpdateRange` | Updates a range's bounds/label with overlap validation |
| `DeleteRange` | Soft-deletes a range |
| `ListRanges` | Lists all ranges for a template, sorted by grossLow |
| `SaveRangeComponents` | Hard-replaces all template components for a range |
| `GetRangeComponents` | Fetches components assigned to a range |
| `PreviewSalaryForEmployee` | Computes a salary preview using a range's components |

## Important Logic

### Overlap Detection
New ranges must not overlap existing ones. Overlap is checked using a simple interval comparison:

```js
async function validateNoOverlap(templateId, low, highOrNull, excludeRangeId = null) {
    const ranges = await prisma.salaryTemplateRange.findMany({
        where: { templateId, deletedAt: null, ...(excludeRangeId && { id: { not: excludeRangeId } }) },
    });

    const newLow = Number(low);
    const newHigh = highOrNull == null ? Infinity : Number(highOrNull);

    for (const r of ranges) {
        const rLow = Number(r.grossLow ?? 0);
        const rHigh = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        const overlaps = !(newHigh < rLow || newLow > rHigh);
        if (overlaps) return { ok: false, conflictId: r.id };
    }
    return { ok: true };
}
```

### Hard-Replace Components
Saving components for a range deletes all existing `TemplateComponent` records for that range, then creates new ones:

```js
await prisma.templateComponent.deleteMany({
    where: { templateId: template_id, rangeId: range_id },
});

if (components.length) {
    await prisma.templateComponent.createMany({
        data: components.map((c, idx) => ({
            templateId: template_id, rangeId: range_id,
            componentId: c.component_id,
            formula: c.formula || null,
            value: c.value ?? null,
            priority: c.priority ?? idx,
            // ...
        })),
    });
}
```

### Range Matching for Preview
Matches the given gross value to the correct range, then fetches components and runs the calculator:

```js
const ranges = await prisma.salaryTemplateRange.findMany({ where: { templateId: tpl.id, deletedAt: null } });
const picked = ranges.find((r) => rangeMatches(r, Number(gross)));
// ... fetch components, normalize, call calculateSalary()
```

## Helper Functions

- **`mapRange(r)`** — Maps a Prisma range to gRPC shape with `has_gross_high` flag.
- **`assertFinanceEnabled(organization_id, callback)`** — Guard that returns early with error if finance is not enabled.
- **`validateNoOverlap(templateId, low, high, excludeRangeId)`** — Checks for interval overlap with existing ranges.
- **`rangeMatches(range, gross)`** — Tests whether a gross value falls within a range's bounds.
