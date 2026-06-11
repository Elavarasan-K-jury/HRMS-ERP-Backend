# Asset Condition Service

## Purpose
Tracks and manages the physical condition of assigned assets, including reports, ratings, images, and acknowledgments.

## Key gRPC Methods
- **CreateAssetCondition** - Creates a condition report for an asset assignment with description, ratings, images, and acknowledgment details.
- **GetAssetCondition** - Fetches a single condition record by ID.
- **ListAssetConditions** - Paginated listing with search (description), sorting, and organization filter.
- **UpdateAssetCondition** - Partial update preserving existing values if new ones aren't provided.
```js
const mappedData = {
    organizationId: call.request.organization_id ?? existing.organizationId,
    assignmentId: call.request.assignment_id ?? existing.assignmentId,
    ...
    reportDate: call.request.report_date ? new Date(call.request.report_date) : existing.reportDate,
    ...
};
```
- **DeleteAssetCondition** - Soft-deletes a condition record.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapAssetCondition(assetCondition)` | Maps condition record to API format, serializing `images` and including `acknowledgedBy` relation |

**Server port:** `process.env.ASSET_CON_SERVICE_PORT || 5068`
