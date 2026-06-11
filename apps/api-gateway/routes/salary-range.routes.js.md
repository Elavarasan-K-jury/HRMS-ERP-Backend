# Salary Range Routes

**Service:** Salary Range gRPC (`SalaryRangeClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/salary/templates/{template_id}/ranges` | Create a salary range for a template |
| PUT | `/salary/ranges/{range_id}` | Update salary range |
| DELETE | `/salary/ranges/{range_id}` | Delete salary range |
| GET | `/salary/templates/{template_id}/ranges` | List salary ranges for template |
| POST | `/salary/ranges/{range_id}/components` | Save components for a salary range |
| GET | `/salary/ranges/{range_id}/components` | Get components for a salary range |

## Code Snippet

```js
async (c) => {
    try {
        const { template_id } = c.req.valid("param");
        const body = await c.req.json();
        const response = await new Promise((resolve, reject) => {
            SalaryRangeClient.CreateRange(
                { organization_id: body.organization_id, template_id, gross_low: body.gross_low, ... },
                (err, resp) => (err ? reject(err) : resolve(resp))
            );
        });
        return c.json(response);
    } catch (e) {
        return c.json({ error: e.message }, 500);
    }
}
```

## Request/Response Schemas

- **CreateRange**: `{ organization_id, gross_low, gross_high?, has_gross_high?, label? }`
- **RangeComponent**: `{ component_id, kind?, formula?, value?, priority?, min_value?, max_value?, condition? }`
- **SaveComponents**: `{ organization_id, template_id, components: [...] }`

## Unique Logic

- Ranges are nested under templates (belong to a salary template).
- Components can be saved as a full replace operation (POST).
- `has_gross_high` flag determines if range has an upper bound.
- Component values support `min_value`, `max_value`, `condition`, and `priority`.
