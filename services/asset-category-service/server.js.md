# Asset Category Service

## Purpose
Provides CRUD operations for asset categories (e.g., Laptop, Monitor, Printer) within an organization.

## Key gRPC Methods
- **CreateAssetCategory** - Creates a new category after checking for duplicates by name within the organization.
- **GetAssetCategory** - Fetches a single category by ID.
- **ListAssetCategories** - Paginated listing with search (name, code, description), sorting (created_at, updated_at, name, code), and organization filter. Supports optional pagination.
```js
// Search across multiple fields
where.OR = [
    { name: { contains: search, mode: "insensitive" } },
    { code: { contains: search, mode: "insensitive" } },
    { description: { contains: search, mode: "insensitive" } },
];
```
- **UpdateAssetCategory** - Updates category fields with organization validation.
- **DeleteAssetCategory** - Soft-deletes a category.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapCategory(category)` | Maps Prisma category object to snake_case gRPC response |

**Server port:** `process.env.ASSET_CAT_SERVICE_PORT || 5063`
