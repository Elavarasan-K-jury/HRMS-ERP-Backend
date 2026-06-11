# pdf/renderInvoiceHTML.js

**Purpose:** Loads a Handlebars template from disk at startup and exports a fast function to render invoice HTML.

## Key Exports

```js
export function renderInvoiceHTML(data)
```

Returns a rendered HTML string.

## Dependencies

| Package | Purpose |
|---|---|
| `handlebars` | Template engine |
| `fs` / `path` | File system access |

## Important Logic

### Template loaded once at startup (lines 8–11)
```js
const templateSource = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const compiledTemplate = Handlebars.compile(templateSource);
```
The Handlebars template (`templates/invoice.html`) is read and compiled into a reusable function when the module is first imported — not on every invocation.

### Render function (lines 16–18)
```js
export function renderInvoiceHTML(data) {
    return compiledTemplate(data);
}
```
Simply calls the pre-compiled template function with the provided data object, making it very fast for repeated use.
