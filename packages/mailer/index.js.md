# `mailer/index.js` — High-Level Email Sending Functions

Provides ready-to-use email functions for OTP, welcome emails, invoices, finance, and expense notifications. All functions build subject/text/html and delegate to `sendRaw`.

## Exports

### `sendEmail(to, subject, text, html)`
Low-level send; wraps `sendRaw`.

### `sendOtpEmail(to, otp, ttlMinutes)`
Sends an OTP verification email with a 5-minute default expiry.

```js
await sendOtpEmail('user@example.com', '123456');
```

### `sendWelcomeEmail(employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail)`
Sends a welcome email with login credentials to newly created employees.

### `sendInvoiceEmail({ to, organizationName, invoiceNumber, amount, currency, billingPeriodStart, billingPeriodEnd, dueDate, pdfBuffer, supportEmail, paymentLink })`
Sends an invoice email with a PDF attachment. Ensures `pdfBuffer` is a proper `Buffer`, attaches it as `invoice-{number}.pdf`.

```js
await sendInvoiceEmail({ to: 'org@example.com', invoiceNumber: 'INV-001', ... });
```

### `sendFinanceEnabledEmail(to)`
Notifies that the Finance module has been enabled.

### `sendExpenseRaisedEmail(to, expense)`
Notifies an approver that a new expense has been submitted.

### `sendExpenseStatusEmail(to, expense)`
Notifies the employee that their expense was approved or rejected.

### `verifyTransport`, `getFromAddress`
Re-exported from `transport.js`.

## Dependencies

- `./transport.js` — `sendRaw`, `verifyTransport`, `getFromAddress`
- `./templates.js` — HTML template generators
