import { getRedis, setJSON, getJSON } from '@jury-hrms/redis';

// 🧩 Config
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW || 60) * 1000; // 60s
const LIMIT = Number(process.env.RATE_LIMIT_MAX || 100); // 100 requests

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

// 🧱 Main Middleware
export async function rateLimiter(c, next) {
    // Skip Swagger/docs requests
    if (c.req.path.startsWith('/swagger') || c.req.path.startsWith('/doc')) {
        return next();
    }

    const ip =
        c.req.header('x-forwarded-for') ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        'unknown';

    const key = `ratelimit:${ip}`;
    const now = Date.now();

    let record;
    let ttl = WINDOW_MS;

    if (redis) {
        // --- Redis-based limiter using getJSON/setJSON ---
        const data = await getJSON(key);
        record = data || { count: 0, startTime: now };

        if (now - record.startTime > WINDOW_MS) {
            record = { count: 1, startTime: now };
        } else {
            record.count++;
        }

        ttl = WINDOW_MS - (now - record.startTime);

        // store JSON with TTL (in seconds)
        await setJSON(key, record, Math.ceil(ttl / 1000));
    } else {
        // --- Memory fallback ---
        record = memoryStore.get(key) || { count: 0, startTime: now };
        if (now - record.startTime > WINDOW_MS) {
            record = { count: 1, startTime: now };
        } else {
            record.count++;
        }
        ttl = WINDOW_MS - (now - record.startTime);
        memoryStore.set(key, record);
    }

    // 🚫 Exceeded limit
    if (record.count > LIMIT) {
        return c.json(
            {
                error: 'Rate limit exceeded',
                message: `Try again in ${Math.ceil(ttl / 1000)} seconds.`,
            },
            429
        );
    }

    // ✅ Allowed
    return next();
}

// 🧩 Cleanup on exit
process.on('exit', () => {
    if (redis) {
        redis.quit();
    }
});
