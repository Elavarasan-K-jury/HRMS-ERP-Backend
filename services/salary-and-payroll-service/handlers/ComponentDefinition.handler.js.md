# salary-and-payroll-service/handlers/ComponentDefinition.handler.js

## Purpose
gRPC handlers for CRUD on salary component definitions (e.g., Basic, HRA, PF, which define the building blocks of a salary structure).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `fetchComponentDefinitionsFunc` | Paginated list with category filter and search |
| `createComponentDefinitionFunc` | Creates a component with display-order reordering |
| `updateComponentDefinitionFunc` | Updates a component with key-uniqueness check |
| `deleteComponentDefinitionFunc` | Soft-deletes a component definition |

## Important Logic

### Display Order Reordering
When inserting a component at a specific `displayOrder`, existing components at or below that order are shifted up/down:

```js
const pushingUp = order > displayOrder; // Decreasing the order
const pushingDown = order < displayOrder; // Increasing the order

if (pushingUp) {
    existsInOrder = await prisma.componentDefinition.findMany({
        where: { displayOrder: { gte: displayOrder }, deletedAt: null, id: { not: exists.id } },
    });
    for (const i of existsInOrder) {
        await prisma.componentDefinition.update({
            data: { displayOrder: i.displayOrder + 1 },
            where: { id: i.id },
        });
    }
}
```

### Finance-Enabled Guard
All operations first check that finance is enabled for the organization:

```js
const enabledFinance = await checkFinanceEnabled(organization_id);
if (!enabledFinance) {
    return callback({ code: grpc.status.PERMISSION_DENIED, message: "Finance is not enabled" });
}
```

### Key Uniqueness
Component `key` is unique per organization, enforced on both create and update.

## Helper Functions

- **`checkFinanceEnabled(organization_id)`** — Imported from `../helper/checks.js`, validates that the org's finance module is fully configured with PF/ESI/PTAX details.
