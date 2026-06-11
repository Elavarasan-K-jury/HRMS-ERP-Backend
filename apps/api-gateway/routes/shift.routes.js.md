# Shift Routes

**Service:** Shift gRPC (`shiftClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/shifts` | Create a new shift |
| GET | `/shifts/{id}` | Fetch a shift by ID |
| GET | `/shifts` | List all shifts of an organization |
| PUT | `/shifts/{id}` | Update a shift |
| DELETE | `/shifts/{id}` | Soft delete a shift |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = createShiftSchema.parse(body);
        const response = await new Promise((resolve, reject) => {
            shiftClient.CreateShift(parsed, (err, resp) => {
                if (err) return reject(err);
                resolve(resp.shift);
            });
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **CreateShift**: `{ organization_id, name (min2), start_time (ISO datetime), end_time (ISO datetime), break_minutes?, applicable_days?, weekly_off? }` (`.strict()`)
- **UpdateShift**: Partial of create (no `.strict()`)
- **DayFlags**: `{ monday?, tuesday?, wednesday?, thursday?, friday?, saturday?, sunday? }`
- **WeeklyOff**: `enum(monday|tuesday|...|sunday)[]`

## Unique Logic

- `start_time` and `end_time` validated as ISO datetime strings via `.datetime()`.
- `weekly_off` is an array of day name enums.
- Create and update handlers extract `.shift` from gRPC response.
- Create uses `.strict()` to reject unknown fields; update does not.
