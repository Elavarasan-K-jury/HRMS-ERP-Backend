# invoiceClient

## Purpose
Invoice microservice for managing subscription invoices and payments.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';

const invoiceProto = loadProto('invoice');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const invoiceClient = new invoiceProto.InvoiceService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `SUBSCRIPTION_SERVICE_ADDR` | `localhost:5083` |

## Proto Service
- **Proto loaded:** `invoice`
- **Exported client:** `invoiceClient`
- **Constructor:** `invoiceProto.InvoiceService`

## gRPC Methods
```
ListInvoices
GetInvoice
MarkInvoicePaid
DownloadInvoice
RegenerateInvoicePaymentLink
ProcessInvoicePayment
```
