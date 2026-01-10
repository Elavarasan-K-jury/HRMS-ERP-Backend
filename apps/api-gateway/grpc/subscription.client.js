import { loadProto, grpc } from '@jury-hrms/proto';

const subscriptionPlanProto = loadProto('subscription_plan');

const SUBSCRIPTION_SERVICE_ADDR =
    process.env.SUBSCRIPTION_SERVICE_ADDR || 'localhost:5083';

export const subscriptionPlanClient = new subscriptionPlanProto.SubscriptionPlanService(
    SUBSCRIPTION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
