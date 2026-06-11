# Shift Assignment Routes

**Service:** Shift Assignment gRPC (`shiftAssignmentClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/shift-assignments` | Assign a shift to an employee (with validity period) |
| GET | `/shift-assignments/{id}` | Get a shift assignment by ID |
| GET | `/shift-assignments` | List shift assignments (by employee, shift, active-only) |
| PUT | `/shift-assignments/{id}` | Update an existing shift assignment (valid_from/valid_to) |
| DELETE | `/shift-assignments/{id}` | Soft delete a shift assignment |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = assignShiftSchema.parse(body);
        const assignment = await new Promise((resolve, reject) => {
            shiftAssignmentClient.AssignShift(parsed, (err, resp) => {
                if (err) return reject(err);
                resolve(resp.assignment);
            });
        });
        return c.json(assignment, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **AssignShift**: `{ employee_id, shift_id, valid_from, valid_to? }` (`.strict()`)
- **AssignmentResponse**: `{ id, employee_id, shift_id, valid_from, valid_to?, created_at?, updated_at?, deleted_at? }`
- **ListQuery**: `{ employee_id?, shift_id?, active_only? }`

## Unique Logic

- Most handlers extract `.assignment` from gRPC response before returning.
- `active_only` uses `.transform(v => v === 'true')` for boolean conversion.
- Update only allows modifying `valid_from` and `valid_to` dates.
