# Holidays Routes

**Service:** Holiday gRPC (`holidayClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/holidays` | Create a new holiday |
| PUT | `/holidays/{id}` | Update an existing holiday |
| GET | `/holidays/{id}` | Fetch holiday by ID |
| GET | `/holidays` | List all holidays for an organization (with filters) |
| GET | `/holidays/calendar/view` | Get holiday calendar for a month |
| DELETE | `/holidays/{id}` | Delete a holiday |

## Code Snippet

```js
async c => {
    try {
        const id = c.req.param('id');
        const body = updateHolidaySchema.parse(await c.req.json());
        const payload = { holiday_id: id, ...body };
        const response = await new Promise((resolve, reject) => {
            holidayClient.UpdateHoliday(payload, (err, resp) =>
                err ? reject(err) : resolve(resp)
            );
        });
        return c.json(response, 200);
    } catch (error) {
        if (error instanceof ZodError) { ... }
        return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
    }
}
```

## Request/Response Schemas

- **HolidayType**: `enum('PUBLIC', 'RESTRICTED', 'OPTIONAL', 'WEEK_OFF', 'COMPANY_EVENT')`
- **CreateHoliday**: `{ organization_id, policy_id?, date, name, region?, type? }`
- **ListResponse**: `{ holidays: [...], total_count }`
- **CalendarQuery**: `{ organization_id, month (YYYY-MM), policy_id?, region? }`

## Unique Logic

- Uses `{ openapi: app }` destructuring renaming.
- Manual Zod parsing with `parse()`.
- gRPC error code 5 (NOT_FOUND) mapped to 404.
- Calendar view expecting month in `YYYY-MM` format via regex.
