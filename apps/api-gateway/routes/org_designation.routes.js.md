# Org Designation Routes

**Service:** Org Designation gRPC (`orgDesignationClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/designations` | Create a new designation |
| GET | `/designation/{id}` | Get designation by ID |
| GET | `/designations/all` | List all designations (no pagination) |
| GET | `/designations` | List designations with pagination, search, and sorting |
| PUT | `/designations/{id}` | Update a designation |
| DELETE | `/designations/{id}` | Delete a designation |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = createSchema.parse(body);
        const payload = {
            organization_id: parsed.organization_id,
            department_id: parsed.department_id ?? null,
            name: parsed.name,
            level: parsed.level ?? null,
            description: parsed.description ?? null,
        };
        const res = await new Promise((resolve, reject) => {
            orgDesignationClient.CreateDesignation(payload, (err, resp) => { ... });
        });
        return c.json(res, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **CreateDesignation**: `{ organization_id (ObjectId), department_id? (ObjectId), name (min2), level?, description? }` (`.strict()`)
- **ListQuery**: `{ organization_id?, department_id?, page, limit, search, sort_by, sort_order }`

## Unique Logic

- Validates ObjectId format for IDs.
- `/designations/all` calls `ListAllDesignations` (no pagination).
- `/designations` calls `ListDesignations` with pagination params.
- `page`, `limit` use `.transform(Number)` from string.
