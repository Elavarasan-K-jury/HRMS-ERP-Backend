import { loadProto, grpc } from '@jury-hrms/proto';

const organizationSubscriptionProto = loadProto('organization_subscription');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const organizationSubscriptionClient = new organizationSubscriptionProto.OrganizationSubscriptionService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
