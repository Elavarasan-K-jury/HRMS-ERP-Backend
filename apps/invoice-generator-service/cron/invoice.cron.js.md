# cron/invoice.cron.js

**Purpose:** Daily cron job (02:00) that generates invoices for active subscriptions — creates Razorpay orders/payment links, generates PDFs, uploads them, and emails invoices to customers.

## Key Exports / Functions

| Function | Description |
|---|---|
| `getPlanLimit(plan, key)` | Extracts a feature limit from a plan's features array |

## Dependencies

| Package | Purpose |
|---|---|
| `node-cron` | CRON scheduler |
| `@jury-hrms/db/client.js` | Prisma client |
| `../utils/date.js` | `addDays`, `daysBetween` |
| `../utils/invoiceNumber.js` | `generateInvoiceNumber` |
| `../services/invoicePdf.service.js` | `InvoicePdfService.generateAndUpload` |
| `../utils/usage.js` | `getOrgUsageSummary` |
| `../pdf/generateInvoicePDF.js` | `generateInvoicePDF` |
| `@jury-hrms/mailer` | `sendInvoiceEmail` |
| `@jury-hrms/payments` | `RazorPayPayment` |

## Important Logic

### Auto-mark PAST_DUE (lines 29–40)
```js
await prisma.organizationSubscriptions.updateMany({
    where: {
        status: "ACTIVE",
        invoices: { some: { status: { in: ["ISSUED", "FAILED"] }, billingPeriodEnd: { lt: now } } },
    },
    data: { status: "PAST_DUE" },
});
```
Marks subscriptions as PAST_DUE if they have unpaid invoices past their billing period end.

### Invoice window (lines 60)
```js
if (daysLeft > 7 || daysLeft < 0) continue;
```
Only creates invoices when 0–7 days remain in the billing cycle.

### Duplicate prevention (lines 72–81)
```js
const existingInvoice = await prisma.invoices.findFirst({
    where: { subscriptionId: sub.id, billingPeriodStart: periodStart, billingPeriodEnd: periodEnd, status: { not: "CANCELLED" } },
});
if (existingInvoice) continue;
```
Ensures no duplicate invoice is created for the same subscription and billing period.

### Usage snapshot (lines 99–109)
Creates a `subscriptionUsageSnapshot` record with `usedValue`, `limitValue`, and `isExceeded` for the `api_requests` metric.

### Payment flow (lines 132–185)
1. Creates a Razorpay **Order** (amount in paise)
2. Creates a Razorpay **Payment Link** with customer info and metadata
3. Updates the invoice in DB with `paymentOrderId`, `paymentLink`, `paymentStatus`, `tax`, `total`
