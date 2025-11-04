import rateLimit from 'hono-rate-limit';
import { getRedis } from '@jury-hrms/redis';

// 🧠 Try to initialize Redis client
let redis;
try {
    redis = getRedis();
} catch (err) {
    console.warn('[rateLimiter] Redis not available, falling back to in-memory store');
    redis = null;
}

// 🧩 Define Redis or in-memory store
const memoryStore = new Map();

const store = redis
    ? {
        // ---- Redis Store ---- //
        async get(key) {
            const raw = await redis.get(key);
            return raw ? JSON.parse(raw) : null;
        },

        async set(key, value, ttlMs) {
            // Redis TTL expects seconds
            await redis.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(value));
        },

        async reset(key) {
            await redis.del(key);
        },
    }
    : {
        // ---- Memory Fallback ---- //
        async get(key) {
            const data = memoryStore.get(key);
            if (!data) return null;
            if (Date.now() > data.expiry) {
                memoryStore.delete(key);
                return null;
            }
            return data.value;
        },

        async set(key, value, ttlMs) {
            memoryStore.set(key, {
                value,
                expiry: Date.now() + ttlMs,
            });
        },

        async reset(key) {
            memoryStore.delete(key);
        },
    };

// ⚙️ Configure Rate Limiter
export const rateLimiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW || 60) * 1000, // default 60 seconds
    limit: Number(process.env.RATE_LIMIT_MAX || 100), // default 100 requests per window
    keyGenerator: (c) =>
        c.req.header('x-forwarded-for') ||
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        c.req.header('x-client-ip') ||
        c.req.header('host') ||
        'unknown',

    store, // 🧱 use Redis or in-memory store

    message: (remaining, resetMs) =>
        `🚫 Rate limit exceeded. Try again in ${Math.ceil(resetMs / 1000)} seconds.`,
});
