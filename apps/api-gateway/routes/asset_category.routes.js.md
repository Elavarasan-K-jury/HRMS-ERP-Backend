# asset_category.routes.js

**Service:** Proxies to `assetCategoryClient` (gRPC asset category service)

**Export:** `registerAssetCategoryRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /asset-categories`
- **Summary:** Create a new asset category
- **Tags:** `Asset Categories`
- **Request Body:** `{ organization_id, name, code?, description?, is_active (default true) }`
- **Response 201:** `{ categories: {...}, message, success }` / 400 / 409

#### `GET /asset-categories/{id}`
- **Summary:** Get an asset category by ID
- **Tags:** `Asset Categories`
- **Params:** `id`
- **Response 200:** Category object / 404

#### `GET /asset-categories`
- **Summary:** List asset categories
- **Tags:** `Asset Categories`
- **Query:** `{ organization_id, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ categories: [...], total, page, limit, total_pages, message, success }`

#### `PUT /asset-categories/{id}`
- **Summary:** Update an asset category by ID
- **Tags:** `Asset Categories`
- **Params:** `id`
- **Request Body:** Partial of create schema
- **Response 200:** Updated category

#### `DELETE /asset-categories/{id}`
- **Summary:** Delete an asset category by ID
- **Tags:** `Asset Categories`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- Update uses `.partial()` on create schema extended with `id`
- gRPC methods: `createAssetCategory`, `getAssetCategory`, `listAssetCategories`, `updateAssetCategory`, `deleteAssetCategory`

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/asset-categories',
        tags: ['Asset Categories'],
        summary: 'Create a new asset category',
        request: {
            body: {
                content: {
                    'application/json': { schema: createAssetCategorySchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Asset Category created successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            categories: z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), description: z.string().nullable(), is_active: z.boolean(), created_at: z.string(), updated_at: z.string() }),
                            message: z.string(),
                            success: z.boolean(),
                        }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createAssetCategorySchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                assetCategoryClient.createAssetCategory(parsed, (err, res) => {
                    if (err) return reject(err);
                    resolve(res);
                });
            });
            return c.json(response, 201);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({ message: error.message }, 400);
            }
            return c.json({ message: error.message }, 500);
        }
    }
);
```
