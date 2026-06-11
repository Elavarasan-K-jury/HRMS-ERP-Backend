# subscriptionPlanClient

## Purpose
Subscription plan microservice for managing subscription plans and plan features.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';

const subscriptionPlanProto = loadProto('subscription_plan');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const subscriptionPlanClient = new subscriptionPlanProto.SubscriptionPlanService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SUBSCRIPTION_SERVICE_ADDR` | `localhost:5083` |

## Proto Service
- **Proto loaded:** `subscription_plan`
- **Exported client:** `subscriptionPlanClient`
- **Constructor:** `subscriptionPlanProto.SubscriptionPlanService`

## gRPC Methods
```
CreateSubscriptionPlan
GetSubscriptionPlan
ListSubscriptionPlans
UpdateSubscriptionPlan
DeleteSubscriptionPlan
AddPlanFeature
ListPlanFeatures
RemovePlanFeature
UpdatePlanFeature
```
