import { getRedis, setJSON, getJSON } from '@jury-hrms/redis';
import { prisma } from '@jury-hrms/db/client.js';
import DotEnv from 'dotenv';

DotEnv.config();

/* --------------------------------------------------
   CONFIG
-------------------------------------------------- */
const WINDOW_MS =
    Number(process.env.RATE_LIMIT_WINDOW || 60) * 1000;

const DEFAULT_LIMIT =
    Number(process.env.RATE_LIMIT_MAX || 100);

const MAX_QUEUE =
    Number(process.env.REQUEST_QUEUE_LIMIT || 0);

/* --------------------------------------------------
   REDIS CLIENT
-------------------------------------------------- */
let redis;
try {
    redis = getRedis();
} catch {
    console.warn(
        '[rateLimiter] Redis not available, using in-memory fallback'
    );
    redis = null;
}

/* --------------------------------------------------
   IN-MEMORY FALLBACK
-------------------------------------------------- */
const memoryStore = new Map();

/* --------------------------------------------------
   ORGANIZATION ID RESOLVER
-------------------------------------------------- */
const ORG_KEYS = [
    'organizationid',
    'organization_id',
    'orgid',
    'org_id',
    'xorganizationid',
    'xorganization-id',
    'xorgid',
    'xorg-id'
];

const normalizeKey = (k) =>
    String(k).toLowerCase().replace(/[_-]/g, '');

const cleanValue = (v) => {
    if (v == null) return null;
    if (Array.isArray(v)) v = v[0];
    const s = String(v).trim();
    return s.length ? s : null;
};

function findInObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    for (const [k, v] of Object.entries(obj)) {
        if (ORG_KEYS.includes(normalizeKey(k))) {
            const val = cleanValue(v);
            if (val) return val;
        }
    }
    return null;
}

async function resolveOrganizationId(c) {
    // 1️⃣ Headers
    const fromHeaders = findInObject({
        'x-organization-id': c.req.header('x-organization-id'),
        'x-org-id': c.req.header('x-org-id'),
        organizationId: c.req.header('organizationId'),
        organization_id: c.req.header('organization_id')
    });
    if (fromHeaders) return fromHeaders;

    // 2️⃣ Query params
    if (typeof c.req.query === 'function') {
        const q = findInObject(c.req.query());
        if (q) return q;
    }

    // 3️⃣ Route params
    if (typeof c.req.param === 'function') {
        const p = findInObject(c.req.param());
        if (p) return p;
    }

    // 4️⃣ JSON body
    try {
        const ct = c.req.header('content-type') || '';
        if (ct.includes('application/json')) {
            const body = await c.req.json();

            const direct = findInObject(body);
            if (direct) return direct;

            if (body.organization || body.org) {
                return (
                    findInObject(body.organization || body.org) ||
                    cleanValue((body.organization || body.org).id)
                );
            }
        }
    } catch {
        // ignore body parse errors
    }

    return null;
}

/* --------------------------------------------------
   RATE LIMITER MIDDLEWARE
-------------------------------------------------- */
export async function rateLimiter(c, next) {
    // Skip dev
    if (process.env.ENVIRONMENT === 'DEVELOPMENT') {
        return next();
    }

    // Skip docs
    if (
        c.req.path.startsWith('/swagger') ||
        c.req.path.startsWith('/doc')
    ) {
        return next();
    }

    const now = Date.now();

    /* ----------------------------------------------
       Resolve Organization
    ---------------------------------------------- */
    const organizationId = await resolveOrganizationId(c);

    console.log('rate_limiter.js @ Line 142:', organizationId);

    // Fallback to IP if org not found
    const ip =
        c.req.header('x-forwarded-for') ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        'unknown';

    const scopeKey = organizationId
        ? `org:${organizationId}`
        : `ip:${ip}`;

    const key = `ratelimit:${scopeKey}`;

    /* ----------------------------------------------
       Resolve Rate Limit
    ---------------------------------------------- */
    let LIMIT = DEFAULT_LIMIT;

    // Only look up per-org limits for well-formed ObjectIDs — Prisma throws
    // INTERNAL on malformed ids (raw 500 before the route handler runs).
    if (organizationId && /^[0-9a-fA-F]{24}$/.test(organizationId)) {
        const org = await prisma.organizations.findUnique({
            where: { id: organizationId },
            select: { maxApiRatePerMin: true }
        });

        if (org?.maxApiRatePerMin) {
            LIMIT = org.maxApiRatePerMin;
        }
    }

    let record;
    let ttl = WINDOW_MS;

    /* ----------------------------------------------
       REDIS HANDLING
    ---------------------------------------------- */
    if (redis) {
        const data = await getJSON(key);

        record = data
            ? {
                count: Number(data.count) || 0,
                startTime:
                    Number(data.startTime) || now
            }
            : { count: 0, startTime: now };

        const elapsed = now - record.startTime;

        if (elapsed > WINDOW_MS) {
            record = { count: 1, startTime: now };
            ttl = WINDOW_MS;
        } else {
            record.count++;
            ttl = WINDOW_MS - elapsed;
        }

        await setJSON(
            key,
            record,
            Math.ceil(ttl / 1000)
        );
    }

    /* ----------------------------------------------
       MEMORY FALLBACK
    ---------------------------------------------- */
    else {
        record =
            memoryStore.get(key) || {
                count: 0,
                startTime: now
            };

        const elapsed = now - record.startTime;

        if (elapsed > WINDOW_MS) {
            record = { count: 1, startTime: now };
            ttl = WINDOW_MS;
        } else {
            record.count++;
            ttl = WINDOW_MS - elapsed;
        }

        memoryStore.set(key, record);
    }

    /* ----------------------------------------------
       QUEUE CONTROL
    ---------------------------------------------- */
    if (MAX_QUEUE > 0 && record.count > MAX_QUEUE) {
        return c.json(
            {
                error: 'Server overloaded',
                message: `Too many queued requests. Try again in ${Math.ceil(
                    ttl / 1000
                )} seconds.`
            },
            503
        );
    }

    /* ----------------------------------------------
       LIMIT CHECK
    ---------------------------------------------- */
    if (record.count > LIMIT) {
        return c.json(
            {
                error: 'Rate limit exceeded',
                message: `Try again in ${Math.ceil(
                    ttl / 1000
                )} second(s).`,
                scope: organizationId
                    ? 'organization'
                    : 'ip'
            },
            429
        );
    }

    return next();
}

/* --------------------------------------------------
   CLEANUP
-------------------------------------------------- */
process.on('exit', () => {
    if (redis) redis.quit();
});
