# salary-and-payroll-service/handlers/SalaryAssignment.handler.js

## Purpose
gRPC handlers for assigning, updating, recalculating, and previewing employee salary structures against templates.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `assignSalaryToEmployeeFunc` | First-time salary assignment with revision logging |
| `updateEmployeeSalaryFunc` | Updates gross, template, and component overrides |
| `applyTemplateToStructureFunc` | Switches a salary structure to a new template |
| `recalculateStructureFunc` | Re-runs the salary calculation engine on a structure |
| `previewTemplateCalculationFunc` | Dry-run preview of template + gross without persisting |
| `bulkRecalculateFunc` | Batch recalculate for multiple employees |
| `getCurrentStructureForEmployeeFunc` | Fetches the active salary structure with computed values |
| `getStructureByForEmployeeFunc` | Fetches a specific structure by ID for an employee |
| `getSalaryRevisionHistoryFunc` | Returns revision history records for an employee |
| `overrideComponentFunc` | Manually overrides a component value/formula on a structure |

## Important Logic

### Initial Assignment with Revision Detection
When assigning a salary, if a previous active structure exists, it is marked `SUPERSEDED` and the revision type is automatically detected (INITIAL, PROMOTION, DEMOTION, REVISION):

```js
previous = await prisma.salaryRevision.findFirst({
    where: { employeeId }, orderBy: { effectiveDate: "desc" },
});

await prisma.salaryStructure.updateMany({
    where: { employeeId, isCurrentActive: true },
    data: { isCurrentActive: false, status: "SUPERSEDED", effectiveTo: effectiveDate },
});

let revisionType = "INITIAL_ASSIGNMENT";
if (previous) {
    if (previous.newGross < grossAnnual) revisionType = "PROMOTION";
    else if (previous.newGross > grossAnnual) revisionType = "DEMOTION";
    else revisionType = "REVISION";
}

await prisma.salaryRevision.create({
    data: { revisionType, previousGross: Number(previous?.grossAnnual || 0), newGross: Number(computed.grossAnnual), ... },
});
```

### Component Override
Allows overriding a specific component's value or formula on a per-structure basis:

```js
for (const o of componentOverrides) {
    await prisma.structureComponent.updateMany({
        where: { structureId, componentId: o.componentId, deletedAt: null },
        data: {
            ...(o.value !== undefined && { value: Number(o.value) }),
            ...(o.formula !== undefined && { formula: o.formula }),
            isOverridden: true,
            overrideNote: o.overrideNote || "Manual override",
        },
    });
}
```

### Gross-Range Validation
Before assignment or template switch, the handler validates that the gross annual falls within one of the template's defined salary ranges:

```js
function matchesAnyRange(ranges, gross) {
    return ranges.some(r => {
        const low = Number(r.grossLow ?? 0);
        const high = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        return gross >= low && gross <= high;
    });
}
```

## Helper Functions

- **`assertFinanceEnabledByEmployee(employeeId, callback)`** — Resolves the employee's org and checks that finance is configured.
- **`matchesAnyRange(ranges, gross)`** — Returns `true` if the gross falls within any range.
