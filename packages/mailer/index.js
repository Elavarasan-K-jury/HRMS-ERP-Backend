import { sendRaw, verifyTransport, getFromAddress } from './transport.js';
import { otpHtml, generateOnboardingEmail, generateInvoiceEmail } from './templates.js';

export async function sendEmail(to, subject, text, html) {
    return sendRaw({ to, subject, text, html });
}

export async function sendOtpEmail(to, otp, ttlMinutes = 5) {
    try {
        const subject = 'Your Jury HRMS OTP';
        const text = `Your OTP is ${otp}. It expires in ${ttlMinutes} minutes.`;
        const html = otpHtml(otp, ttlMinutes);
        return sendEmail(to, subject, text, html);
    } catch (error) {
        console.log('index.js @ Line 29:', error);
    }
}

// employeeName
// employeeEmail
// accessLevel
// loginUrl
// companyName
// supportEmail

export async function sendOnboardEmail(employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail) {
    try {
        const subject = `Onboarded to ${companyName}!`;
        const text = `Welcome to ${companyName}!`;
        const html = generateOnboardingEmail({ employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail });
        return sendEmail(employeeEmail, subject, text, html);
    } catch (error) {
        console.log('index.js @ Line 29:', error);
    }
}

export async function sendInvoiceEmail({
    to,
    organizationName,
    invoiceNumber,
    amount,
    currency = "INR",
    billingPeriodStart,
    billingPeriodEnd,
    dueDate,
    pdfBuffer,
    supportEmail,
    paymentLink,
}) {
    try {
        const subject = `Invoice ${invoiceNumber} – Payment Due`;
        console.log("📎 Sending attachment:", {
            isBuffer: Buffer.isBuffer(pdfBuffer),
            size: pdfBuffer?.length,
        });
        // ✅ Ensure Buffer
        const buffer =
            Buffer.isBuffer(pdfBuffer)
                ? pdfBuffer
                : Buffer.from(pdfBuffer);
        const text = `
Invoice ${invoiceNumber}
Amount: ${amount} ${currency}
Billing Period: ${billingPeriodStart} - ${billingPeriodEnd}
Due Date: ${dueDate}
`;

        const html = generateInvoiceEmail({
            organizationName,
            invoiceNumber,
            amount,
            currency,
            billingPeriodStart,
            billingPeriodEnd,
            dueDate,
            supportEmail,
            paymentLink,
        });

        return sendRaw({
            to,
            subject,
            text,
            html,
            attachments: [
                {
                    filename: `invoice-${invoiceNumber}.pdf`,
                    content: buffer,
                    contentType: "application/pdf",
                },
            ],
        });
    } catch (error) {
        console.error("sendInvoiceEmail failed:", error);
        throw error;
    }
}

export { verifyTransport, getFromAddress };
