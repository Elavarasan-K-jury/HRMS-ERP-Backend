import { getJSON, setJSON } from "./json.js";

/**
 * cache(key, ttlSeconds, loaderFn)
 *   -> returns cached data or loads + stores
 */
export async function cache(key, ttlSeconds, loaderFn) {
    const cached = await getJSON(key);
    if (cached !== null) return cached;
    const data = await loaderFn();
    await setJSON(key, data, ttlSeconds);
    return data;
}
