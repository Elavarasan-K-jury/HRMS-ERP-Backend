# Report Routes

**Service:** Report gRPC (`reportClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/reports/employee/{employeeId}` | Generate employee report from template |

## Code Snippet

```js
async (c) => {
    const { employeeId } = c.req.valid('param');
    const result = await new Promise((resolve, reject) => {
        reportClient.GenerateEmployeeInsightTemplateReport(
            { employee_id: employeeId },
            (err, res) => { if (err) return reject(err); resolve(res); }
        );
    });
    const accept = c.req.header('accept') || '';
    if (accept.includes('text/html')) {
        return c.html(result.html, 200);
    }
    return c.json({ employee_id: employeeId, html: result.html }, 200);
}
```

## Request/Response Schemas

- **Params**: `{ employeeId }`
- **Response**: `{ employee_id, template_id, html }` or raw HTML via `c.html()`.

## Unique Logic

- Supports content negotiation: if `Accept` header includes `text/html`, returns raw HTML; otherwise returns JSON with HTML string.
- Simple single-route file with no pagination or filtering.
