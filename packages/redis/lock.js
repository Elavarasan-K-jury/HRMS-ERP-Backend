import Redlock from "redlock";
import { getRedis } from "./client.js";

let redlock;

export function getLock() {
    if (redlock) return redlock;
    redlock = new Redlock([getRedis()], {
        retryCount: 10,
        retryDelay: 100,
        retryJitter: 50
    });
    redlock.on("error", (err) => console.warn("[redlock]", err?.message));
    return redlock;
}

/** Run a function with a distributed lock. */
export async function runWithLock(resource, ttlMs, fn) {
    const lock = await getLock().acquire([resource], ttlMs);
    try {
        return await fn();
    } finally {
        try {
            await lock.release();
        } catch { }
    }
}
