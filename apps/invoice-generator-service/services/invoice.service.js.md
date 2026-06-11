# services/invoice.service.js

**Purpose:** Provides a programmatic API (`generateInvoiceForSubscription`) to generate an invoice for a single subscription — handles duplicate prevention, Razorpay order/link creation, PDF generation, file upload, and email delivery.

## Key Exports

```js
export async function generateInvoiceForSubscription({ subscriptionId })
```

Returns the created `invoice` object (or existing invoice on duplicate).

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |
| `../utils/date.js` | `addDays` |
| `../utils/invoiceNumber.js` | `generateInvoiceNumber` |
| `../pdf/generateInvoicePDF.js` | `generateInvoicePDF` |
| `@jury-hrms/files` | `FileService` |
| `@jury-hrms/mailer` | `sendInvoiceEmail` |
| `@jury-hrms/payments` | `RazorPayPayment` |

## Important Logic

### Duplicate prevention (lines 34–45)
```js
const existing = await prisma.invoices.findFirst({
    where: { subscriptionId, billingPeriodStart: periodStart, billingPeriodEnd: periodEnd, status: { not: "CANCELLED" } },
});
if (existing) return existing;
```
Returns the existing invoice if one already exists for the same subscription and billing period.

### Zero/negative amount guard (line 52)
```js
if (!amount || amount <= 0) return null;
```
Skips free or zero-amount subscriptions.

### Complete invoice lifecycle (lines 57–204)
1. Creates `invoices` record with `ISSUED` status
2. Computes GST tax and total
3. Creates Razorpay **Order** (paise amount)
4. Creates Razorpay **Payment Link** with customer details
5. Updates invoice with payment metadata
6. Generates PDF via `generateInvoicePDF`
7. Uploads PDF via `FileService.upload`
8. Sends invoice email with PDF attachment and payment link
