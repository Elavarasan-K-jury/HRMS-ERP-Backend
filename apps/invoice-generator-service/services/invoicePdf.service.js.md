# services/invoicePdf.service.js

**Purpose:** Static service class that generates an invoice PDF and uploads it to the configured file storage, returning the upload result.

## Key Exports

```js
export class InvoicePdfService {
    static async generateAndUpload({ invoice, organization, items, totals, usageSummary })
}
```

Returns the result of `FileService.upload` (contains `url` and `key`).

## Dependencies

| Package | Purpose |
|---|---|
| `../pdf/generateInvoicePDF.js` | `generateInvoicePDF` |
| `@jury-hrms/files` | `FileService` |

## Important Logic

The method orchestrates two steps:

1. **Generate PDF** (lines 6–31) — Calls `generateInvoicePDF` with invoice data, customer info, billing period, items, totals, and usage summary.
2. **Upload to storage** (lines 33–37):
```js
const uploaded = await FileService.upload(pdfBuffer, `invoice-${invoice.invoiceNumber}.pdf`, "invoices");
return uploaded;
```
Uploads the PDF buffer to the `invoices` container/folder with a deterministic filename based on the invoice number.
