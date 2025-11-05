/**
 * IP & Domain Whitelist Middleware
 *
 * Allows only specific IPs or domains to access the API.
 * Returns 403 Forbidden for unauthorized origins.
 */

const ALLOWED_IPS = (process.env.ALLOWED_IPS || '127.0.0.1,::1').split(',').map(s => s.trim());
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'localhost').split(',').map(s => s.trim());

export async function ipWhitelist(c, next) {
    const ip =
        c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        c.req.raw?.remoteAddress ||
        'unknown';

    const origin = c.req.header('origin') || c.req.header('host') || '';

    const isIpAllowed = ALLOWED_IPS.some((allowed) => ip.includes(allowed));
    const isDomainAllowed = ALLOWED_DOMAINS.some((allowed) => origin.includes(allowed));

    if (!isIpAllowed && !isDomainAllowed) {
        // console.warn(`[ipWhitelist] Blocked request from IP=${ip}, Origin=${origin}`);
        return c.json(
            {
                error: 'Access Denied',
                message: 'Your IP or domain is not allowed to access this API.',
            },
            403
        );
    }

    return next();
}
