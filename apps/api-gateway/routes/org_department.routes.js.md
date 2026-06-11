# Org Department Routes

**Service:** Org Department gRPC (`orgDepartmentClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/departments` | Create a new department |
| GET | `/department/{id}` | Fetch department by ID |
| GET | `/departments/employee-list` | List all employees inside a department |
| GET | `/departments` | List departments with pagination, search, and sorting |
| GET | `/departments/all` | List all departments (no pagination) |
| PUT | `/departments/{id}` | Update department details |
| DELETE | `/departments/{id}` | Soft delete a department |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = createDeptSchema.parse(body);
        const payload = {
            organization_id: parsed.organization_id,
            name: parsed.name,
            code: parsed.code ?? null,
            ...
        };
        const response = await new Promise((resolve, reject) => {
            orgDepartmentClient.CreateDepartment(payload, (err, resp) => { ... });
        });
        return c.json(response, 201);
    } catch (error) {
        if (error instanceof ZodError) {
            return c.json({ error: 'Validation failed', details: [...] }, 400);
        }
        return c.json({ error: error.message }, 500);
    }
}
```

## Request/Response Schemas

- **CreateDept**: `{ organization_id (ObjectId regex), name (min 2), code?, department_head_id?, department_head_start_date?, description?, note? }` (`.strict()`)
- **UpdateDept**: Partial create schema (all optional except org).
- **EmployeeList**: `{ organization_id, department_id }` → response with `employees[]` each having `isHead` boolean.

## Unique Logic

- Validates ObjectId format (`/^[0-9a-fA-F]{24}$/`) for IDs.
- `page`, `limit` params use `.transform(parseInt)` from string.
- `departments/all` variant calls same gRPC `ListDepartments` but without pagination params.
- `/departments` (paginated) offers sorting by `name`, `code`, `created_at`, `updated_at`.
