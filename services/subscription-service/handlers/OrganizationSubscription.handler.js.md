# subscription-service/handlers/OrganizationSubscription.handler.js

## Purpose
gRPC handlers for managing organization subscriptions — assigning plans, fetching status, cancelling, and plan changes with upgrade/downgrade detection.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `AssignPlanToOrganizationFunc` | Creates a new subscription (TRIAL or ACTIVE) and generates first invoice |
| `GetOrganizationSubscriptionFunc` | Fetches current subscription with plan details and invoices |
| `CancelOrganizationSubscriptionFunc` | Cancels immediately or at period end |
| `ChangeSubscriptionPlanFunc` | Upgrades/downgrades plan with change log |

## Important Logic

### Subscription Assignment with Trial
If the plan has trial days, the subscription starts in `TRIAL` status; otherwise `ACTIVE`:

```js
const subscription = await prisma.organizationSubscriptions.create({
    data: {
        organizationId: organization_id,
        planId: plan.id,
        billingInterval: interval,
        status: plan.trialDays ? 'TRIAL' : 'ACTIVE',
        priceAtPurchase: price,
        startDate: now,
        trialEndsAt: plan.trialDays ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000) : null,
    },
});

// Generate first invoice automatically
await generateInvoiceForSubscription({ subscriptionId: subscription.id });
```

### Plan Change with Upgrade/Downgrade Detection
Compares old vs new plan pricing to determine the change type:

```js
const oldPrice = subscription.billingInterval === "MONTHLY"
    ? subscription.plan.monthlyPrice ?? 0 : subscription.plan.yearlyPrice ?? 0;

const newPrice = subscription.billingInterval === "MONTHLY"
    ? newPlan.monthlyPrice ?? 0 : newPlan.yearlyPrice ?? 0;

const changeType = newPrice > oldPrice ? "UPGRADE" : "DOWNGRADE";
```

### Change Log Recording
Plan changes are recorded in a `subscriptionChangeLog` table within a transaction:

```js
await prisma.$transaction(async (tx) => {
    await tx.organizationSubscriptions.update({
        where: { id: subscription.id },
        data: { planId: new_plan_id, priceAtPurchase: newPrice },
    });

    await tx.subscriptionChangeLog.create({
        data: { subscriptionId: subscription.id, oldPlanId: subscription.planId, newPlanId: new_plan_id, changeType, effectiveDate, reason },
    });
});
```

### Cancel Options
Supports both immediate cancellation (`status = 'CANCELLED'`) and cancel-at-period-end (`cancelAtPeriodEnd = true`):

```js
const data = cancel_at_period_end
    ? { cancelAtPeriodEnd: true }
    : { status: 'CANCELLED', cancelledAt: new Date() };
```

### Active Subscription Guard
Only one active/trial subscription is allowed per organization via `ensureNoActiveSubscription`.

## Helper Functions

| Function | Purpose |
|---|---|
| `mapOrganizationSubscription(sub)` | Maps subscription + plan + invoices to gRPC response |
| `mapPlan(plan)` | Maps plan object (internal) |
| `mapPlanFeature(feature)` | Maps feature object (internal) |
| `mapInvoiceFull(invoice)` | Maps invoice with payment details (internal) |
