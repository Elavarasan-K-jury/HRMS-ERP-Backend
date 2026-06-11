# Asset Models Service

## Purpose
Manages asset model definitions (brand, model name, specs) linked to asset categories and organizations.

## Key gRPC Methods
- **CreateAssetModel** - Creates an asset model with brand, model name, specs (parsed from JSON), and links to organization and category. Checks for duplicate brand+model combinations.
- **GetAssetModel** - Fetches a single model by ID with category and organization includes.
- **ListAssetModels** - Paginated listing with search (brand, model name), sorting, and organization filter.
- **UpdateAssetModel** - Partial update of model fields.
- **DeleteAssetModel** - Soft-deletes a model.

```js
// Specs parsed from JSON string
specs: data.specs ? JSON.parse(data.specs) : null,
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `mapModel(model)` | Maps model with nested `organization` and `category` objects |
| `mapCategory(category)` | Maps asset category (used in nested response) |
| `mapOrg(org)` | Maps organization with all fields including limits (max_employees, etc.) |

**Server port:** `process.env.ASSET_MOD_SERVICE_PORT || 5064`
