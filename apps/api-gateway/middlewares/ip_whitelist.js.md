# ip_whitelist.js — IP Whitelist Middleware

## Purpose
Restricts API access to a configurable list of allowed IP addresses and/or domains, returning 403 for unauthorized requests.

## Key Components

### Configuration
Parses `ALLOWED_IPS` and `ALLOWED_DOMAINS` from environment, falling back to `127.0.0.1,::1` and `localhost`:

```js
const ALLOWED_IPS = (process.env.ALLOWED_IPS || '127.0.0.1,::1')
    .split(',').map((s) => s.trim()).filter(Boolean);
```

### IPv6 Handling
Strips the IPv4-mapped IPv6 prefix (`::ffff:`) for clean comparison:

```js
function stripIpv6Prefix(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
}
```

### IP Matching
Supports wildcard patterns (`192.168.0.*`) converted to regex, and exact matches:

```js
function matchIp(ip, pattern) {
    if (pattern.includes('*')) {
        const parts = pattern.split('.');
        const regexParts = parts.map((part) => {
            if (part === '*') return '\\d{1,3}';
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        const regex = new RegExp(`^${regexParts.join('\\.')}$`);
        return regex.test(ip);
    }
    return ip === pattern;
}
```

### Middleware
Checks the client IP from standard proxy headers (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) and the origin header:

```js
export async function ipWhitelist(c, next) {
    if (process.env.ENVIRONMENT === 'DEVELOPMENT') return next();

    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || /* ... */ '';
    const origin = c.req.header('origin') || c.req.header('host') || '';

    const isIpAllowed = ALLOWED_IPS.some((allowed) => matchIp(cleanIp, allowed));
    const isDomainAllowed = ALLOWED_DOMAINS.some((allowed) => origin.includes(allowed));

    if (!isIpAllowed && !isDomainAllowed) {
        return c.json({ error: 'Access Denied', message: '...' }, 403);
    }
    return next();
}
```

## Dependencies
- `dotenv` — Environment configuration loading

## Patterns
- **Skip in development**: Bypasses all checks when `ENVIRONMENT=DEVELOPMENT`.
- **Proxy-aware IP extraction**: Reads the client IP from standard reverse-proxy headers.
- **Wildcard IP patterns**: Supports CIDR-like wildcard matching via regex conversion.
