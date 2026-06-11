# Salary Routes

**Service:** Salary gRPC (`salaryClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/salary/structure/assign` | Assign salary to employee for the first time |
| PUT | `/salary/structure/{structureId}` | Update employee salary (gross or template change) |
| PUT | `/salary/structure/{structureId}/apply-template` | Apply a new salary template to existing structure |
| POST | `/salary/structure/{structureId}/recalculate` | Re-run full salary structure calculation |
| GET | `/salary/structure/employee/{employeeId}` | Get current active salary structure for employee |
| GET | `/salary/structure/employee/{employeeId}/{structureId}` | Get specific salary structure by ID |
| GET | `/salary/revisions/employee/{employeeId}` | Get complete salary revision history |
| PUT | `/salary/structure/{structureId}/component/{componentId}/override` | Override a specific salary component |
| POST | `/salary/structure/bulk-recalculate` | Recalculate structures for multiple employees |
| POST | `/salary/structure/preview` | Preview salary calculation (dry run, no DB write) |

## Code Snippet

```js
async (c) => {
    try {
        const structureId = c.req.param("structureId");
        const body = await c.req.json();
        const payload = {
            structureId,
            newGrossAnnual: body.newGrossAnnual,
            newTemplateId: body.newTemplateId ?? "",
            ...
            componentOverrides: body.componentOverrides ?? [],
        };
        const response = await new Promise((resolve, reject) => {
            salaryClient.UpdateSalary(payload, (err, resp) => { ... });
        });
        return c.json(response, 200);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **AssignSalary**: `{ employeeId, templateId, grossAnnual, effectiveFrom?, status?, isCurrentActive?, deductFromInHand? }`
- **UpdateSalary**: `{ newGrossAnnual, newTemplateId?, revisionType?, reason?, effectiveDate?, approvedBy?, approvalDate?, ... componentOverrides? }`
- **BulkRecalculate**: `{ employeeIds (1-100) }` → `{ results: [{ employeeId, structureId, success, error }], successCount, errorCount }`
- **ComponentOverride**: `{ value?, formula?, overrideNote? }`

## Unique Logic

- Structure endpoints use camelCase param names (`structureId`, `employeeId`) directly in gRPC (no snake_case conversion).
- Update supports detailed revision tracking with `revisionType`, `reason`, `effectiveDate`, `approvedBy`, `approvalDate`.
- Component overrides allow per-component custom values or formulas.
- Bulk recalculate validates max 100 employees client-side.
- Preview (`/preview`) is a dry-run with no DB writes.
- Manual validation for empty `employeeIds` array (before Zod check).
