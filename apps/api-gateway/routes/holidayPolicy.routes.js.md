# Holiday Policy Routes

**Service:** Holiday Policy gRPC (`holidayPolicyClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/holiday-policies` | Create a new holiday policy |
| PUT | `/holiday-policies/{id}` | Update an existing holiday policy |
| GET | `/holiday-policies/{id}` | Get holiday policy by ID |
| GET | `/holiday-policies` | List holiday policies for an organization |
| DELETE | `/holiday-policies/{id}` | Soft delete a holiday policy |

## Code Snippet

```js
async c => {
    try {
        const body = createPolicySchema.parse(await c.req.json());
        const response = await new Promise((resolve, reject) => {
            holidayPolicyClient.CreateHolidayPolicy(body, (err, resp) =>
                err ? reject(err) : resolve(resp)
            );
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

- **CreatePolicy**: `{ organization_id, name, region, applicable_to }`
- **UpdatePolicy**: `{ name?, region?, applicable_to?, is_active? }`
- **ListResponse**: `{ policies: [...], total_count }`

## Unique Logic

- Uses `{ openapi: app }` destructuring renaming.
- Manual Zod parsing with `parse()` instead of `c.req.valid()`.
- gRPC error code 5 (NOT_FOUND) maps to HTTP 404.
- `applicable_to` defaults to `[]`.
- `is_active_only` query param uses `.transform()` for boolean conversion.
