# approval.routes.js

**Service:** Proxies to `approvalFlowClient` and `approvalInstanceClient` (gRPC approval service)

**Export:** `registerApprovalRoutes({ openapi })` — registers routes on an OpenAPIHono app

## Routes

### Approval Flow

#### `POST /approval/flows`
- **Summary:** Create approval flow
- **Tags:** `Approval-Flow`
- **Request Body:** `{ organization_id (ObjectId), entity_type: "LEAVE"|"REGULARISATION"|"WORKDAY", levels: [...] }`
- **Response 201:** Created / 400: Validation error

#### `GET /approval/flows/{id}`
- **Summary:** Get approval flow by id
- **Tags:** `Approval-Flow`
- **Params:** `id` (ObjectId)
- **Response 200:** Flow / 404: Not found

#### `GET /approval/flows`
- **Summary:** List flows
- **Tags:** `Approval-Flow`
- **Query:** `{ organization_id? (ObjectId), entity_type? }`
- **Response 200:** List of flows

#### `PUT /approval/flows/{id}`
- **Summary:** Update approval flow
- **Tags:** `Approval-Flow`
- **Params:** `id` (ObjectId)
- **Request Body:** `{ levels: [...] }`
- **Response 200:** Updated / 400/404

#### `DELETE /approval/flows/{id}`
- **Summary:** Soft delete approval flow
- **Tags:** `Approval-Flow`
- **Params:** `id` (ObjectId)
- **Response 200:** Deleted / 404

### Approval Instance

#### `POST /approval/instances/start`
- **Summary:** Start approval for an entity
- **Tags:** `Approval-Instance`
- **Request Body:** `{ organization_id, entity_id, entity_type, employee_id }`
- **Response 201:** Started / 400/404

#### `GET /approval/instances/{id}`
- **Summary:** Get approval instance by id
- **Tags:** `Approval-Instance`
- **Params:** `id` (ObjectId)
- **Response 200:** Instance / 404

#### `POST /approval/instances/{id}/approve`
- **Summary:** Approve an instance
- **Tags:** `Approval-Instance`
- **Params:** `id` (ObjectId)
- **Request Body:** `{ approver_id, remarks? }`
- **Response 200:** Approved / 400/404

#### `POST /approval/instances/{id}/reject`
- **Summary:** Reject an instance
- **Tags:** `Approval-Instance`
- **Params:** `id` (ObjectId)
- **Request Body:** `{ approver_id, remarks? }`
- **Response 200:** Rejected / 400/404

#### `GET /approval/instances/pending`
- **Summary:** List pending approvals
- **Tags:** `Approval-Instance`
- **Query:** `{ organization_id (ObjectId), approver_id? (ObjectId), page?, limit? }`
- **Response 200:** Paginated list

## Unique Logic

- Uses `ObjectId` regex validation (`/^[0-9a-fA-F]{24}$/`)
- Multi-level flow schema with `flowLevelSchema`
- Uses `grpc.status.NOT_FOUND` for 404 mapping
- Level schema includes `auto_approve_days`, `escalation_role`, `approvers` array
- Entity types: `LEAVE`, `REGULARISATION`, `WORKDAY`

## Code Snippet

```js
openapi(
    {
        method: 'post',
        path: '/approval/flows',
        tags: ['Approval-Flow'],
        summary: 'Create approval flow',
        request: {
            body: {
                content: {
                    'application/json': { schema: createFlowSchema },
                },
            },
        },
        responses: {
            201: { description: 'Created' },
            400: { description: 'Validation error' },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createFlowSchema.parse(body);
            const res = await new Promise((resolve, reject) => {
                approvalFlowClient.CreateFlow(parsed, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json(res, 201);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json(
                    {
                        error: 'Validation failed',
                        details: error.errors.map((e) => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    },
                    400
                );
            }
            return c.json({ error: error.message }, 500);
        }
    }
);
```
