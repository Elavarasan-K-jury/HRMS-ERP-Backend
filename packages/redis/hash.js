import { getRedis } from "./client.js";

export async function hsetObject(key, obj = {}) {
    const flat = [];
    for (const [field, value] of Object.entries(obj)) {
        const val =
            typeof value === "string" || typeof value === "number" || value == null
                ? String(value ?? "")
                : JSON.stringify(value);
        flat.push(field, val);
    }
    return getRedis().hset(key, ...flat);
}

export async function hgetObject(key) {
    const res = await getRedis().hgetall(key);
    const parsed = {};
    for (const [field, value] of Object.entries(res)) {
        if (!value) continue;
        try {
            parsed[field] = JSON.parse(value);
        } catch {
            parsed[field] = value;
        }
    }
    return parsed;
}

export function hdel(key, ...fields) {
    return getRedis().hdel(key, ...fields);
}

export function expire(key, seconds) {
    return getRedis().expire(key, seconds);
}
