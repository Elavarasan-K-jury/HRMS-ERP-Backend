import { grpc } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";
import { FileService } from "@jury-hrms/files";
import { RazorPayPayment } from "@jury-hrms/payments";
import { sendInvoiceEmail } from "@jury-hrms/mailer";
import { addDays } from "../utils/date.js";

/* ============================================================
   🟣 LIST INVOICES (ORG OPTIONAL + PAGINATION)
============================================================ */
export const ListInvoicesFunc = async (call, callback) => {
    try {
        const {
            organization_id,
            page,
            limit,
            search = "",
            sort_by = "createdAt",
            sort_order = "desc",
        } = call.request;

        let paginate = {}
        if (page && limit) {
            paginate = {
                skip: (page - 1) * limit,
                take: limit
            }
        }

        const where = {
            ...(search && {
                invoiceNumber: { contains: search, mode: "insensitive" },
            }),
            ...(organization_id && {
                subscription: {
                    organizationId: organization_id,
                },
            }),
        };
        const allowedSortFields = ["createdAt", "issuedAt", "amount"];

        let orderBy = undefined;

        if (allowedSortFields.includes(sort_by)) {
            orderBy = {
                [sort_by]: sort_order === "asc" ? "asc" : "desc",
            };
        } else {
            // default sort (SAFE)
            orderBy = { createdAt: "desc" };
        }

        const [total, invoices] = await Promise.all([
            prisma.invoices.count({ where }),
            prisma.invoices.findMany({
                where,
                ...paginate,
                orderBy,
                include: {
                    subscription: {
                        include: {
                            organization: true,
                            plan: true,
                        },
                    },
                },
            }),
        ]);

        return callback(null, {
            success: true,
            meta: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit),
            },
            data: invoices.map(mapInvoiceFull),
        });
    } catch (e) {
        console.error("ListInvoices Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

/* ============================================================
   🔵 GET INVOICE BY ID (ORG SAFE)
============================================================ */
export const GetInvoiceFunc = async (call, callback) => {
    try {
        const { id, organization_id } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Invoice id is required",
            });
        }

        const invoice = await prisma.invoices.findFirst({
            where: {
                id,
                ...(organization_id && {
                    subscription: {
                        organizationId: organization_id,
                    },
                }),
            },
            include: {
                subscription: {
                    include: {
                        organization: true,
                        plan: true,
                    },
                },
            },
        });

        if (!invoice) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Invoice not found",
            });
        }

        return callback(null, {
            success: true,
            data: mapInvoiceFull(invoice),
        });
    } catch (e) {
        console.error("GetInvoice Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

/* ============================================================
   🟢 MARK INVOICE AS PAID
============================================================ */
export const MarkInvoicePaidFunc = async (call, callback) => {
    try {
        const { id, payment_ref, payment_provider } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Invoice id is required",
            });
        }

        const invoice = await prisma.invoices.findUnique({
            where: { id },
            include: { subscription: true },
        });

        if (!invoice) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Invoice not found",
            });
        }

        if (invoice.status === "PAID") {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: "Invoice already paid",
            });
        }

        if (invoice.status === "CANCELLED") {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: "Cancelled invoice cannot be paid",
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.invoice.update({
                where: { id },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                    paymentRef: payment_ref ?? null,
                    paymentProvider: payment_provider ?? null,
                    paymentStatus: "SUCCESS",
                },
            });

            if (invoice.subscription?.status === "PAST_DUE") {
                await tx.organizationSubscriptions.update({
                    where: { id: invoice.subscriptionId },
                    data: { status: "ACTIVE" },
                });
            }
        });

        return callback(null, {
            success: true,
            message: "Invoice marked as paid successfully",
        });
    } catch (e) {
        console.error("MarkInvoicePaid Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

/* ============================================================
   🟠 DOWNLOAD INVOICE PDF
============================================================ */
export const DownloadInvoiceFunc = async (call, callback) => {
    try {
        const { id, organization_id } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Invoice id is required",
            });
        }

        const invoice = await prisma.invoices.findFirst({
            where: {
                id,
                ...(organization_id && {
                    subscription: {
                        organizationId: organization_id,
                    },
                }),
            },
            select: {
                invoiceNumber: true,
                invoiceKey: true,
            },
        });

        if (!invoice || !invoice.invoiceKey) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Invoice file not available",
            });
        }

        const buffer = await FileService.get(invoice.invoiceKey);

        return callback(null, {
            success: true,
            filename: `invoice-${invoice.invoiceNumber}.pdf`,
            mime_type: "application/pdf",
            data: buffer,
        });
    } catch (e) {
        console.error("DownloadInvoice Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

export const RegenerateInvoicePaymentLinkFunc = async (call, callback) => {
    try {
        const { invoice_id } = call.request;

        if (!invoice_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "invoice_id is required",
            });
        }

        const invoice = await prisma.invoices.findUnique({
            where: { id: invoice_id },
            include: {
                subscription: {
                    include: { organization: true, plan: true },
                },
            },
        });

        if (!invoice) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Invoice not found",
            });
        }

        if (["PAID", "CANCELLED"].includes(invoice.status)) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: `Cannot regenerate payment link for ${invoice.status} invoice`,
            });
        }

        if (!invoice.total || invoice.total <= 0) {
            return callback({
                code: grpc.status.FAILED_PRECONDITION,
                message: "Invalid invoice amount",
            });
        }

        const razorpay = new RazorPayPayment();

        /* 1️⃣ Create NEW Razorpay order */
        const order = await razorpay.createOrder(
            Math.round(invoice.total * 100),
            invoice.currency || "INR",
            invoice.invoiceNumber,
            true
        );

        /* 2️⃣ Create NEW payment link */
        const paymentLink = await razorpay.createPaymentLink(
            Math.round(invoice.total * 100),
            invoice.currency || "INR",
            {
                name: invoice.subscription.organization.contactPersonName,
                email:
                    invoice.subscription.organization.billingEmail ||
                    invoice.subscription.organization.email,
                contact:
                    invoice.subscription.organization.contactPersonNumber || "9999999999",
            },
            {
                invoiceId: invoice.id,
                subscriptionId: invoice.subscriptionId,
                regenerated: true,
            },
            `Invoice ${invoice.invoiceNumber}`,
            invoice.id
        );

        const paymentLinkExpiry =
            paymentLink.expire_by
                ? new Date(paymentLink.expire_by * 1000)
                : null;

        /* 3️⃣ Update invoice */
        const updated = await prisma.invoices.update({
            where: { id: invoice.id },
            data: {
                paymentOrderId: order.id,
                paymentLink: paymentLink.short_url,
                paymentProvider: "razorpay",
                paymentStatus: "PENDING",
                paymentLinkExpiredBy: paymentLinkExpiry,
                updatedAt: new Date(),
            },
            include: {
                subscription: {
                    include: { organization: true, plan: true },
                },
            },
        });



        /* 4️⃣ Optional email */
        const to =
            updated.subscription.organization.billingEmail ||
            updated.subscription.organization.email;

        if (!invoice?.invoiceUrl) {
            throw new Error("Invoice file not available");
        }

        const pdfBuffer = await FileService.get(invoice.invoiceUrl.replace('/uploads/', '/'));

        if (to) {
            sendInvoiceEmail({
                to,
                organizationName: updated.subscription.organization.name,
                invoiceNumber: updated.invoiceNumber,
                amount: updated.total.toFixed(2),
                billingPeriodStart: updated.billingPeriodStart.toISOString().slice(0, 10),
                billingPeriodEnd: updated.billingPeriodEnd.toISOString().slice(0, 10),
                dueDate: addDays(updated.billingPeriodStart, 7)
                    .toISOString()
                    .slice(0, 10),
                supportEmail: "support@jurysoft.com",
                paymentLink: paymentLink.short_url,
                pdfBuffer,
                paymentLinkExpiry,
            });
        }

        return callback(null, {
            success: true,
            message: "Payment link regenerated successfully",
            data: mapInvoiceFull(updated),
        });
    } catch (e) {
        console.error("RegenerateInvoicePaymentLink Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e?.message ?? "Internal error",
        });
    }
};

/* ============================================================
   🧭 FULL MAPPER (INVOICE + SUBSCRIPTION + ORG)
============================================================ */
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

        subscription: invoice.subscription
            ? {
                id: invoice.subscription.id,
                status: invoice.subscription.status,
                billing_interval: invoice.subscription.billingInterval,
                price_at_purchase: invoice.subscription.priceAtPurchase,
                plan: invoice.subscription.plan
                    ? {
                        id: invoice.subscription.plan.id,
                        name: invoice.subscription.plan.name,
                    }
                    : null,
            }
            : null,

        organization: invoice.subscription?.organization
            ? {
                ...invoice.subscription?.organization,
                address: JSON.stringify(invoice.subscription?.organization?.address)
            }
            : null,

        created_at: invoice.createdAt?.toISOString?.() ?? "",
        updated_at: invoice.updatedAt?.toISOString?.() ?? "",
    };
}

