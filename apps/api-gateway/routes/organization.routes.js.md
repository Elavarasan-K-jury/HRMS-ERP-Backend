# Organization Routes

**Service:** Organization gRPC (`orgClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/organizations` | Create a new organization |
| GET | `/organizations/{id}` | Fetch organization by ID |
| GET | `/organizations` | List organizations with pagination, search, and sorting |
| PUT | `/organizations/{id}` | Update an existing organization |
| DELETE | `/organizations/{id}` | Soft delete an organization |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = createOrgSchema.parse(body);
        const payload = { ...parsed, address: JSON.stringify(parsed.address) };
        const response = await new Promise((resolve, reject) => {
            orgClient.CreateOrganization(payload, (err, resp) => { ... });
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **CreateOrg**: `{ name (min2), domain (url), gst_number?, email?, contact_person_name?, contact_person_number?, note?, industry?, size?, address? }` plus plan limits.
- **UpdateOrg**: Partial of create (address accepts string or object).
- **OrgPlanSchema**: `{ max_employees, max_storage_in_gb, max_api_rate_per_minute, max_payroll_runs_per_month, max_leave_policies, max_admin_accounts }`

## Unique Logic

- `address` is serialized to JSON string before sending to gRPC (both create and update).
- `orgPlanSchema` describes plan limits with `.describe('Default: 20')` annotations.
- Extract `response.organization` from gRPC response in create and update handlers.
- Uses `z.coerce.number()` for list query params.
