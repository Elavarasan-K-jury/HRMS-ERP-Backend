# Leave Type Routes

**Service:** Leave Type gRPC (`leaveTypeClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/leave-types` | Create a new leave type |
| PUT | `/leave-types/{id}` | Update an existing leave type |
| GET | `/leave-types/{id}` | Get leave type details |
| GET | `/leave-types` | List all leave types |
| DELETE | `/leave-types/{id}` | Soft delete a leave type |

## Code Snippet

```js
async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const response = await new Promise((resolve, reject) => {
            leaveTypeClient.UpdateLeaveType({ id, data: body }, (err, resp) =>
                err ? reject(err) : resolve(resp)
            );
        });
        return c.json(response, 200);
    } catch (error) {
        const code = error.code === 5 ? 404 : 500;
        return c.json({ error: error.message }, code);
    }
}
```

## Request/Response Schemas

- **LeaveType** (full shape): `{ id, organization_id, name, code, paid, max_per_year, allow_half_day, carry_forward, encashment_allowed, gender_restriction, probation_allowed, max_consecutive_days, sandwich_rule, accrual_enabled, ... }`
- **LeaveTypeResponse**: `{ leave_type?, success?, message? }`

## Unique Logic

- Update uses `z.any()` for body schema (relies on proto validation).
- Update wraps body as `{ id, data: body }` for gRPC.
- gRPC error code 5 (NOT_FOUND) mapped to 404.
- Create schema has many `.default()` values for optional leave configuration fields.
