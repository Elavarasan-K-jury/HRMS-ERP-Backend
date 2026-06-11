# asset_model.routes.js

**Service:** Proxies to `assetModelClient` (gRPC asset model service)

**Export:** `registerAssetModelRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /asset-models`
- **Summary:** Create a new asset model
- **Tags:** `Asset Models`
- **Request Body:** `{ organization_id, category_id, brand, model_name, code?, description?, specs?, is_active (default true) }`
- **Response 201:** `{ model: {...}, message, success }` / 400 / 409

#### `GET /asset-models/{id}`
- **Summary:** Get an asset model by ID
- **Tags:** `Asset Models`
- **Params:** `id`
- **Response 200:** Model object / 404 / 500

#### `GET /asset-models`
- **Summary:** List all asset models
- **Tags:** `Asset Models`
- **Query:** `{ organization_id, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ models: [...], total, page, limit, total_pages, message, success }` / 500

#### `PUT /asset-models/{id}`
- **Summary:** Update an asset model
- **Tags:** `Asset Models`
- **Params:** `id`
- **Request Body:** `CreateAssetModelSchema.partial()`
- **Response 200:** Updated model / 404 / 500

#### `DELETE /asset-models/{id}`
- **Summary:** Delete an asset model
- **Tags:** `Asset Models`
- **Params:** `id`
- **Response 200:** `{ message, success? }` / 404 / 500

## Unique Logic

- Checks for `!response.model` to return 404 on GET by ID
- Uses `CreateAssetModelSchema.partial()` for update body
- Delete response has optional `success` boolean

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/asset-models',
        tags: ['Asset Models'],
        summary: 'Create a new asset model',
        request: {
            body: {
                content: {
                    'application/json': { schema: CreateAssetModelSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Asset Model created successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            model: z.object({ id: z.string(), organization_id: z.string(), category_id: z.string(), brand: z.string(), model_name: z.string(), code: z.string(), description: z.string(), specs: z.string(), is_active: z.boolean(), created_at: z.string(), updated_at: z.string(), deleted_at: z.string() }),
                            message: z.string(),
                            success: z.boolean(),
                        }),
                    }
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = CreateAssetModelSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                assetModelClient.createAssetModel(parsed, (error, response) => {
                    if (error) { reject(error); } else { resolve(response); }
                });
            });
            return c.json(response);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({ message: error.message }, 400);
            } else {
                return c.json({ message: error.message }, 500);
            }
        }
    }
);
```
