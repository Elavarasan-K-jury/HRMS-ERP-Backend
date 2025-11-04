import Redis from "ioredis";

let redisSingleton;

/**
 * Returns a shared Redis client.
 * Env vars:
 *   REDIS_URL=redis://127.0.0.1:6379
 *   REDIS_DB=0
 */
export function getRedis() {
    if (redisSingleton) return redisSingleton;

    const {
        REDIS_URL = "redis://127.0.0.1:6379",
        REDIS_DB = "0"
    } = process.env;

    const client = new Redis(REDIS_URL, {
        db: Number(REDIS_DB),
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 2000)
    });

    client.on("connect", () => console.log("[redis] connected"));
    client.on("error", (err) => console.error("[redis] error:", err));

    const shutdown = async () => {
        try {
            await client.quit();
            console.log("[redis] closed");
        } catch {
            await client.disconnect();
        }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    redisSingleton = client;
    return client;
}
