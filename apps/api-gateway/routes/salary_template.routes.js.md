# Salary Template Routes

**Service:** Salary Template gRPC (`salaryTemplateClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/salary/templates` | List salary templates (metadata only) |
| GET | `/salary/templates/{template_id}` | Get salary template metadata |
| POST | `/salary/templates` | Create or update salary template (metadata only) |
| DELETE | `/salary/templates/{template_id}` | Delete salary template |

## Code Snippet

```js
async (c) => {
    try {
        const q = c.req.valid('query')
        const response = await new Promise((resolve, reject) => {
            salaryTemplateClient.ListSalaryTemplates(
                { organization_id: q.organization_id, page: q.page, per_page: q.limit ?? null, ... },
                (err, resp) => (err ? reject(err) : resolve(resp))
            )
        })
        return c.json(response)
    } catch (e) {
        return c.json({ error: e.message }, 500)
    }
}
```

## Request/Response Schemas

- **ListQuery**: `{ organization_id, page, limit?, search?, sort_by?, sort_order? }`
- **Create/Update**: `{ template_id?, organization_id, name, description?, departments?, designations?, isDefault?, isActive? }`

## Unique Logic

- Upsert pattern: POST creates or updates depending on whether `template_id` is provided.
- Departments and designations are arrays of IDs the template applies to.
- Template is metadata-only; actual salary components are defined at range level.
