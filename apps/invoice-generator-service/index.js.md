# index.js

**Purpose:** Entry point for the invoice-generator service — initializes the cron jobs for invoice creation and payment link expiry.

## Key Exports

None. The file is a side-effect-only module.

## Dependencies

| Package | Purpose |
|---|---|
| `./cron/invoice.cron.js` | Invoice generation cron (side-effect import) |
| `./cron/expirePaymentLinks.cron.js` | Payment link expiry cron (side-effect import) |

## Important Logic

The entire file is simply:
```js
import "./cron/invoice.cron.js";
import "./cron/expirePaymentLinks.cron.js";
console.log("🚀 Invoice generator service started");
```
It imports both cron modules for their side effects (they register their own `cron.schedule` calls) and logs a startup message.
