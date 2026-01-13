import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

/* ------------------------------------------------------------------ */
/* 🧩 Handlers                                                         */
/* ------------------------------------------------------------------ */

import {
    createSubscriptionPlanFunc,
    updateSubscriptionPlanFunc,
    getSubscriptionPlanFunc,
    listSubscriptionPlansFunc,
    deleteSubscriptionPlanFunc,
    AddPlanFeatureFunc,
    UpdatePlanFeatureFunc,
    ListPlanFeaturesFunc,
    RemovePlanFeatureFunc
} from './handlers/SubscriptionPlan.handler.js';

import {
    AssignPlanToOrganizationFunc,
    GetOrganizationSubscriptionFunc,
    CancelOrganizationSubscriptionFunc,
    ChangeSubscriptionPlanFunc,
} from './handlers/OrganizationSubscription.handler.js';

import {
    ListInvoicesFunc,
    GetInvoiceFunc,
    MarkInvoicePaidFunc,
    ProcessInvoicePaymentFunc,
    RegenerateInvoicePaymentLinkFunc,
} from './handlers/Invoice.handler.js';

/* ------------------------------------------------------------------ */
/* 🧩 Config                                                           */
/* ------------------------------------------------------------------ */

const PORT = process.env.SUBSCRIPTION_SERVICE_PORT || 5083;

const SubscriptionPlanProto = loadProto('subscription_plan');
const OrganizationSubscriptionProto = loadProto('organization_subscription');
const InvoiceProto = loadProto('invoice');

/* ------------------------------------------------------------------ */
/* 🧩 Implementations                                                  */
/* ------------------------------------------------------------------ */

const SubscriptionPlanImpl = {
    CreateSubscriptionPlan: createSubscriptionPlanFunc,
    UpdateSubscriptionPlan: updateSubscriptionPlanFunc,
    DeleteSubscriptionPlan: deleteSubscriptionPlanFunc,
    ListSubscriptionPlans: listSubscriptionPlansFunc,
    GetSubscriptionPlan: getSubscriptionPlanFunc,
    AddPlanFeature: AddPlanFeatureFunc,
    UpdatePlanFeature: UpdatePlanFeatureFunc,
    ListPlanFeatures: ListPlanFeaturesFunc,
    RemovePlanFeature: RemovePlanFeatureFunc
};

const OrganizationSubscriptionImpl = {
    CreateSubscription: AssignPlanToOrganizationFunc,
    GetOrganizationSubscription: GetOrganizationSubscriptionFunc,
    CancelSubscription: CancelOrganizationSubscriptionFunc,
    ChangePlan: ChangeSubscriptionPlanFunc,
};

const InvoiceImpl = {
    ListInvoices: ListInvoicesFunc,
    ProcessInvoicePayment: ProcessInvoicePaymentFunc,
    GetInvoice: GetInvoiceFunc,
    MarkInvoicePaid: MarkInvoicePaidFunc,
    RegenerateInvoicePaymentLink: RegenerateInvoicePaymentLinkFunc
};

/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */

async function main() {
    await checkDbConnection('subscription-service');

    const server = new grpc.Server();

    server.addService(
        SubscriptionPlanProto.SubscriptionPlanService.service,
        SubscriptionPlanImpl
    );

    server.addService(
        OrganizationSubscriptionProto.OrganizationSubscriptionService.service,
        OrganizationSubscriptionImpl
    );

    server.addService(
        InvoiceProto.InvoiceService.service,
        InvoiceImpl
    );

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[subscription-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[subscription-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[subscription-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[subscription-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[subscription-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[subscription-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[subscription-service] Fatal error:', err);
    process.exit(1);
});
