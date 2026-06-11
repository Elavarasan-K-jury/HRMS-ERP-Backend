# subscription-service/handlers/SubscriptionPlan.handler.js

## Purpose
gRPC handlers for managing subscription plans — CRUD operations plus feature-based configuration (employee limits, storage, API rate, etc.).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `createSubscriptionPlanFunc` | Creates a plan with default set of 6 limit features |
| `updateSubscriptionPlanFunc` | Updates plan metadata with price/GST validation |
| `getSubscriptionPlanFunc` | Fetches a single plan by ID |
| `listSubscriptionPlansFunc` | Paginated list with search across name/description |
| `deleteSubscriptionPlanFunc` | Soft-deletes a plan |
| `AddPlanFeatureFunc` | Adds a feature to a plan |
| `UpdatePlanFeatureFunc` | Updates a feature's value/unit/unlimited flag |
| `ListPlanFeaturesFunc` | Lists all features for a plan |
| `RemovePlanFeatureFunc` | Hard-deletes a feature |

## Important Logic

### Default Features on Plan Creation
When a new subscription plan is created, six default limit features are automatically added:

```js
const defaultFeatures = [
    { key: 'max_employees', value: 20, unit: 'users' },
    { key: 'storage_gb', value: 10, unit: 'GB' },
    { key: 'api_rate_per_minute', value: 1000, unit: 'requests/min' },
    { key: 'payroll_runs_per_month', value: 1, unit: 'runs' },
    { key: 'max_leave_policies', value: 5, unit: 'policies' },
    { key: 'max_admin_accounts', value: 3, unit: 'admins' },
];

await prisma.subscriptionPlanFeatures.createMany({
    data: defaultFeatures.map((f) => ({
        planId: plan.id, key: f.key, value: f.value, unit: f.unit,
        isUnlimited: false,
    })),
});
```

### Price Validation
Ensures yearly price > monthly price and GST is between 0 and 100:

```js
function validatePrices(monthly, yearly) {
    if (monthly && yearly && yearly <= monthly) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'Yearly price must be greater than monthly price' };
    }
}

function validateGst(gst) {
    if (gst !== undefined && (gst < 0 || gst > 100)) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'GST must be between 0 and 100' };
    }
}
```

### Unique Name Enforcement (Case-Insensitive)
```js
const existing = await prisma.subscriptionPlans.findFirst({
    where: { deletedAt: null, name: { equals: name, mode: 'insensitive' } },
});
```

### Feature Unlimited Flag
Features can be marked as unlimited (value becomes null):

```js
data: {
    value: is_unlimited ? null : value,
    unit: unit ?? feature.unit,
    isUnlimited: !!is_unlimited,
}
```

## Helper Functions

| Function | Purpose |
|---|---|
| `normalizeName(name)` | Trims and lowercases a name for comparison |
| `validatePrices(monthly, yearly)` | Validates yearly > monthly price |
| `validateGst(gst)` | Validates GST is 0–100 |
| `mapPlan(plan)` | Maps plan + features to gRPC shape |
| `mapPlanFeature(feature)` | Maps a feature record to gRPC shape |
| `mapSortField(field)` | Converts snake_case sort field to camelCase Prisma field |
