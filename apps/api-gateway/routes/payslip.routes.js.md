# Payslip Routes

**Service:** Payslip gRPC (`payslipClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| GET | `/payslip-templates` | List payslip templates or read single by path |
| POST | `/payslip-templates/save` | Save customized payslip template with dynamic variables |
| POST | `/payslip-templates/render` | Render saved payslip template using organization dynamic data |

## Code Snippet

```js
async (c) => {
    try {
        const query = c.req.valid('query');
        const response = await new Promise((resolve, reject) => {
            payslipClient.GetEjsTemplate({ template_path: query.template_path || '' }, (err, resp) => { ... });
        });
        return c.json(response, 200);
    } catch (error) {
        if (error instanceof ZodError) { ... }
        return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
    }
}
```

## Request/Response Schemas

- **SaveTemplate**: `{ organization_id, name, template_path?, ejs_content, variables? }`
- **Variables**: `[{ name, key, value, type, is_dynamic? }]`
- **RenderTemplate**: `{ organization_id }`

## Unique Logic

- Template management using EJS (Embedded JavaScript templating).
- GET endpoint can return either single template (when `template_path` provided) or list (when empty).
- gRPC error code 5 (NOT_FOUND) maps to HTTP 404.
- Templates support dynamic variables with types, defaults, and override flags.
