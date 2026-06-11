# salary-and-payroll-service/helper/salaryCalculationEngine.js

## Purpose
Core engine that orchestrates salary structure calculation — picks the matching salary range, loads template components, runs the calculator, and persists structure components with totals.

## Key Exported Functions

| Function | Description |
|---|---|
| `calculateSalaryStructure(structureId, save)` | Full calculation: loads range + template components, runs calculator, optionally saves to DB |
| `calculateSalaryStructureDryRun(templateId, grossAnnual)` | Preview calculation without a structure (no DB writes) |
| `bulkRecalculateStructures(employeeIds)` | Iterates over employees and recalculates their active structures |

## Important Logic

### Range Selection
Given a gross annual, finds the first salary range where `grossLow <= gross <= grossHigh`:

```js
function pickRange(ranges, gross) {
    const g = Number(gross);
    return ranges.find(r => {
        const low = Number(r.grossLow ?? 0);
        const high = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        return g >= low && g <= high;
    });
}
```

### Component Splitting by Type
Template components are split into three streams — earnings, employee deductions, and employer contributions — each computed separately:

```js
const earnings = templateComponents.filter(c =>
    c.kind?.toUpperCase() === "EARNING" || c.component?.type?.toUpperCase() === "EARNING");
const employeeDeductions = templateComponents.filter(c =>
    c.kind?.toUpperCase() === "EMPLOYEE" || c.component?.type?.toUpperCase() === "EMPLOYEE");
const employerContribs = templateComponents.filter(c =>
    c.kind?.toUpperCase() === "EMPLOYER" || c.component?.type?.toUpperCase() === "EMPLOYER");
```

### Finance-Gated Deductions
Deductions (PF, ESI, PTAX) are only calculated if the organization has those features enabled:

```js
const deductionResult = finance.enablePf || finance.enableEsi || finance.enablePtax
    ? calculateSalary({
        baseInput: { gross: grossComputed },
        components: normalizeTemplateComponents(employeeDeductions),
      })
    : { components: [], totals: { totalDeductions: 0 } };
```

### Persisting Structure Components
When `save = true`, all computed components (earnings + deductions + employer) are persisted and the structure's totals are updated:

```js
await prisma.structureComponent.deleteMany({ where: { structureId } });
await prisma.structureComponent.createMany({
    data: allComponents.map(c => ({
        structureId, componentId: c.componentId, value: c.value,
        monthlyAmount: c.monthlyAmount, annualAmount: c.annualAmount,
    })),
});

await prisma.salaryStructure.update({
    where: { id: structureId },
    data: { totalEarnings, totalDeductions, totalBenefits: totalEmployer, inHandMonthly, inHandAnnual: inHandMonthly * 12 },
});
```

## Helper Functions

- **`pickRange(ranges, gross)`** — Finds the matching salary range for a given gross.
- **`loadFinanceConfig(organizationId)`** — Loads PF/ESI/PTAX flags and formulas.
- **`normalizeTemplateComponents(components)`** — Maps template component records to the calculator's expected format.
