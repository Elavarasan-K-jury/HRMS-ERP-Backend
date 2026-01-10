import { loadProto, grpc } from '@jury-hrms/proto';

const invoiceProto = loadProto('invoice');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const invoiceClient = new invoiceProto.InvoiceService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
