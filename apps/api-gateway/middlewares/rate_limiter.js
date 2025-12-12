import { getRedis, setJSON, getJSON } from '@jury-hrms/redis';
import DotEnv from 'dotenv';
DotEnv.config();

// 🧩 Config
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW || 60) * 1000;
const LIMIT = Number(process.env.RATE_LIMIT_MAX || 100);
const MAX_QUEUE = Number(process.env.REQUEST_QUEUE_LIMIT || 0);

// 🟥 Redis client
let redis;
try {
    redis = getRedis();
} catch (err) {
    console.warn('[rateLimiter] Redis not available, using in-memory fallback');
    redis = null;
}

// 🧠 In-memory fallback
const memoryStore = new Map();

export async function rateLimiter(c, next) {
    // Skip dev
    if (process.env.ENVIRONMENT === 'DEVELOPMENT') {
        return next();
    }
    // Skip docs
    if (c.req.path.startsWith('/swagger') || c.req.path.startsWith('/doc'))
        return next();

    const ip =
        c.req.header('x-forwarded-for') ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        'unknown';

    const key = `ratelimit:${ip}`;
    const now = Date.now();

    let record;
    let ttl = WINDOW_MS;

    /* ----------------------------------------------------------------
       REDIS HANDLING
    ---------------------------------------------------------------- */
    if (redis) {
        let data = await getJSON(key);

        // Ensure numbers (important fix)
        record = data
            ? {
                count: Number(data.count) || 0,
                startTime: Number(data.startTime) || now,
            }
            : { count: 0, startTime: now };

        const elapsed = now - record.startTime;

        if (elapsed > WINDOW_MS) {
            // reset sliding window
            record = { count: 1, startTime: now };
            ttl = WINDOW_MS;
        } else {
            record.count++;
            ttl = WINDOW_MS - elapsed;
        }

        await setJSON(key, record, Math.ceil(ttl / 1000));
    }

    /* ----------------------------------------------------------------
       MEMORY FALLBACK
    ---------------------------------------------------------------- */
    else {
        record = memoryStore.get(key) || { count: 0, startTime: now };

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

    /* ----------------------------------------------------------------
       OPTIONAL: REQUEST QUEUE CONTROL
    ---------------------------------------------------------------- */
    if (MAX_QUEUE > 0 && record.count > MAX_QUEUE) {
        return c.json(
            {
                error: 'Server overloaded',
                message: `Too many queued requests. Try again in ${Math.ceil(
                    ttl / 1000
                )} seconds.`,
            },
            503
        );
    }

    /* ----------------------------------------------------------------
       LIMIT CHECK
    ---------------------------------------------------------------- */
    if (record.count > LIMIT) {
        return c.json(
            {
                error: 'Rate limit exceeded',
                message: `Try again in ${Math.ceil(ttl / 1000)} second(s).`,
            },
            429
        );
    }

    return next();
}

/* ----------------------------------------------------------------
   Cleanup
---------------------------------------------------------------- */
process.on('exit', () => {
    if (redis) redis.quit();
});
