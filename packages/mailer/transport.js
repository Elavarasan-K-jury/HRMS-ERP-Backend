import nodemailer from 'nodemailer';

const MAIL_HOST = process.env.SMTP_HOST;
const MAIL_PORT = Number(process.env.SMTP_PORT || 587);
const MAIL_USER = process.env.SMTP_USER;
const MAIL_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || 'Jury HRMS <noreply@juryhrms.com>';
const MAIL_POOL = process.env.SMTP_POOL !== 'false'; // default: true

// In dev (no creds), we fallback to console-logging emails.
const hasCreds = MAIL_HOST && MAIL_USER && MAIL_PASS;

let transporter;
if (hasCreds) {
    transporter = nodemailer.createTransport({
        host: MAIL_HOST,
        port: MAIL_PORT,
        secure: MAIL_PORT === 465, // true for 465, false for 587/25/2525
        auth: { user: MAIL_USER, pass: MAIL_PASS },
        pool: MAIL_POOL, // enable connection pooling by default
        maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 5),
        maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
    });
} else {
    transporter = null;
    console.warn('[mailer] No SMTP creds found, falling back to console output.');
}

export function getFromAddress() {
    return MAIL_FROM;
}

export async function sendRaw({ to, subject, text, html }) {
    if (!to) throw new Error('sendRaw: "to" is required');

    if (!hasCreds) {
        console.log('📧 [dev mailer fallback]');
        console.log('To     :', to);
        console.log('Subject:', subject);
        if (text) console.log('Text   :', text);
        if (html) console.log('HTML   :\n', html);
        return { messageId: 'dev-fallback', accepted: [to] };
    }

    const info = await transporter.sendMail({
        from: getFromAddress(),
        to,
        subject,
        text,
        html,
    });

    return info;
}

// Optional: quick health check for transporter
export async function verifyTransport() {
    if (!hasCreds) return { ok: false, reason: 'no-credentials' };
    try {
        await transporter.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}
