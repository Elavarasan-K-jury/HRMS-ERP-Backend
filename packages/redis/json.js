import { getRedis } from "./client.js";

export async function setJSON(key, value, ttlSeconds) {
    const str = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
        return getRedis().set(key, str, "EX", ttlSeconds);
    }
    return getRedis().set(key, str);
}

export async function getJSON(key) {
    const data = await getRedis().get(key);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return data;
    }
}

export function del(key) {
    return getRedis().del(key);
}
