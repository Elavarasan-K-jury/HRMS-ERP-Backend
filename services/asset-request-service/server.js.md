# Asset Request Service

## Purpose
Handles employee requests for assets, including creation, approval/rejection workflows, and listing with full nested details.

## Key gRPC Methods
- **CreateAssetRequest** - Creates an asset request with employee, category, model links. Supports optional `approved_by` relation via `connect`.
- **GetAssetRequest** - Fetches a request by ID with deeply nested assignment details, asset, category, model, and conditions.
- **ListAssetRequests** - Paginated listing with search (reason, priority, status) and sorting.
- **ApproveRejectAssetRequest** - Updates request status, approved_by, and rejection reason.
- **UpdateAssetRequest** - Full update of request fields with cleaning helpers.
- **DeleteAssetRequest** - Soft-deletes a request.

```js
// Cleaning helpers for robust input handling
const cleanId = (val) => !val || val === '' || val === 'null' ? undefined : val;
const clean = (val) => val === '' || val === undefined ? undefined : val;
const cleanDate = (val) => val && val !== '' ? new Date(val) : undefined;
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapAssetRequest(r)` | Deeply maps request with `assignment_details`, nested `employee`, `asset`, `asset_category`, `asset_model` (with specs breakdown), and condition arrays |

**Server port:** `process.env.ASSET_REQ_SERVICE_PORT || 5066`
