# `templates.js` — HTML Email Template Generators

Pure functions that return inline-styled HTML strings for various email types used by the mailer.

## Exports

### `otpHtml(otp, ttlMinutes)`
Generates a clean, minimal OTP email with a monospace-styled code block and expiry notice.

```js
otpHtml('482916', 5);
```

### `generateWelcomeEmail({ employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail, logoUrl, showQuickTips, customMessage })`
Rich welcome email with gradient hero, credentials card, CTA button, and optional quick-tips section.

```js
generateWelcomeEmail({
  employeeName: 'Alice',
  employeeEmail: 'alice@co.com',
  loginUrl: 'https://app.juryhrms.com/login',
  companyName: 'Jury HRMS',
  showQuickTips: true
});
```

### `generateInvoiceEmail({ organizationName, invoiceNumber, amount, currency, billingPeriodStart, billingPeriodEnd, dueDate, supportEmail, paymentLink, paymentLinkExpiredBy })`
Invoice email with billing period, due date, total amount, and a Pay Now button (or expired link warning). Includes the raw payment URL as fallback.

```js
generateInvoiceEmail({ organizationName: 'Acme', invoiceNumber: 'INV-001', ... });
```

### `financeEnabledHtml(userName)`
Styled notification that the Finance module is active, listing enabled features (payroll, expenses, budgets, reports).

### `expenseRequestHtml(expense)`
Expense request notification for approvers. Shows employee name, category, amount, description, date, and status. Formats currency in INR.

### `expenseStatusHtml(expense)`
Expense status update for the submitting employee. Shows whether approved or rejected, with approver info, amounts, and dates.

```js
expenseStatusHtml({ employee: { fullName: 'Bob' }, status: 'APPROVED', amount: 5000, ... });
```

## Dependencies

None (pure JavaScript template literals).
