# cron/expirePaymentLinks.cron.js

**Purpose:** Runs every 5 minutes to mark invoices as `FAILED` when their payment link expiry time (`paymentLinkExpiredBy`) has passed.

## Key Exports

None (side-effect module that registers a cron schedule).

## Dependencies

| Package | Purpose |
|---|---|
| `node-cron` | CRON scheduler |
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

```js
cron.schedule("*/5 * * * *", async () => {
    const result = await prisma.invoices.updateMany({
        where: {
            status: "ISSUED",
            paymentStatus: "PENDING",
            paymentLinkExpiredBy: { not: null, lt: now },
        },
        data: { paymentStatus: "FAILED", updatedAt: now },
    });
});
```
Updates invoices that are `ISSUED`, have `PENDING` payment, and whose `paymentLinkExpiredBy` timestamp is in the past. Sets their payment status to `FAILED`.
