# organizationSubscriptionClient

## Purpose
Organization subscription microservice for managing organization plan subscriptions.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';

const organizationSubscriptionProto = loadProto('organization_subscription');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const organizationSubscriptionClient = new organizationSubscriptionProto.OrganizationSubscriptionService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SUBSCRIPTION_SERVICE_ADDR` | `localhost:5083` |

## Proto Service
- **Proto loaded:** `organization_subscription`
- **Exported client:** `organizationSubscriptionClient`
- **Constructor:** `organizationSubscriptionProto.OrganizationSubscriptionService`

## gRPC Methods
```
CreateSubscription
GetOrganizationSubscription
CancelSubscription
ChangePlan
```
