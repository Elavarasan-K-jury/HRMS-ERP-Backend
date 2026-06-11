# pdf/generateInvoicePDF.js

**Purpose:** Generates an A4 PDF invoice buffer from invoice data using Puppeteer (headless Chrome) and an HTML template rendered via Handlebars.

## Key Exports

```js
export async function generateInvoicePDF(invoiceData)
```

Returns `{ pdfBuffer, buffer: Buffer.from(pdfBuffer) }`.

## Dependencies

| Package | Purpose |
|---|---|
| `puppeteer` | Headless browser for PDF rendering |
| `./renderInvoiceHTML.js` | `renderInvoiceHTML` |

## Important Logic

### Clone input to avoid mutation (line 16)
```js
const data = structuredClone(invoiceData);
```

### Normalize address object to string (lines 21–34)
```js
if (data.customer?.address && typeof data.customer.address === "object") {
    data.customer.address = [a.streetNumber, a.streetName, ...].filter(Boolean).join(", ");
}
```
Flattens a structured address object into a single comma-separated string for the HTML template.

### Puppeteer PDF generation (lines 46–76)
```js
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", ...] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded" });
const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { ... } });
```
Launches a new browser instance per call (note: the code comments suggest switching to a singleton pattern), renders the HTML, and generates a PDF.
