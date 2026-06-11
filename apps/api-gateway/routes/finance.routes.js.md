# Finance Routes

**Service:** Finance gRPC (`financeClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/finance/enabled/{organizationId}` | Check if finance module is enabled |
| POST | `/finance/pf` | Enable and save PF configuration |
| POST | `/finance/esi` | Enable and save ESI configuration |
| PUT | `/finance/esi/activity` | Toggle ESI enable/disable |
| PUT | `/finance/pf/activity` | Toggle PF enable/disable |
| PUT | `/finance/ptax/activity` | Toggle PTAX enable/disable |
| POST | `/finance/ptax` | Enable and save PTAX configuration |
| GET | `/finance/details/{organizationId}` | Fetch organization finance configuration |

## Code Snippet

```js
async (c) => {
    try {
        const { organizationId } = c.req.valid('param')
        const result = await new Promise((resolve, reject) => {
            financeClient.CheckIfFinanceEnabledOrNot(
                { organization_id: organizationId },
                (err, res) => (err ? reject(err) : resolve(res))
            )
        })
        return c.json(result, 200)
    } catch (error) {
        console.error('❌ Check Finance Enabled Error:', error)
        return c.json({ message: error.message }, 500)
    }
}
```

## Request/Response Schemas

- **FinanceEnabledResponse**: `{ success, message, enabledFinance }`
- **FinanceDetails**: `{ enable_pf, enable_esi, enable_ptax, pf_formula, pf_registration_number, ... }`
- **GenericSuccess**: `{ success, message }`

## Unique Logic

- Toggle endpoints (`/activity`) accept `{ organization_id, activity: boolean }` to enable/disable each tax type independently.
- All errors return 500 with `{ message }`.
