import { prisma } from "@jury-hrms/db/client.js";
import { addDays } from "../utils/date.js";
import { generateInvoiceNumber } from "../utils/invoiceNumber.js";
import { FileService } from "@jury-hrms/files";
import { generateInvoicePDF } from "../pdf/generateInvoicePDF.js";
import { sendInvoiceEmail } from "@jury-hrms/mailer";
import { RazorPayPayment } from "@jury-hrms/payments";

const BILLING_DAYS = {
    MONTHLY: 30,
    YEARLY: 365,
};

export async function generateInvoiceForSubscription({
    subscriptionId,
}) {
    const subscription = await prisma.organizationSubscriptions.findFirst({
        where: { id: subscriptionId },
        include: {
            plan: { include: { features: true } },
            organization: true,
        },
    });

    const cycleDays = BILLING_DAYS[subscription.billingInterval];
    const periodStart = subscription.startDate;

    const periodEnd = addDays(periodStart, cycleDays);
    const dueDate = addDays(periodStart, 7);

    /**
     * 🛑 Duplicate prevention (VERY IMPORTANT)
     */
    const existing = await prisma.invoices.findFirst({
        where: {
            subscriptionId: subscription.id,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            status: { not: "CANCELLED" },
        },
    });

    if (existing) {
        return existing;
    }

    const amount =
        subscription.billingInterval === "MONTHLY"
            ? subscription.plan.monthlyPrice
            : subscription.plan.yearlyPrice;

    if (!amount || amount <= 0) return null;

    /**
     * 1️⃣ Create Invoice
    */
    const invoice = await prisma.invoices.create({
        data: {
            subscriptionId: subscription.id,
            invoiceNumber: await generateInvoiceNumber(),
            amount,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            status: "ISSUED",
            issuedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        },
    });

    const gst = subscription.plan.gst ?? 18;
    const tax = (amount * gst) / 100;
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
            name: subscription.organization.contactPersonName,
            email:
                subscription.organization.billingEmail ||
                subscription.organization.email,
            contact: subscription.organization.contactPersonNumber || "9999999999",
        },
        {
            invoiceId: invoice.id,
            subscriptionId: subscription.id,
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
            total
        },
    });

    /**
     * 2️⃣ Generate PDF
     */
    const { pdfBuffer, buffer } = await generateInvoicePDF({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: dueDate.toISOString().slice(0, 10),
        isDraft: false,
        company: {
            name: "Jurysoft Global Pvt Ltd",
            website: "https://jurysoft.com",
        },
        customer: {
            name: subscription.organization.name,
            address: subscription.organization.address,
        },
        period: {
            start: periodStart.toISOString().slice(0, 10),
            end: periodEnd.toISOString().slice(0, 10),
        },
        items: [
            {
                description: subscription.plan.name,
                details: `${subscription.billingInterval} subscription`,
                qty: 1,
                amount: amount.toFixed(2),
            },
        ],
        totals: {
            subtotal: amount.toFixed(2),
            tax: tax.toFixed(2),
            total: total.toFixed(2),
        },
    });

    /**
     * 3️⃣ Upload PDF
     */
    const uploaded = await FileService.upload(
        pdfBuffer,
        `invoice-${invoice.invoiceNumber}.pdf`,
        "invoices"
    );

    await prisma.invoices.update({
        where: { id: invoice.id },
        data: {
            invoiceUrl: uploaded.url,
            invoiceKey: uploaded.key,
        },
    });

    /**
     * 4️⃣ Email Invoice
     */
    const to =
        subscription.organization.billingEmail ||
        subscription.organization.email;

    if (to) {
        sendInvoiceEmail({
            to,
            organizationName: subscription.organization.name,
            invoiceNumber: invoice.invoiceNumber,
            amount: total.toFixed(2),
            billingPeriodStart: periodStart.toISOString().slice(0, 10),
            billingPeriodEnd: periodEnd.toISOString().slice(0, 10),
            dueDate: dueDate.toISOString().slice(0, 10),
            pdfBuffer: buffer,
            supportEmail: "support@jurysoft.com",
            paymentLink: paymentLink.short_url,
            paymentLinkExpiredBy: paymentLinkExpiry, // 👈 PASS THIS
        });
    }

    return invoice;
}
