import { sendRaw, verifyTransport, getFromAddress } from './transport.js';
import { otpHtml } from './templates.js';

export async function sendEmail(to, subject, text, html) {
    return sendRaw({ to, subject, text, html });
}

export async function sendOtpEmail(to, otp, ttlMinutes = 5) {
    const subject = 'Your Jury HRMS OTP';
    const text = `Your OTP is ${otp}. It expires in ${ttlMinutes} minutes.`;
    const html = otpHtml(otp, ttlMinutes);
    return sendEmail(to, subject, text, html);
}

export { verifyTransport, getFromAddress };
