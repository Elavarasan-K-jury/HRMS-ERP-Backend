import { randomUUID } from "crypto";

/* ----------------------------------------
   CONFIG
---------------------------------------- */
const IGNORE_PATHS = [
    "/swagger",
    "/doc",
    "/favicon.ico",
    "/health",
    "/metrics"
];

const IGNORE_METHODS = ["OPTIONS"];

// 1 = log all, 10 = log 1 in 10 (sampling)
const SAMPLE_RATE = Number(process.env.TRAFFIC_SAMPLE_RATE || 1);
const INSTANCE_ID = process.env.INSTANCE_ID || null;

/* ----------------------------------------
   HELPERS
---------------------------------------- */
function getIp(c) {
    return (
        c.req.header("cf-connecting-ip") ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip") ||
        null
    );
}

function normalizeRoute(path) {
    return path
        .replace(/\/\d+/g, "/:id")
        .replace(/\/[a-f0-9]{24}/gi, "/:id")
        .replace(/\/[a-f0-9-]{36}/gi, "/:uuid");
}

function classifyStatus(code) {
    if (code >= 500) return "5xx";
    if (code >= 400) return "4xx";
    if (code >= 300) return "3xx";
    return "2xx";
}

function classifyError(code) {
    if (code === 401 || code === 403) return "auth";
    if (code === 429) return "rate_limit";
    if (code === 400 || code === 422) return "validation";
    if (code >= 500) return "server";
    return null;
}

function shouldIgnore(path, method) {
    if (IGNORE_METHODS.includes(method)) return true;
    return IGNORE_PATHS.some((p) => path.startsWith(p));
}

function shouldSample() {
    if (SAMPLE_RATE <= 1) return true;
    return Math.floor(Math.random() * SAMPLE_RATE) === 0;
}

/* ----------------------------------------
   ORGANIZATION ID RESOLVER
---------------------------------------- */

const ORG_KEYS = [
    "organizationid",
    "organization_id",
    "orgid",
    "org_id",
    "xorganizationid",
    "xorganization-id",
    "xorgid",
    "xorg-id"
];

function normalizeKey(key) {
    return String(key).toLowerCase().replace(/[_-]/g, "");
}

function cleanValue(v) {
    if (v == null) return null;
    if (Array.isArray(v)) v = v[0];
    const s = String(v).trim();
    return s.length ? s : null;
}

function findInObject(obj) {
    if (!obj || typeof obj !== "object") return null;

    for (const [k, v] of Object.entries(obj)) {
        if (ORG_KEYS.includes(normalizeKey(k))) {
            const val = cleanValue(v);
            if (val) return val;
        }
    }
    return null;
}

function findInHeaders(headers) {
    if (!headers) return null;

    if (typeof headers.get === "function") {
        for (const [k, v] of headers.entries()) {
            if (ORG_KEYS.includes(normalizeKey(k))) {
                const val = cleanValue(v);
                if (val) return val;
            }
        }
        return null;
    }

    return findInObject(headers);
}

async function resolveOrganizationId(c) {
    // 1️⃣ Headers (fastest & most reliable)
    const fromHeaders =
        findInHeaders(c.req.raw?.headers) ||
        findInObject({
            "x-organization-id": c.req.header("x-organization-id"),
            "x-org-id": c.req.header("x-org-id"),
            organizationId: c.req.header("organizationId"),
            organization_id: c.req.header("organization_id")
        });

    if (fromHeaders) return fromHeaders;

    // 2️⃣ Query params
    if (typeof c.req.query === "function") {
        const fromQuery = findInObject(c.req.query());
        if (fromQuery) return fromQuery;
    }

    // 3️⃣ Route params
    if (typeof c.req.param === "function") {
        const fromParams = findInObject(c.req.param());
        if (fromParams) return fromParams;
    }

    // 4️⃣ JSON body (only if JSON)
    try {
        const contentType =
            c.req.header("content-type") ||
            c.req.raw?.headers?.get("content-type") ||
            "";

        if (contentType.includes("application/json")) {
            const body = await c.req.json();

            const direct = findInObject(body);
            if (direct) return direct;

            // common nesting patterns
            if (body.organization || body.org) {
                const nested = findInObject(body.organization || body.org);
                if (nested) return nested;

                if ((body.organization || body.org).id) {
                    return cleanValue((body.organization || body.org).id);
                }
            }
        }
    } catch {
        // ignore body parsing errors
    }

    return null;
}

/* ----------------------------------------
   MIDDLEWARE
---------------------------------------- */
export function trafficMiddleware({
    serviceNameResolver,
    moduleResolver,
    publish
}) {
    return async (c, next) => {
        const start = Date.now();
        const url = new URL(c.req.url);
        const path = url.pathname;

        if (shouldIgnore(path, c.req.method)) {
            return next();
        }

        if (!shouldSample()) {
            return next();
        }

        const requestId =
            c.req.header("x-request-id") || randomUUID();

        c.set("requestId", requestId);

        await next();

        const duration = Date.now() - start;
        const status = c.res?.status || 0;

        const event = {
            timestamp: new Date(),

            organizationId: await resolveOrganizationId(c),

            userId: c.req.header("x-user-id") || null,
            role: c.req.header("x-role") || null,
            requestId,

            service:
                typeof serviceNameResolver === "function"
                    ? serviceNameResolver(c)
                    : "api-gateway",

            module:
                typeof moduleResolver === "function"
                    ? moduleResolver(c)
                    : null,

            endpoint: path,
            routeKey: normalizeRoute(path),
            method: c.req.method,

            statusCode: status,
            statusClass: classifyStatus(status),
            success: status < 400,
            responseTimeMs: duration,
            errorType: classifyError(status),

            requestSizeBytes:
                Number(c.req.header("content-length")) || null,

            responseSizeBytes:
                Number(c.res?.headers?.get("content-length")) || null,

            ip: getIp(c),
            userAgent: c.req.header("user-agent") || null,
            source: c.req.header("x-client-type") || "web",

            serverInstance: INSTANCE_ID,
            isSystem: false
        };

        Promise.resolve()
            .then(() => publish(event))
            .catch((error) => { console.log('traffic.middleware.js @ Line 143:', error); });

    };
}
