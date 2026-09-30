import { prisma } from "@jury-hrms/db/client.js";
import { getAdminPermissions } from "../middlewares/require_permission.js";

/**
 * Trusted organization context resolution (Phase 3D).
 *
 * The single server-side helper that turns an HTTP request into a VERIFIED
 * organizationId for organization-scoped APIs (starting with the IP
 * Configuration CRUD).
 *
 * Distinguishes:
 *   1. authenticated principal   - adminId / employeeId set by existing auth
 *   2. requested organization    - x-org-id / organizationId / organization_id
 *                                  (portal active-org context; NEVER trusted)
 *   3. verified membership       - AdminRoleAssignments / employee record
 *   4. final trusted organizationId
 *
 * Rules:
 *   - Admin: EVERY well-formed organization context value the request carries
 *     (x-org-id / organizationId / organization_id headers and the
 *     organization_id query) must be one of the admin's own org-scoped
 *     memberships; a single non-membership value rejects the request (403)
 *     before any query/mutation - even when another supplied value is valid.
 *     The acting organization is still the precedence winner
 *     (context -> headers -> query), so a forged lower-precedence value can
 *     never select an organization, only fail verification. Missing/invalid
 *     requested organization keeps the existing 400 behavior (no invented
 *     default).
 *   - Super admin (admins.isSuperAdmin via GetAdminPermissions): existing
 *     global semantics preserved - operates on the precedence-selected
 *     organization without membership scoping, and is NOT converted into an
 *     org-scoped user.
 *   - Employee: organization comes only from the trusted employee record;
 *     client organization context is ignored (never authoritative).
 *   - Infrastructure failure -> controlled 503 (never fail-open).
 *   - Malformed / non-ObjectId context values are ignored (treated as
 *     absent), matching the enforcement middleware's hint handling.
 */

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const ORG_CONTEXT_MESSAGES = {
    missing: "Valid organization context is required (x-org-id header or organization_id)",
    forbidden: "Access denied for this organization",
    unavailable: "Service temporarily unavailable",
    unauthorized: "Unauthorized",
};

function isValidOrgId(value) {
    return typeof value === "string" && OBJECT_ID_REGEX.test(value.trim());
}

/**
 * The organization the client REQUESTS to operate in.
 * Precedence mirrors the legacy resolver: context -> headers -> query.
 * Returns { raw, valid } ('' when nothing was requested).
 */
export function requestedOrganization(c) {
    let raw = "";
    try {
        raw =
            c.get("organizationId") ||
            c.req.header("x-org-id") ||
            c.req.header("organizationId") ||
            c.req.header("organization_id") ||
            c.req.query("organization_id") ||
            "";
    } catch {
        raw = "";
    }
    return { raw: typeof raw === "string" ? raw.trim() : "", valid: isValidOrgId(raw) };
}

/**
 * Every well-formed organization context value the request carries, deduped.
 * Used so a forged value in ANY channel fails membership verification, not
 * just the precedence winner. Malformed values are ignored (absent).
 */
function requestedOrganizationCandidates(c) {
    const values = [];
    try {
        values.push(
            c.get("organizationId"),
            c.req.header("x-org-id"),
            c.req.header("organizationId"),
            c.req.header("organization_id"),
            c.req.query("organization_id")
        );
    } catch {
        /* malformed request context -> no candidates */
    }
    const out = new Set();
    for (const value of values) {
        if (isValidOrgId(value)) out.add(value.trim().toLowerCase());
    }
    return [...out];
}

async function adminMembershipOrganizations(adminId) {
    const assignments = await prisma.adminRoleAssignments.findMany({
        where: { adminId, deletedAt: null, organizationId: { not: null } },
        select: { organizationId: true },
        orderBy: { createdAt: "asc" },
    });
    return [
        ...new Set(
            assignments
                .map((row) => (isValidOrgId(row.organizationId) ? row.organizationId.trim().toLowerCase() : null))
                .filter(Boolean)
        ),
    ];
}

async function employeeOrganization(employeeId) {
    const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employeeId },
        select: { organizationId: true, deletedAt: true },
    });
    if (!employee || employee.deletedAt || !isValidOrgId(employee.organizationId)) return null;
    return employee.organizationId.trim().toLowerCase();
}

/**
 * @returns {{ok:true, organizationId:string, principal:'admin'|'employee', isSuperAdmin:boolean}
 *          |{ok:false, status:number, error:string}}
 */
export async function resolveTrustedOrganization(c) {
    const adminId = c.get("adminId");
    const employeeId = c.get("employeeId");

    if (!adminId && !employeeId) {
        return { ok: false, status: 401, error: ORG_CONTEXT_MESSAGES.unauthorized };
    }

    try {
        if (!adminId) {
            // Employee principal: trusted record only; requested org ignored.
            const organizationId = await employeeOrganization(employeeId);
            if (!organizationId) {
                return { ok: false, status: 403, error: ORG_CONTEXT_MESSAGES.forbidden };
            }
            return { ok: true, organizationId, principal: "employee", isSuperAdmin: false };
        }

        // Admin principal: requested organization is only a hint.
        const requested = requestedOrganization(c);
        if (!requested.raw || !requested.valid) {
            // Existing behavior preserved: context required, no default invented.
            return { ok: false, status: 400, error: ORG_CONTEXT_MESSAGES.missing };
        }

        const permissions = await getAdminPermissions(adminId);
        if (permissions.is_super_admin) {
            // Super-admin semantics unchanged: global operator, precedence-selected org as-is.
            return {
                ok: true,
                organizationId: requested.raw.toLowerCase(),
                principal: "admin",
                isSuperAdmin: true,
            };
        }

        const organizationId = requested.raw.toLowerCase();
        const candidates = requestedOrganizationCandidates(c);
        const memberships = await adminMembershipOrganizations(adminId);
        // Verify ALL well-formed context values: a forged value in any channel
        // rejects the request even if the precedence winner is legitimate.
        for (const candidate of candidates) {
            if (!memberships.includes(candidate)) {
                // Not a member: reject before any query/mutation of that organization.
                return { ok: false, status: 403, error: ORG_CONTEXT_MESSAGES.forbidden };
            }
        }
        return { ok: true, organizationId, principal: "admin", isSuperAdmin: false };
    } catch (err) {
        console.error(`[organization-context] resolution failed: ${err?.message || "unknown"}`);
        return { ok: false, status: 503, error: ORG_CONTEXT_MESSAGES.unavailable };
    }
}
