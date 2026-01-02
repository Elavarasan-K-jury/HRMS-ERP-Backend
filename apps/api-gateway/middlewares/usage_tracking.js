import { randomUUID } from "crypto";
import { prisma } from "@jury-hrms/db/client.js";

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
const SAMPLE_RATE = Number(process.env.USAGE_SAMPLE_RATE || 1);

/* ----------------------------------------
   HELPERS
---------------------------------------- */

function shouldIgnore(path, method) {
    if (IGNORE_METHODS.includes(method)) return true;
    return IGNORE_PATHS.some((p) => path.startsWith(p));
}

function shouldSample() {
    if (SAMPLE_RATE <= 1) return true;
    return Math.floor(Math.random() * SAMPLE_RATE) === 0;
}

function normalizeRoute(path) {
    return path
        .replace(/\/\d+/g, "/:id")
        .replace(/\/[a-f0-9]{24}/gi, "/:id")
        .replace(/\/[a-f0-9-]{36}/gi, "/:uuid");
}

function normalizeDate(d) {
    return new Date(d.toISOString().slice(0, 10));
}

/* ----------------------------------------
   ORGANIZATION RESOLVER (NO BODY PARSING)
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

function resolveOrganizationIdFromHeaders(c) {
    return (
        findInHeaders(c.req.raw?.headers) ||
        findInObject({
            "x-org-id": c.req.header("x-org-id"),
            "x-organization-id": c.req.header("x-organization-id"),
            organizationId: c.req.header("organizationId"),
            organization_id: c.req.header("organization_id"),
        })
    );
}

/* ----------------------------------------
   USAGE MIDDLEWARE
---------------------------------------- */

export function usageMiddleware({
    serviceNameResolver,
    moduleResolver,
    featureResolver
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

        await next(); // 🔥 NEVER BLOCK BEFORE THIS

        const duration = Date.now() - start;
        const status = c.res?.status || 0;

        const organizationId = resolveOrganizationIdFromHeaders(c);
        if (!organizationId) return;

        const occurredAt = new Date();

        const event = {
            organizationId,
            employeeId: c.req.header("x-employee-id") || null,
            role: c.req.header("x-role") || null,

            module:
                typeof moduleResolver === "function"
                    ? moduleResolver(c)
                    : null,

            feature:
                typeof featureResolver === "function"
                    ? featureResolver(c)
                    : null,

            action: c.req.method,
            source: "API_GATEWAY",

            endpoint: path,
            // routeKey: normalizeRoute(path),
            method: c.req.method,

            durationMs: duration,
            statusCode: status,
            success: status < 400,

            usageUnit: "request",
            usageCount: 1,

            occurredAt,
            date: normalizeDate(occurredAt),

            metadata: {
                service:
                    typeof serviceNameResolver === "function"
                        ? serviceNameResolver(c)
                        : "api-gateway",
                requestId,
                userAgent: c.req.header("user-agent") || null,
            }
        };

        // 🚀 Fire-and-forget (NO await)
        Promise.resolve()
            .then(() =>
                prisma.organizationUsageEvent.create({ data: event })
            )
            .catch((err) => {
                console.error("usage.middleware:", err.message);
            });
    };
}
