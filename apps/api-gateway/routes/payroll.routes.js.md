# Payroll Routes

**Service:** Payroll gRPC (`payrollClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/system-payroll` | Get data calculated by system |
| POST | `/calculate-payroll` | Calculate payroll for employees |

## Code Snippet

```js
async (c) => {
    try {
        const query = c.req.valid('query');
        const response = await new Promise((resolve, reject) => {
            payrollClient.GetSystemPayroll(
                { year: query.year, month: query.month, organization_id: query.organisation_id },
                (err, resp) => { if (err) return reject(err); resolve(resp); }
            );
        });
        return c.json(response, 200);
    } catch (error) {
        const statusCode = error.code === 5 ? 404 : 500;
        return c.json({ success: false, error: error.message }, statusCode);
    }
}
```

## Request/Response Schemas

- **SystemPayrollQuery**: `{ year, month, organisation_id }` (note: British spelling in query)
- **CalculatePayroll**: `{ organization_id, year, month, employee_id? }`
- **CalculateResponse**: Detailed breakdown with attendance, leave, expenses, salary components, deductions.

## Unique Logic

- `system-payroll` uses British spelling `organisation_id` in query but sends `organization_id` to gRPC.
- gRPC error code 5 (NOT_FOUND) maps to HTTP 404.
- Calculate response has extensive nested schema covering attendance, leave, expenses, and salary component breakdowns.
