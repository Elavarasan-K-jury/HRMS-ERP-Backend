# `razorpay.js` — Razorpay Payment Gateway Integration

Wraps the Razorpay Node.js SDK into a class that provides methods for order management, payment capture, payment links, and payment listing.

## Exports

### `RazorPayPayment` (default)

Initialized with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from environment.

#### `listOrders(page, limit)`
Lists all Razorpay orders with pagination.

```js
const orders = await razorpay.listOrders(1, 10);
```

#### `getOrder(orderId)`
Fetches a specific order by ID.

```js
const order = await razorpay.getOrder('order_...');
```

#### `createOrder(amount, currency, receipt, payment_capture, paymentId)`
Creates a new Razorpay order. `amount` is in the smallest currency unit (paise for INR). `payment_capture` defaults to `true`.

```js
const order = await razorpay.createOrder(50000, 'INR', 'rec_001');
```

#### `capturePayment(paymentId, amount, currency)`
Captures a payment that was authorized but not yet captured.

```js
const payment = await razorpay.capturePayment('pay_...', 50000, 'INR');
```

#### `listPayments(page, limit)`
Lists all payments with pagination.

#### `getPayment(paymentId)`
Fetches a single payment by ID.

#### `fetchPaymentByOrderId(orderId)`
Gets all payments associated with a specific order.

```js
const payments = await razorpay.fetchPaymentByOrderId('order_...');
```

#### `createPaymentLink(amount, currency, customer, notes, description, paymentId)`
Creates a payment link that expires in 16 minutes. The `customer` object should contain `name`, `email`, and `contact`. The `callback_url` points back to the application's payment processing endpoint.

```js
const link = await razorpay.createPaymentLink(
    50000, 'INR',
    { name: 'Acme', email: 'billing@acme.com', contact: '+919000000000' },
    null, 'Subscription payment', 'pay_...'
);
// => { ...paymentLink, callBackUrl: 'https://...' }
```

## Dependencies

- `razorpay` — Official Razorpay Node.js SDK
