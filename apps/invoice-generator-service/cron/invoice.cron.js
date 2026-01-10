import cron from "node-cron";
import { prisma } from "@jury-hrms/db/client.js";
import { addDays, daysBetween } from "../utils/date.js";
import { generateInvoiceNumber } from "../utils/invoiceNumber.js";
import { InvoicePdfService } from "../services/invoicePdf.service.js";
import { getOrgUsageSummary } from "../utils/usage.js";
import { generateInvoicePDF } from "../pdf/generateInvoicePDF.js";
import { sendInvoiceEmail } from "@jury-hrms/mailer";
import { RazorPayPayment } from "@jury-hrms/payments";

const BILLING_DAYS = {
    MONTHLY: 30,
    YEARLY: 365,
};

function getPlanLimit(plan, key) {
    const f = plan?.features?.find((x) => x.key === key);
    if (!f || f.isUnlimited) return null;
    return typeof f.value === "number" ? f.value : null;
}

cron.schedule("0 2 * * *", async () => {
    console.log("🧾 Invoice cron started");
    const now = new Date();

    /**
     * 0️⃣ Auto mark PAST_DUE
     */
    await prisma.organizationSubscriptions.updateMany({
        where: {
            status: "ACTIVE",
            invoices: {
                some: {
                    status: { in: ["ISSUED", "FAILED"] },
                    billingPeriodEnd: { lt: now },
                },
            },
        },
        data: { status: "PAST_DUE" },
    });

    /**
     * 1️⃣ Fetch ACTIVE subscriptions
     */
    const subscriptions = await prisma.organizationSubscriptions.findMany({
        where: { status: "ACTIVE" },
        include: {
            plan: { include: { features: true } },
            organization: true,
        },
    });

    for (const sub of subscriptions) {
        const cycleDays = BILLING_DAYS[sub.billingInterval];
        const periodStart = sub.startDate;
        const periodEnd = addDays(periodStart, cycleDays);
        const dueDate = addDays(periodStart, 7);
        const daysLeft = daysBetween(now, periodEnd);

        if (daysLeft > 7 || daysLeft < 0) continue;

        const amount =
            sub.billingInterval === "MONTHLY"
                ? sub.plan.monthlyPrice
                : sub.plan.yearlyPrice;

        if (!amount) continue;

        /**
         * 2️⃣ Duplicate prevention
         */
        const existingInvoice = await prisma.invoices.findFirst({
            where: {
                subscriptionId: sub.id,
                billingPeriodStart: periodStart,
                billingPeriodEnd: periodEnd,
                status: { not: "CANCELLED" },
            },
        });

        if (existingInvoice) continue;

        /**
         * 3️⃣ Aggregate usage
         */
        const usageSummary = await getOrgUsageSummary({
            organizationId: sub.organizationId,
            periodStart,
            periodEnd,
        });

        const apiLimit = getPlanLimit(sub.plan, "api_requests");
        const exceeded =
            apiLimit != null && usageSummary.totalUsageCount > apiLimit;

        /**
         * 4️⃣ Store usage snapshot
         */
        await prisma.subscriptionUsageSnapshot.create({
            data: {
                subscriptionId: sub.id,
                periodStart,
                periodEnd,
                metricKey: "api_requests",
                usedValue: usageSummary.totalUsageCount,
                limitValue: apiLimit,
                isExceeded: exceeded,
            },
        });

        /**
         * 5️⃣ Create invoice
         */
        const invoice = await prisma.invoices.create({
            data: {
                subscriptionId: sub.id,
                invoiceNumber: await generateInvoiceNumber(),
                amount,
                billingPeriodStart: periodStart,
                billingPeriodEnd: periodEnd,
                status: "ISSUED",
                issuedAt: now,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            },
        });

        const tax = (amount * (sub.plan.gst ?? 18)) / 100;
        const total = amount + tax;

        const razorpay = new RazorPayPayment();

        /**
         * 2️⃣ Create Razorpay Order
         */
        const order = await razorpay.createOrder(
            Math.round(total * 100), // Razorpay expects paise
            "INR",
            invoice.invoiceNumber,
            true
        );

        /**
         * 3️⃣ Create Payment Link
         */

        const paymentLink = await razorpay.createPaymentLink(
            Math.round(total * 100),
            "INR",
            {
                name: sub.organization.contactPersonName,
                email:
                    sub.organization.billingEmail ||
                    sub.organization.email,
                contact: sub.organization.contactPersonNumber || "9999999999",
            },
            {
                invoiceId: invoice.id,
                subscriptionId: sub.id,
            },
            `Invoice ${invoice.invoiceNumber}`,
            invoice.id
        );

        const paymentLinkExpiry =
            paymentLink.expire_by
                ? new Date(paymentLink.expire_by * 1000) // Razorpay gives seconds
                : null;

        /**
         * 3️⃣ Updating in DB
         */
        await prisma.invoices.update({
            where: { id: invoice.id },
            data: {
                paymentOrderId: order.id,
                paymentLink: paymentLink.short_url,
                paymentProvider: "razorpay",
                paymentStatus: "PENDING",
                paymentLinkExpiredBy: paymentLinkExpiry,
                tax,
                total,
            },
        });

        /**
         * 6️⃣ Invoice items
         */
        const items = [
            {
                description: sub.plan.name,
                details: `${sub.billingInterval} subscription`,
                qty: 1,
                amount: amount.toFixed(2),
            },
        ];

        /**
         * 7️⃣ Generate PDF BUFFER (single source of truth)
         */
        const pdfBuffer = await generateInvoicePDF({
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: now.toISOString().slice(0, 10),
            dueDate: dueDate.toISOString().slice(0, 10),
            isDraft: false,
            company: {
                name: "Jurysoft Global Pvt Ltd",
                website: "https://jurysoft.com",
            },
            customer: {
                name: sub.organization.name,
                address: sub.organization.address,
            },
            period: {
                start: periodStart.toISOString().slice(0, 10),
                end: periodEnd.toISOString().slice(0, 10),
            },
            items,
            totals: {
                subtotal: amount.toFixed(2),
                tax: tax.toFixed(2),
                total: total.toFixed(2),
            },
            usageSummary,
        });

        /**
         * 8️⃣ Upload PDF
         */
        const uploaded = await InvoicePdfService.generateAndUpload({
            invoice,
            organization: sub.organization,
            items,
            totals: {
                subtotal: amount.toFixed(2),
                tax: tax.toFixed(2),
                total: total.toFixed(2),
            },
            usageSummary,
            pdfBuffer,
        });

        await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                invoiceUrl: uploaded.url,
                invoiceKey: uploaded.key,
            },
        });

        /**
         * 9️⃣ Send invoice email WITH ATTACHMENT
         */
        const to =
            sub.organization.billingEmail || sub.organization.email;

        if (to) {
            await sendInvoiceEmail({
                to,
                organizationName: sub.organization.name,
                invoiceNumber: invoice.invoiceNumber,
                amount: total.toFixed(2),
                billingPeriodStart: periodStart.toISOString().slice(0, 10),
                billingPeriodEnd: periodEnd.toISOString().slice(0, 10),
                dueDate: dueDate.toISOString().slice(0, 10),
                pdfBuffer,
                supportEmail: "support@jurysoft.com",
                paymentLink: paymentLink.short_url,
                paymentLinkExpiredBy: paymentLinkExpiry, // 👈 PASS THIS
            });
        }

        console.log(`✅ Invoice created & emailed for org ${sub.organizationId}`);
    }
});
