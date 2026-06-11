# Hierarchy Routes

**Service:** Organization gRPC (`orgClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/organizations/{organization_id}/hierarchy` | Get organization-wide designation hierarchy |
| GET | `/organizations/{organization_id}/departments/{department_id}/hierarchy` | Get reporting hierarchy for a department |

## Code Snippet

```js
async (c) => {
    try {
        const { organization_id } = c.req.valid('param');
        const response = await new Promise((resolve, reject) => {
            orgClient.OrganizationHierarchy(
                { organization_id },
                (err, resp) => { if (err) return reject(err); resolve(resp); },
            );
        });
        return c.json(response, 200);
    } catch (error) {
        console.error('OrganizationHierarchy error:', error);
        return c.json({ error: error.message || 'Internal error' }, 500);
    }
}
```

## Request/Response Schemas

- **OrgHierarchyResponse**: `{ organization_id, levels: [{ level, label, designation_count, employee_count, designations: [...], employees: [...] }] }`
- **DeptHierarchyResponse**: `{ organization_id, department_id, hierarchy: { id, full_name, ..., reportees: [...] } }`

## Unique Logic

- Organization hierarchy groups employees by designation levels (`entry_level` → `board_level`).
- Department hierarchy returns a recursive tree with reportees; OpenAPI docs keep it shallow using `z.array(z.any())`.
