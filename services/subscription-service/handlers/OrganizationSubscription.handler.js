import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { ensureNoActiveSubscription } from '../helper/subscriptionChecks.js';
import { generateInvoiceForSubscription } from "../../../apps/invoice-generator-service/services/invoice.service.js";


/* ============================================================
   🟢 ASSIGN PLAN TO ORGANIZATION
============================================================ */
export const AssignPlanToOrganizationFunc = async (call, callback) => {
    try {
        const { organization_id, plan_id, billing_interval } = call.request;

        if (!organization_id || !plan_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id and plan_id are required',
            });
        }

        const interval = billing_interval || 'MONTHLY';
        if (!['MONTHLY', 'YEARLY'].includes(interval)) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'billing_interval must be MONTHLY or YEARLY',
            });
        }

        // 🚫 only one active / trial subscription allowed
        await ensureNoActiveSubscription(organization_id);

        const plan = await prisma.subscriptionPlans.findFirst({
            where: {
                id: plan_id,
                deletedAt: null,
                isActive: true,
            },
        });

        if (!plan) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Active subscription plan not found',
            });
        }

        const price =
            interval === 'YEARLY'
                ? plan.yearlyPrice
                : plan.monthlyPrice;

        if (!price || price <= 0) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: `No price configured for ${interval.toLowerCase()} billing`,
            });
        }

        const now = new Date();
        const trialEndsAt = plan.trialDays
            ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
            : null;

        const subscription = await prisma.organizationSubscriptions.create({
            data: {
                organizationId: organization_id,
                planId: plan.id,
                billingInterval: interval,
                status: plan.trialDays ? 'TRIAL' : 'ACTIVE',
                priceAtPurchase: price,
                startDate: now,
                trialEndsAt,
                createdAt: now,
                updatedAt: now,
            },
            include: { plan: true, invoices: true },
        });

        await generateInvoiceForSubscription({
            subscriptionId: subscription.id,
        });

        return callback(null, {
            success: true,
            message: 'Subscription assigned successfully',
            data: mapOrganizationSubscription(subscription),
        });
    } catch (e) {
        console.error('AssignPlan Error:', e);
        return callback({
            code: e.code || grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

/* ============================================================
   🔵 GET ORGANIZATION SUBSCRIPTION
============================================================ */
export const GetOrganizationSubscriptionFunc = async (call, callback) => {
    try {
        const { organization_id } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id is required',
            });
        }

        const sub = await prisma.organizationSubscriptions.findFirst({
            where: { organizationId: organization_id },
            orderBy: { ['createdAt']: 'desc' },
            include: {
                plan: {
                    include: {
                        features: true
                    }
                },
                invoices: true
            },
        });

        if (!sub) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'No subscription found for organization',
            });
        }

        console.log('OrganizationSubscription.handler.js @ Line 135:', sub);

        return callback(null, {
            success: true,
            data: mapOrganizationSubscription(sub),
        });
    } catch (e) {
        console.error('GetOrganizationSubscription Error:', e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

/* ============================================================
   🔴 CANCEL SUBSCRIPTION
============================================================ */
export const CancelOrganizationSubscriptionFunc = async (call, callback) => {
    try {
        const { organization_id, cancel_at_period_end } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id is required',
            });
        }

        const sub = await prisma.organizationSubscriptions.findUnique({
            where: { organizationId: organization_id },
        });

        if (!sub) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Subscription not found',
            });
        }

        if (['CANCELLED', 'EXPIRED'].includes(sub.status)) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: 'Subscription already inactive',
            });
        }

        const data = cancel_at_period_end
            ? {
                cancelAtPeriodEnd: true,
                updatedAt: new Date(),
            }
            : {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                updatedAt: new Date(),
            };

        await prisma.organizationSubscriptions.update({
            where: { id: sub.id },
            data,
        });

        return callback(null, {
            success: true,
            message: cancel_at_period_end
                ? 'Subscription will be cancelled at period end'
                : 'Subscription cancelled immediately',
        });
    } catch (e) {
        console.error('CancelSubscription Error:', e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

/* ============================================================
   🔁 CHANGE SUBSCRIPTION PLAN
============================================================ */
export const ChangeSubscriptionPlanFunc = async (call, callback) => {
    try {
        const {
            organization_id,
            new_plan_id,
            effective_immediately = true,
            reason = "User initiated plan change",
        } = call.request;

        if (!organization_id || !new_plan_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id and new_plan_id are required",
            });
        }

        /**
         * 1️⃣ Fetch current subscription
         */
        const subscription =
            await prisma.organizationSubscriptions.findUnique({
                where: { organizationId: organization_id },
                include: { plan: true },
            });

        if (!subscription) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "No active subscription found for organization",
            });
        }

        if (
            subscription.status === "CANCELLED" ||
            subscription.status === "EXPIRED"
        ) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: "Subscription cannot be modified",
            });
        }

        /**
         * 2️⃣ Fetch new plan
         */
        const newPlan = await prisma.subscriptionPlans.findUnique({
            where: { id: new_plan_id },
        });

        if (!newPlan || !newPlan.isActive) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Invalid or inactive subscription plan",
            });
        }

        if (newPlan.id === subscription.planId) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: "Already on this plan",
            });
        }

        /**
         * 3️⃣ Determine change type
         */
        const oldPrice =
            subscription.billingInterval === "MONTHLY"
                ? subscription.plan.monthlyPrice ?? 0
                : subscription.plan.yearlyPrice ?? 0;

        const newPrice =
            subscription.billingInterval === "MONTHLY"
                ? newPlan.monthlyPrice ?? 0
                : newPlan.yearlyPrice ?? 0;

        const changeType =
            newPrice > oldPrice ? "UPGRADE" : "DOWNGRADE";

        const effectiveDate = effective_immediately
            ? new Date()
            : subscription.endDate ?? subscription.billingPeriodEnd ?? new Date();

        /**
         * 4️⃣ Transaction: update subscription + log change
         */
        await prisma.$transaction(async (tx) => {
            // Update subscription plan
            await tx.organizationSubscriptions.update({
                where: { id: subscription.id },
                data: {
                    planId: new_plan_id,
                    priceAtPurchase: newPrice,
                    updatedAt: new Date(),
                },
            });

            // Record change log
            await tx.subscriptionChangeLog.create({
                data: {
                    subscriptionId: subscription.id,
                    oldPlanId: subscription.planId,
                    newPlanId: new_plan_id,
                    changeType,
                    effectiveDate,
                    reason,
                },
            });
        });

        return callback(null, {
            success: true,
            message: `Subscription ${changeType.toLowerCase()} successful`,
        });
    } catch (e) {
        console.error("ChangeSubscriptionPlan Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

/* ============================================================
   🧭 MAPPER (PRISMA → PROTO)
============================================================ */
function mapPlan(plan) {
    return {
        id: plan.id,
        name: plan.name,
        description: plan.description ?? '',
        is_active: plan.isActive,
        monthly_price: plan.monthlyPrice ?? 0,
        yearly_price: plan.yearlyPrice ?? 0,
        gst: plan.gst ?? 18,
        trial_days: plan.trialDays,
        created_at: plan.createdAt?.toISOString(),
        updated_at: plan.updatedAt?.toISOString(),
        features: plan?.features?.length ? plan.features.map(mapPlanFeature) : []
    };
}

function mapPlanFeature(feature) {
    return {
        id: feature.id,
        plan_id: feature.planId,
        key: feature.key,
        value: feature.value ?? 0,
        unit: feature.unit ?? '',
        is_unlimited: feature.isUnlimited,
    };
}

function mapInvoiceFull(invoice) {
    return {
        id: invoice.id,
        invoice_number: invoice.invoiceNumber,

        amount: invoice.amount,
        tax: invoice.tax,
        total: invoice.total,
        currency: invoice.currency,
        status: invoice.status,

        billing_period_start: invoice.billingPeriodStart?.toISOString?.() ?? "",
        billing_period_end: invoice.billingPeriodEnd?.toISOString?.() ?? "",

        issued_at: invoice.issuedAt?.toISOString?.() ?? "",
        paid_at: invoice.paidAt?.toISOString?.() ?? "",

        invoice_url: invoice.invoiceUrl ?? "",
        invoice_key: invoice.invoiceKey ?? "",

        payment: {
            order_id: invoice.paymentOrderId ?? "",
            link: invoice.paymentLink ?? "",
            status: invoice.paymentStatus ?? "PENDING",
            ref: invoice.paymentRef ?? "",
            provider: invoice.paymentProvider ?? "",
            expires_at: invoice.paymentLinkExpiredBy?.toISOString?.() ?? "",
        },

        created_at: invoice.createdAt?.toISOString?.() ?? "",
        updated_at: invoice.updatedAt?.toISOString?.() ?? "",
    };
}



function mapOrganizationSubscription(sub) {
    return {
        id: sub.id,
        organization_id: sub.organizationId,
        plan_id: sub.planId,
        plan_name: sub.plan?.name ?? '',
        status: sub.status,
        billing_interval: sub.billingInterval,
        price_at_purchase: sub.priceAtPurchase,
        start_date: sub.startDate?.toISOString(),
        end_date: sub.endDate?.toISOString() ?? '',
        trial_ends_at: sub.trialEndsAt?.toISOString() ?? '',
        cancel_at_period_end: sub.cancelAtPeriodEnd,
        cancelled_at: sub.cancelledAt?.toISOString() ?? '',
        plan: mapPlan(sub.plan),
        invoices: sub.invoices.length ? sub.invoices.map(mapInvoiceFull) : [],
    };
}
