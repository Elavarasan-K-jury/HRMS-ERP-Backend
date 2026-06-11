# subscription-service/server.js

## Purpose
gRPC server that bundles three subscription-related services: subscription plan management, organization subscription lifecycle, and invoice processing.

## Registered gRPC Services

| Service | Implementation Object | Proto |
|---|---|---|
| `SubscriptionPlanService` | `SubscriptionPlanImpl` | `subscription_plan` |
| `OrganizationSubscriptionService` | `OrganizationSubscriptionImpl` | `organization_subscription` |
| `InvoiceService` | `InvoiceImpl` | `invoice` |

## Handler Delegation Pattern

Methods are mapped from handler imports to gRPC service methods:

```js
const SubscriptionPlanImpl = {
    CreateSubscriptionPlan: createSubscriptionPlanFunc,
    UpdateSubscriptionPlan: updateSubscriptionPlanFunc,
    DeleteSubscriptionPlan: deleteSubscriptionPlanFunc,
    ListSubscriptionPlans: listSubscriptionPlansFunc,
    GetSubscriptionPlan: getSubscriptionPlanFunc,
    AddPlanFeature: AddPlanFeatureFunc,
    UpdatePlanFeature: UpdatePlanFeatureFunc,
    ListPlanFeatures: ListPlanFeaturesFunc,
    RemovePlanFeature: RemovePlanFeatureFunc,
};

server.addService(SubscriptionPlanProto.SubscriptionPlanService.service, SubscriptionPlanImpl);
server.addService(OrganizationSubscriptionProto.OrganizationSubscriptionService.service, OrganizationSubscriptionImpl);
server.addService(InvoiceProto.InvoiceService.service, InvoiceImpl);
```
