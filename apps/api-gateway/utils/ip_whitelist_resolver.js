import { prisma } from "@jury-hrms/db/client.js";
import { getJSON, setJSON, del } from "@jury-hrms/redis";
import { normalizeAddress, classifyIp } from "./client_ip.js";

/**
 * Organization IP whitelist resolver (Phase 3B) - RESOLVER/POLICY layer only.
 *
 * This module does NOT enforce anything. It has no HTTP knowledge, reads no
 * request headers, and must not be imported by server.js or any middleware
 * until Phase 3C (gateway enforcement).
 *
 * Layering (Phase 3A -> 3B):
 *   resolveClientIp(c)                       utils/client_ip.js   (socket-first, trusted hops)
 *        -> clientIp
 *   resolveOrganizationIpPolicy({ organizationId, clientIp })
 *        -> NO_ACTIVE_WHITELIST | ALLOWED | DENIED | UNRESOLVABLE_IP
 *
 * Active whitelist = OrganizationIpNetwork rows with:
 *   organizationId = caller-supplied id AND deletedAt = null AND isEnabled = true
 *
 * Policy semantics:
 *   - NO_ACTIVE_WHITELIST (zero active rows) => allow semantics (no restriction)
 *   - active rows + matching client IPv4     => ALLOWED
 *   - active rows + non-matching IPv4        => DENIED
 *   - active rows + null/invalid/IPv6 client => UNRESOLVABLE_IP (never ALLOWED)
 *   - DB lookup failure                      => throws IpPolicyLookupError
 *     (IP_POLICY_LOOKUP_FAILED - NEVER mapped to NO_ACTIVE_WHITELIST)
 *   - malformed active records are skipped for matching but the whitelist
 *     stays ON: an active-but-all-malformed configuration yields DENIED,
 *     never NO_ACTIVE_WHITELIST.
 *
 * IPv4 matching is numeric (never lexical). Phase 3B is IPv4-only: native
 * IPv6 client IPs are UNRESOLVABLE_IP while a whitelist is active
 * (IPv4-mapped IPv6 is already normalized to IPv4 by Phase 3A).
 *
 * Redis caching (Phase 3E): the loader layer caches ONLY the organization's
 * active configuration rows (minimum fields: id, ipType, fromIp, toIp) under
 * an organization-scoped key `ipwhitelist:{organizationId}` with a short TTL
 * (IP_WHITELIST_CACHE_TTL, default 60s). Final ALLOWED/DENIED decisions are
 * NEVER cached - policy evaluation always runs here over the loaded rows.
 * Redis is an optimization only: any Redis failure/timeout/corruption falls
 * back to Prisma and is NEVER interpreted as NO_ACTIVE_WHITELIST. The empty
 * active set ([]) is cached too, so no-whitelist organizations skip the DB
 * query on cache hits while still producing NO_ACTIVE_WHITELIST.
 * Invalidation happens at the CRUD mutation point (ip_network.routes.js)
 * via invalidateIpWhitelistCache(); TTL is the safety net when invalidation
 * fails.
 */

export const IP_POLICY_STATUS = Object.freeze({
    NO_ACTIVE_WHITELIST: "NO_ACTIVE_WHITELIST",
    ALLOWED: "ALLOWED",
    DENIED: "DENIED",
    UNRESOLVABLE_IP: "UNRESOLVABLE_IP",
});

export const IP_POLICY_ERROR_CODES = Object.freeze({
    INVALID_ORGANIZATION_ID: "INVALID_ORGANIZATION_ID",
    IP_POLICY_LOOKUP_FAILED: "IP_POLICY_LOOKUP_FAILED",
});

export class IpPolicyLookupError extends Error {
    constructor(code, message, options) {
        super(message, options);
        this.name = "IpPolicyLookupError";
        this.code = code;
    }
}

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/* ---------------------------------------------------------------------------
 * Redis configuration cache (Phase 3E)
 *
 * Key:    ipwhitelist:{organizationId}   (organization-scoped; never global,
 *                                         never user/IP-scoped)
 * Value:  [{ id, ipType, fromIp, toIp }] (minimum rows for policy evaluation)
 * TTL:    IP_WHITELIST_CACHE_TTL seconds (default 60; read per call like
 *         TRUSTED_PROXY_HOPS in client_ip.js)
 * Failure: any Redis error/timeout/corrupt payload -> fall back to Prisma.
 *          Redis failure is NEVER NO_ACTIVE_WHITELIST and never fails open.
 * ------------------------------------------------------------------------- */
const IP_WHITELIST_CACHE_PREFIX = "ipwhitelist";
const IP_WHITELIST_CACHE_DEFAULT_TTL_SECONDS = 60;
const IP_WHITELIST_CACHE_DEFAULT_TIMEOUT_MS = 300;

function cacheTtlSeconds() {
    const raw = Number(process.env.IP_WHITELIST_CACHE_TTL);
    if (!Number.isFinite(raw) || raw <= 0) return IP_WHITELIST_CACHE_DEFAULT_TTL_SECONDS;
    return Math.floor(raw);
}

function cacheTimeoutMs() {
    const raw = Number(process.env.IP_WHITELIST_CACHE_TIMEOUT_MS);
    if (!Number.isFinite(raw) || raw <= 0) return IP_WHITELIST_CACHE_DEFAULT_TIMEOUT_MS;
    return Math.floor(raw);
}

/** Organization-scoped cache key. */
export function ipWhitelistCacheKey(organizationId) {
    return `${IP_WHITELIST_CACHE_PREFIX}:${organizationId}`;
}

/**
 * Bounds a Redis command so an unavailable/timing-out Redis degrades to a
 * Prisma fallback instead of hanging the request path.
 */
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
        Promise.resolve(promise).then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/**
 * Cache payload validation (E7). Only structural validation: the payload must
 * be an array of objects. Field-level semantics stay with Phase 3B's
 * rowBounds/evaluateIpPolicy (malformed rows are counted, never dropped to
 * an empty whitelist). A non-array / non-object payload is corrupt: discard
 * it and reload from Prisma - never interpret it as no whitelist.
 */
function isUsableCachedPayload(value) {
    if (!Array.isArray(value)) return false;
    return value.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry));
}

/**
 * Best-effort invalidation at the CRUD mutation point (Phase 3F).
 * Failure is logged and swallowed: the DB mutation is never rolled back and
 * TTL expiry remains the recovery path.
 *
 * @returns {Promise<boolean>} true when the delete was issued successfully.
 */
export async function invalidateIpWhitelistCache(organizationId) {
    if (typeof organizationId !== "string" || !OBJECT_ID_REGEX.test(organizationId)) {
        return false;
    }
    try {
        await withTimeout(
            del(ipWhitelistCacheKey(organizationId)),
            cacheTimeoutMs(),
            "ip-whitelist cache invalidate"
        );
        return true;
    } catch (err) {
        console.error(
            `[ip-whitelist-cache] invalidation failed (key=${ipWhitelistCacheKey(organizationId)}): ${
                err?.message || "unknown"
            }`
        );
        return false;
    }
}

/**
 * Strict dotted-quad IPv4 -> unsigned 32-bit number (numeric comparison
 * convention shared with ip_network.routes.js / organization-service).
 * Returns null for anything that is not a valid IPv4 string. Never uses
 * lexical comparison.
 */
export function ipv4ToInt(ip) {
    if (typeof ip !== "string") return null;
    const text = ip.trim();
    if (!IPV4_REGEX.test(text)) return null;
    const parts = text.split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
        value = value * 256 + octet;
    }
    return value;
}

/**
 * Extracts inclusive numeric bounds [lo, hi] from a whitelist row.
 * Returns null for malformed rows (invalid fromIp, RANGE without/with
 * invalid toIp, inverted range, unsupported ipType, non-object row).
 * SINGLE ignores toIp; RANGE is inclusive on both ends.
 */
function rowBounds(row) {
    if (!row || typeof row !== "object") return null;
    const lo = ipv4ToInt(row.fromIp);
    if (lo === null) return null;
    if (row.ipType === "SINGLE") return { lo, hi: lo };
    if (row.ipType === "RANGE") {
        const hi = ipv4ToInt(row.toIp);
        if (hi === null || hi < lo) return null;
        return { lo, hi };
    }
    return null;
}

/**
 * Pure policy evaluation over already-loaded active rows. No DB, no request
 * context, no headers. `networks` must already be filtered to
 * organizationId + deletedAt=null + isEnabled=true by the loader.
 */
export function evaluateIpPolicy({ organizationId, clientIp, networks }) {
    const active = Array.isArray(networks) ? networks : [];
    const activeNetworkCount = active.length;

    const rules = [];
    let malformedNetworkCount = 0;
    for (const row of active) {
        const bounds = rowBounds(row);
        if (bounds === null) malformedNetworkCount += 1;
        else rules.push({ id: typeof row.id === "string" ? row.id : null, ...bounds });
    }

    const normalizedIp = normalizeAddress(clientIp);
    const base = {
        organizationId: organizationId ?? null,
        clientIp: normalizedIp,
        matchedNetworkId: null,
        activeNetworkCount,
        malformedNetworkCount,
    };

    // Case A: no active whitelist => allow semantics (IP restriction off).
    if (activeNetworkCount === 0) {
        return { status: IP_POLICY_STATUS.NO_ACTIVE_WHITELIST, ...base };
    }

    // Case D: whitelist active but client IP unusable for IPv4 matching
    // (null / garbage / native IPv6). Never ALLOWED. Malformed records did
    // not turn the whitelist off, so this is still a restrictive state.
    if (normalizedIp === null || classifyIp(normalizedIp) !== "IPv4") {
        return { status: IP_POLICY_STATUS.UNRESOLVABLE_IP, ...base };
    }

    const clientInt = ipv4ToInt(normalizedIp);
    if (clientInt === null) {
        return { status: IP_POLICY_STATUS.UNRESOLVABLE_IP, ...base };
    }

    // Cases B/C: numeric, inclusive matching over every valid rule.
    for (const rule of rules) {
        if (clientInt >= rule.lo && clientInt <= rule.hi) {
            return { status: IP_POLICY_STATUS.ALLOWED, ...base, matchedNetworkId: rule.id };
        }
    }

    // No match (and an all-malformed active configuration lands here too:
    // malformed active config must never degrade to NO_ACTIVE_WHITELIST).
    return { status: IP_POLICY_STATUS.DENIED, ...base };
}

/**
 * Default loader with the Phase 3E Redis configuration cache in front of the
 * database:
 *
 *   cache HIT (array, incl. [])  -> evaluate policy (no Prisma query)
 *   cache MISS / Redis failure
 *     / corrupt payload          -> single indexed Prisma query, then a
 *                                   best-effort cache store
 *
 * Prisma failures still throw IpPolicyLookupError (503 semantics) exactly as
 * before - only the read path is optimized, never the failure semantics.
 */
async function loadActiveNetworks(organizationId) {
    const cacheKey = ipWhitelistCacheKey(organizationId);

    let cached = null;
    try {
        cached = await withTimeout(getJSON(cacheKey), cacheTimeoutMs(), "ip-whitelist cache read");
    } catch (err) {
        // Redis unavailable / timing out / malformed -> fall through to Prisma.
        // Never treated as NO_ACTIVE_WHITELIST; never fails the request alone.
        console.warn(
            `[ip-whitelist-cache] read fallback to Prisma (${err?.message || "unknown"})`
        );
        cached = null;
    }
    if (isUsableCachedPayload(cached)) {
        return cached; // HIT - [] is a valid cached value (no active whitelist)
    }

    let rows;
    try {
        rows = await prisma.organizationIpNetwork.findMany({
            where: { organizationId, deletedAt: null, isEnabled: true },
            select: { id: true, ipType: true, fromIp: true, toIp: true },
        });
    } catch (cause) {
        // DB failure: controlled lookup error (never cached, never NO_ACTIVE).
        throw new IpPolicyLookupError(
            IP_POLICY_ERROR_CODES.IP_POLICY_LOOKUP_FAILED,
            "Failed to load organization IP whitelist configuration",
            { cause }
        );
    }

    try {
        await withTimeout(
            setJSON(cacheKey, rows, cacheTtlSeconds()),
            cacheTimeoutMs(),
            "ip-whitelist cache write"
        );
    } catch (err) {
        // Best-effort: a failed store must never fail the request; TTL on an
        // existing entry (or the next successful store) keeps things fresh.
        console.warn(
            `[ip-whitelist-cache] store skipped (${err?.message || "unknown"})`
        );
    }
    return rows;
}

/**
 * Public async resolver.
 *
 * @param {object} input
 * @param {string} input.organizationId - already-resolved trusted organization id
 *                                        (NOT taken from request headers here;
 *                                        Phase 3C obtains it from the auth principal)
 * @param {string|null} [input.clientIp] - result of resolveClientIp(c)
 * @param {Function} [input.loadActiveNetworks] - injectable loader (tests only)
 * @returns {Promise<{status: string, organizationId: string|null,
 *   clientIp: string|null, matchedNetworkId: string|null,
 *   activeNetworkCount: number, malformedNetworkCount: number}>}
 * @throws {IpPolicyLookupError} INVALID_ORGANIZATION_ID (missing/malformed id)
 *                               or IP_POLICY_LOOKUP_FAILED (DB/loader failure -
 *                               deliberately distinct from NO_ACTIVE_WHITELIST)
 */
export async function resolveOrganizationIpPolicy({ organizationId, clientIp, loadActiveNetworks: loader } = {}) {
    if (typeof organizationId !== "string" || !OBJECT_ID_REGEX.test(organizationId)) {
        throw new IpPolicyLookupError(
            IP_POLICY_ERROR_CODES.INVALID_ORGANIZATION_ID,
            "A valid organizationId is required to resolve the IP policy"
        );
    }

    const load = typeof loader === "function" ? loader : loadActiveNetworks;
    let networks;
    try {
        networks = await load(organizationId);
    } catch (cause) {
        if (cause instanceof IpPolicyLookupError) throw cause;
        throw new IpPolicyLookupError(
            IP_POLICY_ERROR_CODES.IP_POLICY_LOOKUP_FAILED,
            "Failed to load organization IP whitelist configuration",
            { cause }
        );
    }

    // Loader contract: must return an array. A non-array result is an
    // infrastructure/contract failure, NOT evidence of an empty whitelist.
    if (!Array.isArray(networks)) {
        throw new IpPolicyLookupError(
            IP_POLICY_ERROR_CODES.IP_POLICY_LOOKUP_FAILED,
            "IP whitelist loader returned an invalid result"
        );
    }

    return evaluateIpPolicy({ organizationId, clientIp, networks });
}
