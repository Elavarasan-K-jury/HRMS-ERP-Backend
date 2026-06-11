# Assets Service

## Purpose
Central asset inventory management with CRUD operations, category/model linking, assignment history, and condition tracking.

## Key gRPC Methods
- **CreateAsset** - Creates an asset with serial number, asset tag, credentials, purchase/warranty dates. Validates uniqueness of serial number and organization-scoped asset tag.
```js
const existing = await prisma.assets.findFirst({
    where: {
        OR: [
            { serialNumber: data.serial_number },
            { AND: [{ organizationId: data.organization_id }, { assetTag: data.asset_tag }] }
        ],
        deletedAt: null,
    },
});
```
- **GetAsset** - Fetches an asset by ID with model and organization includes.
- **ListAssets** - Paginated listing with optional filters (organization, category, model) and search across user name, serial number, asset tag, category name, and model name.
- **UpdateAsset** - Partial update preserving existing values.
- **DeleteAsset** - Soft-deletes an asset.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapAsset(asset)` | Maps asset with nested `category`, `model`, `organization` objects, plus `assignments` and `conditions` arrays, and a `meta` block with `has_assignments` and `is_deleted` flags |

**Server port:** `process.env.ASSETS_SERVICE_PORT || 5065`
