# Organization Subscription Routes

**Service:** Organization Subscription gRPC (`organizationSubscriptionClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/organizations/{organization_id}/subscription` | Assign a subscription plan to an organization |
| GET | `/organizations/{organization_id}/subscription` | Get current subscription for an organization |
| POST | `/organizations/{organization_id}/subscription/cancel` | Cancel an organization's subscription |
| POST | `/organizations/{organization_id}/subscription/change-plan` | Change subscription plan (upgrade or downgrade) |

## Code Snippet

```js
async (c) => {
    try {
        const { organization_id } = c.req.param();
        const body = await c.req.json();
        const parsed = assignPlanSchema.parse(body);
        const response = await new Promise((resolve, reject) => {
            organizationSubscriptionClient.CreateSubscription(
                { organization_id, plan_id: parsed.plan_id, billing_interval: parsed.billing_interval },
                (err, resp) => { if (err) return reject(err); resolve(resp); }
            );
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **AssignPlan**: `{ plan_id, billing_interval? (MONTHLY|YEARLY) }` (`.strict()`)
- **CancelSubscription**: `{ cancel_at_period_end? }` (`.strict()`)
- **ChangePlan**: `{ new_plan_id, effective_immediately?, reason? }` (`.strict()`)

## Unique Logic

- All request bodies use `.strict()` to reject unknown fields.
- `billing_interval` is optional but only accepts `MONTHLY` or `YEARLY`.
- Routes are nested under organization path.
