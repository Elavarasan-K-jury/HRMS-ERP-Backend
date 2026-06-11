# Asset Assignment Service

## Purpose
Manages assignment of assets to employees, including assignment details, dates, and conditions.

## Key gRPC Methods
- **CreateAssetAssignment** - Creates a new asset assignment after validating organization/asset existence and checking for duplicates. Also creates a corresponding asset request record automatically.
```js
const created = await prisma.assetAssignments.create({
    data: mappedData,
    include: { organization: true, asset: true }
});
await prisma.assetRequest.create({
    data: { organizationId: ..., assignmentId: created.id, quantity: 1, priority: "MEDIUM", status: "PENDING", ... }
});
```
- **GetAssetAssignment** - Fetches a single assignment by ID with organization and asset relations.
- **ListAssetAssignment** - Paginated listing with search, sort, and organization filter.
- **UpdateAssetAssignment** - Updates assignment details (partial update via mapped fields).
- **DeleteAssetAssignment** - Soft-deletes an assignment.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapAssetAssignment(assetAssignment)` | Maps Prisma asset assignment to snake_case API format, serializing `conditionAssign` as JSON string |

**Server port:** `process.env.ASSET_ASSIGN_SERVICE_PORT || 5067`
