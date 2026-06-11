# Invoices Routes

**Service:** Invoice gRPC (`invoiceClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/invoices` | List invoices (optionally filtered by organization) |
| GET | `/invoices/{id}` | Get invoice details by ID |
| POST | `/invoices/{id}/pay` | Mark invoice as paid |
| GET | `/invoices/{id}/download` | Download invoice PDF |
| POST | `/invoices/{id}/regenerate-payment-link` | Regenerate invoice payment link |

## Code Snippet

```js
async (c) => {
    try {
        const { id } = c.req.param();
        const { organization_id } = c.req.query();
        const response = await new Promise((resolve, reject) => {
            invoiceClient.GetInvoice({ id, organization_id }, (err, resp) => {
                if (err) return reject(err);
                resolve(resp);
            });
        });
        return c.json(response, 200);
    } catch (error) {
        return c.json({ error: error.message }, 500);
    }
}
```

## Request/Response Schemas

- **ListQuery**: `{ page?, limit?, search?, sort_by?, sort_order? }` merged with `{ organization_id? }`
- **MarkPaidSchema**: `{ payment_ref?, payment_provider? }` (`.strict()`)

## Unique Logic

- Download endpoint returns binary PDF: reads `response.data` as Buffer, sets `Content-Type` and `Content-Disposition` headers, returns via `c.body(buffer)`.
- `sort_order` converted from `"asc"`/`"desc"` to `"ASC"`/`"DESC"` for gRPC.
- `z.coerce.number()` used for page/limit query params.
