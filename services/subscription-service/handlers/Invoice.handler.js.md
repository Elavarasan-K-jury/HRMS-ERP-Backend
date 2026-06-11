# subscription-service/handlers/Invoice.handler.js

## Purpose
gRPC handlers for invoice lifecycle — listing, fetching, marking paid, processing payments, regenerating Razorpay payment links, and sending invoice emails.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `ListInvoicesFunc` | Paginated invoice list with search by invoice number and org filtering |
| `GetInvoiceFunc` | Fetches a single invoice by ID (org-scoped) |
| `MarkInvoicePaidFunc` | Marks an invoice as PAID and reactivates PAST_DUE subscriptions |
| `ProcessInvoicePaymentFunc` | Updates invoice status and payment ref based on payment gateway callback |
| `RegenerateInvoicePaymentLinkFunc` | Creates a new Razorpay order + payment link, updates invoice, sends email |

## Important Logic

### Payment Link Regeneration
Creates a new Razorpay order and payment link, then updates the invoice:

```js
const razorpay = new RazorPayPayment();

const order = await razorpay.createOrder(
    Math.round(invoice.total * 100), invoice.currency || "INR",
    invoice.invoiceNumber, true
);

const paymentLink = await razorpay.createPaymentLink(
    Math.round(invoice.total * 100), invoice.currency || "INR",
    { name: invoice.subscription.organization.contactPersonName, email, contact },
    { invoiceId: invoice.id, subscriptionId: invoice.subscriptionId, regenerated: true },
    `Invoice ${invoice.invoiceNumber}`, invoice.id
);

const updated = await prisma.invoices.update({
    where: { id: invoice.id },
    data: {
        paymentOrderId: order.id,
        paymentLink: paymentLink.short_url,
        paymentProvider: "razorpay",
        paymentStatus: "PENDING",
        paymentLinkExpiredBy: paymentLinkExpiry,
    },
});
```

### Invoice Paid → Subscription Reactivation
When an invoice for a `PAST_DUE` subscription is paid, the subscription is reactivated:

```js
await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: "PAID", paidAt: new Date(), paymentStatus: "SUCCESS" } });

    if (invoice.subscription?.status === "PAST_DUE") {
        await tx.organizationSubscriptions.update({
            where: { id: invoice.subscriptionId },
            data: { status: "ACTIVE" },
        });
    }
});
```

### Email Notification on Payment Link
After regenerating a payment link, an invoice email is sent with the PDF attachment:

```js
if (to) {
    sendInvoiceEmail({
        to, organizationName, invoiceNumber, amount,
        billingPeriodStart, billingPeriodEnd,
        dueDate: addDays(updated.billingPeriodStart, 7).toISOString().slice(0, 10),
        supportEmail: "support@jurysoft.com", paymentLink: paymentLink.short_url, pdfBuffer, paymentLinkExpiry,
    });
}
```

### State Guards
Invoices that are already PAID, CANCELLED, or FAILED cannot be processed or regenerated:

```js
if (invoice.status === "PAID") {
    return callback({ code: grpc.status.FAILED_PRECONDITION, message: "Invoice already paid" });
}
```

## Helper Functions

- **`mapInvoiceFull(invoice)`** — Maps invoice + subscription + organization + payment details to the full gRPC response shape, including nested plan and org info.
