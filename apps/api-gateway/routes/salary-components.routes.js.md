# Salary Components Routes

**Service:** Component Definition gRPC (`componentClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/salary/components` | Fetch all salary component definitions |
| POST | `/salary/components` | Create a new salary component definition |
| PUT | `/salary/components/{component_id}` | Update an existing salary component definition |
| DELETE | `/salary/components/{component_id}` | Delete an existing salary component definition |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const payload = { organization_id: body.organization_id, key: body.key, name: body.name, ... };
        const response = await new Promise((resolve, reject) => {
            componentClient.createComponentDefinition(payload, (err, resp) => { ... });
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **Create**: `{ organization_id, key, name, type (earning|deduction|reimbursement|benefit|tax), category, defaultFormula?, description?, isTaxable?, isVariable?, isStatutory?, includeInCTC?, includeInGross?, displayOrder?, isActive? }`
- **ListQuery**: `{ organization_id, page?, limit?, search?, category?, sort_by?, sort_order? }`

## Unique Logic

- `type` is enum with 5 values; `category` is enum with 4 values.
- Client uses both `fetchComponentDefinitions` (GET) and `createComponentDefinition`/`updateComponentDefinition`/`deleteComponentDefinition` (POST/PUT/DELETE — note camelCase vs PascalCase inconsistency).
- Component definitions are reusable building blocks for salary range components.
