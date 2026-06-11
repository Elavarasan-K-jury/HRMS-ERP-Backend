# Shift Policy Routes

**Service:** Shift Policy gRPC (`shiftPolicyClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/shift-policies` | Create a new shift policy |
| GET | `/shift-policies/{id}` | Fetch a shift policy by ID |
| GET | `/shift-policies` | List shift policies for an organization |
| PUT | `/shift-policies/{id}` | Update a shift policy |
| DELETE | `/shift-policies/{id}` | Soft delete a shift policy |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = createShiftPolicySchema.parse(body);
        const response = await new Promise((resolve, reject) => {
            shiftPolicyClient.CreateShiftPolicy(parsed, (err, resp) => {
                if (err) return reject(err);
                resolve(resp.policy);
            });
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **CreatePolicy**: `{ organization_id, name (min2), auto_assign?, grace_before_start?, grace_after_end?, night_shift_start?, night_shift_end?, rotational?, rotation_period?, is_active? }` (`.strict()`)
- **UpdatePolicy**: Partial create (`.strict()`)
- **PolicyResponse**: `{ id, organization_id, name, auto_assign, grace_before_start, grace_after_end, night_shift_start, night_shift_end, rotational, rotation_period, is_active, ... }`

## Unique Logic

- `.refine()` enforces `rotation_period` required when `rotational=true`.
- `night_shift_start`/`night_shift_end` validated with HH:mm regex.
- `only_active` query param converted from string to boolean.
- Handlers extract `.policy` from gRPC response.
