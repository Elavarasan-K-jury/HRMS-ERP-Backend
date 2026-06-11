# salary-and-payroll-service/handlers/PaySlipTemplate.handler.js

## Purpose
gRPC handlers for managing EJS-based payslip templates — listing, fetching content, saving, and rendering with variable data.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `getEjsTemplateContent` | Lists available `.ejs` template files or returns content + variables for a specific path |
| `saveEjsTemplate` | Creates or updates a payslip template record with EJS content and variable metadata |
| `renderEjsTemplate` | Renders an EJS template with stored variable data into final HTML |

## Important Logic

### Template Path Security
Path traversal is prevented by resolving and validating that the requested file is within the allowed templates directory:

```js
function validateTemplatePath(templatePath) {
    const resolvedPath = path.resolve(templatePath);
    const resolvedBaseDir = path.resolve(EJS_TEMPLATE_DIR);
    if (!resolvedPath.startsWith(resolvedBaseDir)) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid template path' };
    }
    if (!resolvedPath.endsWith('.ejs')) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'Only .ejs files are allowed' };
    }
    return resolvedPath;
}
```

### Variable Extraction from Data Files
For each `.ejs` template, a corresponding `.js` file (e.g., `salaryTemplateV1.js`) is loaded to extract available variable metadata:

```js
async function extractEjsVariables(filePath) {
    const dataFilePath = filePath.replace('.ejs', '.js');
    const module = await import(`${pathToFileURL(dataFilePath).href}?t=${Date.now()}`);
    const data = module.default || {};
    return flattenDataToVariables(data);
}
```

### Auto-Provision Default Template
If no template exists for an organization when rendering, the first available `.ejs` file on disk is loaded and saved as the organization's default template:

```js
if (!template) {
    const templates = await listEjsTemplates();
    const defaultEjsContent = templates.length > 0 ? await fs.readFile(templates[0].path, 'utf-8') : '';
    await prisma.PayslipTemplates.create({
        data: { organizationId: organization_id, ejsContent: defaultEjsContent, ... },
    });
}
```

### Nested Variable Support
Variables can use dot-path notation (e.g., `company.name`) to populate nested objects in the render data:

```js
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    keys.forEach((key, index) => {
        if (index === keys.length - 1) current[key] = value;
        else { current[key] = current[key] || {}; current = current[key]; }
    });
}
```

### Value Type Detection
When extracting variables, the system heuristically detects types (number, date, url, boolean, array, object, string) based on key names and actual values:

```js
function detectValueType(key, value) {
    if (typeof value === 'number') return 'number';
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('amount') || lowerKey.includes('salary') || lowerKey.includes('pay')) return 'number';
    if (lowerKey.includes('date') || lowerKey.includes('month') || lowerKey.includes('period')) return 'date';
    if (lowerKey.includes('logo') || lowerKey.includes('image') || lowerKey.includes('url')) return 'url';
    return 'string';
}
```

## Helper Functions

- **`toLabel(key)`** — Converts a dot/underscore-separated key to a human-readable label (e.g., `gross_pay` → `Gross Pay`).
- **`flattenDataToVariables(data, parentKey)`** — Recursively flattens a nested data object into a flat list of variable descriptors.
- **`extractEjsVariables(filePath)`** — Imports the corresponding `.js` data file and extracts variables.
- **`listEjsTemplates()`** — Reads the templates directory and returns `.ejs` files.
- **`validateTemplatePath(templatePath)`** — Security check to prevent path traversal.
- **`setNestedValue(obj, path, value)`** — Sets a value at a dot-path within a nested object.
