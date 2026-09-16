import { sendRaw, verifyTransport, getFromAddress } from './transport.js';
import { otpHtml, generateWelcomeEmail, financeEnabledHtml, expenseRequestHtml, expenseStatusHtml } from './templates.js';

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

export async function sendWelcomeEmail(employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail) {
    try {
        const subject = `Welcome to ${companyName}!`;
        const text = `Welcome to ${companyName}!`;
        const html = generateWelcomeEmail({ employeeName, employeeEmail, accessLevel, loginUrl, companyName, supportEmail });
        return sendEmail(employeeEmail, subject, text, html);
    } catch (error) {
        console.log('sendWelcomeEmail failed (non-fatal):', error.message);
    }
}

export async function sendFinanceEnabledEmail(to) {
    try {
        const subject = 'Your Jury HRMS Finance is now enabled!';
        const text = 'Your Jury HRMS Finance is now enabled!';
        const html = financeEnabledHtml();
        return sendEmail(to, subject, text, html);
    } catch (error) {
        console.error("sendFinanceEnabledEmail failed:", error);
        throw error;
    }
}

export async function sendExpenseRaisedEmail(to, expense) {
    try {
        const subject = 'Expense Request Raised';
        const text = `
        An expense request has been raised.
        by ${expense.employee.fullName}
        `;
        const html = expenseRequestHtml(expense);
        return sendEmail(to, subject, text, html);
    } catch (error) {
        console.error("sendFinanceEnabledEmail failed:", error);
        throw error;
    }
}

export async function sendExpenseStatusEmail(to, expense) {
    try {
        const subject = `Expense Request ${expense.status}`;
        const text = `
        Your expense request has been ${expense.status}.
        `;
        const html = expenseStatusHtml(expense);
        return sendEmail(to, subject, text, html);
    } catch (error) {
        console.error("sendFinanceEnabledEmail failed:", error);
        throw error;
    }
}



export { verifyTransport, getFromAddress };
