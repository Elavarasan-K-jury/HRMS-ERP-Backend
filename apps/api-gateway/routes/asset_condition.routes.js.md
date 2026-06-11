# asset_condition.routes.js

**Service:** Proxies to `assetConditionClient` (gRPC asset condition service)

**Export:** `registerAssetConditionRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /asset-conditions`
- **Summary:** Create a new asset condition
- **Tags:** `Asset Conditions`
- **Request Body:** `{ organization_id, assignment_id, employee_id, acknowledged_by?, report_date?, description?, ratings?, images?, action_taken?, acknowledged_date?, status? }`
- **Response 201:** `{ condition: {...}, success, message }` / 400

#### `GET /asset-conditions/{id}`
- **Summary:** Get asset condition by ID
- **Tags:** `Asset Conditions`
- **Params:** `id`
- **Response 200:** Condition object / 400

#### `GET /asset-conditions`
- **Summary:** List all asset conditions
- **Tags:** `Asset Conditions`
- **Query:** `{ organization_id, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ conditions: [...], total, page, limit, total_pages, message, success }` / 400

#### `PUT /asset-conditions/{id}`
- **Summary:** Update an asset condition
- **Tags:** `Asset Conditions`
- **Params:** `id`
- **Request Body:** `CreateAssetConditionSchema.partial()`
- **Response 200:** Updated condition / 400

#### `DELETE /asset-conditions/{id}`
- **Summary:** Delete an asset condition
- **Tags:** `Asset Conditions`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 400

## Unique Logic

- Delete passes `id` as a scalar (not object `{ id }`) to gRPC: `assetConditionClient.deleteAssetCondition(id, ...)`
- Update uses `CreateAssetConditionSchema.partial()` for body schema
- Detailed error responses with field-level details for Zod errors

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/asset-conditions',
        tags: ['Asset Conditions'],
        summary: 'Create a new asset condition',
        request: {
            body: {
                content: {
                    'application/json': { schema: CreateAssetConditionSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Asset Condition created successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            condition: z.object({ id: z.string(), organization_id: z.string(), assignment_id: z.string(), employee_id: z.string(), acknowledged_by: z.string().optional(), /* ... */ }),
                            success: z.boolean(),
                            message: z.string(),
                        }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = CreateAssetConditionSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                assetConditionClient.createAssetCondition(parsed, (err, response) => {
                    if (err) { reject(err); } else { resolve(response); }
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
