# assets.routes.js

**Service:** Proxies to `assetClient` (gRPC asset service)

**Export:** `registerAssetRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /assets`
- **Summary:** Create a new asset
- **Tags:** `Assets`
- **Request Body:** `{ organization_id, category_id, model_id, serial_number, asset_tag, user_name, password, purchase_date, warranty_expire, status, location }`
- **Response 201:** `{ assets: {...}, message, success }` / 400

#### `GET /assets/{id}`
- **Summary:** Get an asset by ID
- **Tags:** `Assets`
- **Params:** `id`
- **Response 200:** Asset object / 404 / 500

#### `GET /assets`
- **Summary:** List assets with filters, pagination & sorting
- **Tags:** `Assets`
- **Query:** `{ organization_id, category_id?, model_id?, status?, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ assets: [...], total, page, limit, total_pages, success, message }` — includes nested `category`, `model`, `organization`, `lifecycle`, `meta` objects
- **Response 400/500**

#### `PUT /assets/{id}`
- **Summary:** Update an asset
- **Tags:** `Assets`
- **Params:** `id`
- **Request Body:** Partial of create schema
- **Response 200:** Updated / 404/500

#### `DELETE /assets/{id}`
- **Summary:** Delete an asset
- **Tags:** `Assets`
- **Params:** `id`
- **Response 200:** `{ message, success? }` / 404/500

## Unique Logic

- List response includes nested objects: `category`, `model`, `organization`, `lifecycle`, `meta`
- Update uses date parsing with `new Date().toISOString()` for date fields
- The `sort_by` enum allows: `created_at`, `updated_at`, `serial_number`, `asset_tag`
- gRPC methods use PascalCase: `GetAsset`, `ListAssets`, `UpdateAsset`, `DeleteAsset`

## Code Snippet

```js
app.openapi(
    {
        method: "get",
        path: "/assets",
        tags: ["Assets"],
        summary: "List assets with filters, pagination & sorting",
        request: {
            query: z.object({
                organization_id: z.string({ required_error: "Organization ID is required" }).min(1),
                category_id: z.string().optional(),
                model_id: z.string().optional(),
                status: z.string().optional(),
                search: z.string().optional(),
                page: z.coerce.number().int().min(1).default(1),
                limit: z.coerce.number().int().min(1).max(100).default(10),
                sort_by: z.enum(["created_at", "updated_at", "serial_number", "asset_tag"]).default("created_at"),
                sort_order: z.enum(["asc", "desc"]).default("desc"),
            }),
        },
        responses: { 200: { description: "Assets retrieved successfully" } },
    },
    async (c) => {
        const query = c.req.valid("query");
        const response = await new Promise((resolve, reject) => {
            assetClient.ListAssets({ ... }, (err, resp) => {
                if (err) reject(err);
                else resolve(resp);
            });
        });
        return c.json(response);
    }
);
```
