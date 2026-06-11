# asset_request.routes.js

**Service:** Proxies to `assetRequestClient` (gRPC asset request service)

**Export:** `registerAssetRequestRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /asset-requests`
- **Summary:** Create a new asset request
- **Tags:** `Asset Requests`
- **Request Body:** `{ organization_id, category_id, model_id, employee_id, reason, quantity?, priority?, status?, approved_by?, approved_at?, rejection_reason? }`
- **Response 201:** `{ request: {...}, success, message }` / 400

#### `GET /asset-requests/{id}`
- **Summary:** Get an asset request by ID
- **Tags:** `Asset Requests`
- **Params:** `id`
- **Response 200:** Request object / 404

#### `GET /asset-requests`
- **Summary:** List all asset requests
- **Tags:** `Asset Requests`
- **Query:** `{ organization_id, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ requests: [...], total, page, limit, total_pages, success, message }`
- **Note:** Returns 404 if `response.requests` is empty or falsy

#### `PUT /asset-requests/{id}`
- **Summary:** Update asset request
- **Tags:** `Asset Requests`
- **Params:** `id`
- **Request Body:** Full create schema
- **Response 200:** Updated request / 400/404/500

#### `PUT /asset-requests/{id}/status`
- **Summary:** Update asset request status (approve/reject)
- **Tags:** `Asset Requests`
- **Params:** `id`
- **Request Body:** `{ approved_by?, status, approved_at?, rejection_reason? }`
- **Response 200:** `{ success, message }` / 400/500

#### `DELETE /asset-requests/{id}`
- **Summary:** Delete asset request
- **Tags:** `Asset Requests`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 400/404/500

## Unique Logic

- Approve/reject via `ApproveRejectAssetRequest` gRPC method at `PUT /asset-requests/{id}/status`
- List returns 404 when `response.requests` is empty or falsy
- Update spreads `{ id, ...body }` without Zod parsing the body

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/asset-requests',
        tags: ['Asset Requests'],
        summary: 'Create a new asset request',
        request: {
            body: {
                content: {
                    'application/json': { schema: CreateAssetRequestSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Asset Request created successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            request: z.object({ id: z.string(), organization_id: z.string(), category_id: z.string(), model_id: z.string(), employee_id: z.string(), /* ... */ }),
                            success: z.boolean(),
                            message: z.string(),
                        })
                    }
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = CreateAssetRequestSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                assetRequestClient.createAssetRequest(parsed, (err, response) => {
                    if (err) { reject(err); } else { resolve(response); }
                });
            });
            return c.json(response);
        } catch (err) {
            if (err instanceof ZodError) { return c.json({ message: err.message }, 400); }
            return c.json({ message: err.message }, 500);
        }
    }
);
```
