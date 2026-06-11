# asset_assignment.routes.js

**Service:** Proxies to `assetAssignmentClient` (gRPC asset assignment service)

**Export:** `registerAssetAssignmentRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /asset-assignments`
- **Summary:** Create a new asset assignment
- **Tags:** `Asset Assignments`
- **Request Body:** `{ organization_id, asset_id, employee_id, assigned_date, return_date?, condition_assign?, status (default "Active"), notes? }`
- **Response 201:** `{ assetAssignment: {...}, success, message }`
- **Response 400:** Bad request

#### `GET /asset-assignments/{id}`
- **Summary:** Get an asset assignment by ID
- **Tags:** `Asset Assignments`
- **Params:** `id`
- **Response 200:** Asset assignment object / 404

#### `GET /asset-assignments`
- **Summary:** List all asset assignments
- **Tags:** `Asset Assignments`
- **Query:** `{ organization_id, search?, page?, limit?, sort_by?, sort_order? }`
- **Response 200:** `{ assetAssignments: [...], total, page, limit, total_pages, message, success }`

#### `PUT /asset-assignments/{id}`
- **Summary:** Update an asset assignment
- **Tags:** `Asset Assignments`
- **Params:** `id`
- **Request Body:** Full assignment schema
- **Response 200:** Updated / 404

#### `DELETE /asset-assignments/{id}`
- **Summary:** Delete an asset assignment
- **Tags:** `Asset Assignments`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- Uses camelCase field naming (e.g., `assignedDate`, `returnDate`) in response schemas
- Uses `.safeParse()` instead of `.parse()` for update route
- All gRPC client methods use camelCase (e.g., `createAssetAssignment`, `listAssetAssignments`)

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/asset-assignments',
        tags: ['Asset Assignments'],
        summary: 'Create a new asset assignment',
        request: {
            body: {
                content: {
                    'application/json': { schema: CreateAssetAssignmentSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Asset assignment created successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            assetAssignment: z.object({
                                id: z.string(),
                                organizationId: z.string(),
                                assetId: z.string(),
                                employeeId: z.string(),
                                assignedDate: z.string(),
                                returnDate: z.string().optional(),
                                conditionAssign: z.string().optional(),
                                status: z.string(),
                                notes: z.string().optional(),
                                createdAt: z.string(),
                                updatedAt: z.string(),
                                deletedAt: z.string().optional(),
                            }),
                            success: z.boolean(),
                            message: z.string(),
                        }),
                    }
                },
            },
        },
    },
    // handler...
);
```
