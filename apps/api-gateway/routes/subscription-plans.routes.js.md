# Subscription Plans Routes

**Service:** Subscription Plan gRPC (`subscriptionPlanClient`) + Invoice gRPC (`invoiceClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/payment/process-payment/{id}` | Process payment for invoice |
| POST | `/subscription-plans` | Create subscription plan |
| GET | `/subscription-plans/{id}` | Get subscription plan by ID |
| GET | `/subscription-plans` | List subscription plans |
| PUT | `/subscription-plans/{id}` | Update subscription plan |
| DELETE | `/subscription-plans/{id}` | Delete subscription plan |
| POST | `/subscription-plans/{id}/features` | Add subscription plan feature |
| PUT | `/subscription-plan-features/{id}` | Update subscription plan feature |
| GET | `/subscription-plans/{id}/features` | List subscription plan features |
| DELETE | `/subscription-plan-features/{id}` | Remove subscription plan feature |

## Code Snippet

```js
async (c) => {
    try {
        const { id } = c.req.param();
        const body = await c.req.json();
        const payload = processPaymentQuerySchema.parse(body);
        const response = await new Promise((resolve, reject) => {
            invoiceClient.ProcessInvoicePayment(
                { id, payment_ref: payload.razorpay_payment_id, payment_status: payload.razorpay_payment_link_status },
                (err, resp) => (err ? reject(err) : resolve(resp))
            );
        });
        return c.json(response, 201);
    } catch (error) { ... }
}
```

## Request/Response Schemas

- **CreatePlan**: `{ name (min2), description?, monthly_price?, yearly_price?, trial_days?, gst? }`
- **UpdatePlan**: `{ name?, description?, monthly_price?, yearly_price?, is_active?, gst? }`
- **AddFeature**: `{ key, value?, unit?, is_unlimited? }`
- **PaymentQuery**: `{ razorpay_payment_id, razorpay_payment_link_status }`
- **Feature**: `{ value?, unit?, is_unlimited? }`

## Unique Logic

- Uses two gRPC clients: `subscriptionPlanClient` for plan CRUD and `invoiceClient` for payment processing.
- Payment processing endpoint is defined first (tagged `Payments`), then plan CRUD (tagged `Subscription Plans`).
- Features are sub-resources managed under `/subscription-plans/{id}/features` and `/subscription-plan-features/{id}`.
- `gst` field validated as percentage (0-100).
