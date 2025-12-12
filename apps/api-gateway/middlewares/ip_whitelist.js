import DotEnv from 'dotenv';
DotEnv.config();

const ALLOWED_IPS = (process.env.ALLOWED_IPS || '127.0.0.1,::1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'localhost')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function stripIpv6Prefix(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
}

function matchIp(ip, pattern) {
    if (!ip || !pattern) return false;

    ip = stripIpv6Prefix(ip).trim();
    pattern = pattern.trim();

    // Wildcard like 192.168.0.*
    if (pattern.includes('*')) {
        const parts = pattern.split('.');
        const regexParts = parts.map((part) => {
            if (part === '*') return '\\d{1,3}'; // basic 0–255
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });

        const regex = new RegExp(`^${regexParts.join('\\.')}$`);
        return regex.test(ip);
    }

    // Exact match
    return ip === pattern;
}

export async function ipWhitelist(c, next) {
    // Skip dev
    if (process.env.ENVIRONMENT === 'DEVELOPMENT') {
        return next();
    }
    const ip =
        c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        c.req.raw?.remoteAddress ||
        '';

    const origin = c.req.header('origin') || c.req.header('host') || '';

    console.log(`[ipWhitelist] IP=${ip}, Origin=${origin}`);
    const cleanIp = stripIpv6Prefix(ip);

    const isIpAllowed = ALLOWED_IPS.some((allowed) => matchIp(cleanIp, allowed));
    const isDomainAllowed = ALLOWED_DOMAINS.some((allowed) =>
        origin.includes(allowed),
    );

    if (!isIpAllowed && !isDomainAllowed) {
        return c.json(
            {
                error: 'Access Denied',
                message: 'Your IP or domain is not allowed to access this API.',
            },
            403,
        );
    }

    return next();
}
