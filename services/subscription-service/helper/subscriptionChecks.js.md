# subscription-service/helper/subscriptionChecks.js

## Purpose
Guard utility that prevents assigning a new subscription to an organization that already has an active/live subscription.

## Exported Function

**`ensureNoActiveSubscription(organizationId, options)`** — Throws a gRPC `ALREADY_EXISTS` error if the organization has a subscription in a blocking status (TRIAL, ACTIVE, PAST_DUE, SUSPENDED).

### Logic

1. Finds the most recent subscription for the organization
2. If no subscription exists, returns (allowed)
3. If the subscription has no successful payment (invoice), returns (allowed — effectively allows re-subscription for unpaid trials)
4. If the subscription is in a blocking status, throws an error
5. Optionally allows creation if `allowIfCancelAtPeriodEnd` is true and the current subscription is set to cancel

```js
const blockingStatuses = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED']);

if (blockingStatuses.has(existing.status)) {
    if (allowIfCancelAtPeriodEnd && existing.cancelAtPeriodEnd) return;

    throw {
        code: grpc.status.ALREADY_EXISTS,
        message: `Organization already has an active subscription (status: ${existing.status})`,
    };
}
```
