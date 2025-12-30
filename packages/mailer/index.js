import { sendRaw, verifyTransport, getFromAddress } from './transport.js';
import { otpHtml, generateOnboardingEmail } from './templates.js';

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

export { verifyTransport, getFromAddress };
