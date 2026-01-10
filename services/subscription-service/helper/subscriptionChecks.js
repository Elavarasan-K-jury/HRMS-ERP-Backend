import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

/**
 * Ensures an organization does NOT already have a live subscription.
 *
 * Blocks: TRIAL, ACTIVE, PAST_DUE, SUSPENDED
 * Allows: CANCELLED, EXPIRED
 *
 * @param {string} organizationId
 * @param {{ allowIfCancelAtPeriodEnd?: boolean }} options
 */
export async function ensureNoActiveSubscription(
    organizationId,
    options = {}
) {
    const { allowIfCancelAtPeriodEnd = false } = options;

    if (!organizationId) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'organizationId is required',
        };
    }

    const existing = await prisma.organizationSubscriptions.findFirst({
        where: { organizationId },
        orderBy: { ['createdAt']: 'desc' },
        select: {
            id: true,
            status: true,
            cancelAtPeriodEnd: true,
            endDate: true,
            trialEndsAt: true,
        },
    });

    if (!existing) return;

    const paidForTheInvoice = await prisma.invoices.findFirst({
        where: {
            subscriptionId: existing.id,
            paymentStatus: 'SUCCESS'
        }
    })

    if (!paidForTheInvoice) return;

    const blockingStatuses = new Set([
        'TRIAL',
        'ACTIVE',
        'PAST_DUE',
        'SUSPENDED',
    ]);

    // If the subscription is still "live", block
    if (blockingStatuses.has(existing.status)) {
        // Optional: allow creating a new subscription if current is set to cancel at period end
        if (allowIfCancelAtPeriodEnd && existing.cancelAtPeriodEnd) {
            return;
        }

        throw {
            code: grpc.status.ALREADY_EXISTS,
            message: `Organization already has an active subscription (status: ${existing.status})`,
        };
    }

    // CANCELLED / EXPIRED => allowed
}
