import { prisma } from "@jury-hrms/db/client.js";
import { resolveClientIp } from "../utils/client_ip.js";
import {
    resolveOrganizationIpPolicy,
    IP_POLICY_STATUS,
    IP_POLICY_ERROR_CODES,
} from "../utils/ip_whitelist_resolver.js";

/**
 * Organization IP enforcement (Phase 3C) - the single authoritative gateway
 * enforcement point.
 *
 * Placement: registered in server.js AFTER all route-scoped auth
 * middlewares, so an authenticated principal (adminId / employeeId) is
 * already established, and BEFORE route handlers, so a denied request never
 * executes downstream business logic / gRPC / DB mutations.
 *
 * Flow:
 *   request -> auth (existing middlewares) -> this middleware
 *     -> organizationId from TRUSTED principal data (never x-org-id alone,
 *        never query params, never route params)
 *     -> clientIp = resolveClientIp(c)               (Phase 3A only)
 *     -> resolveOrganizationIpPolicy({ organizationId, clientIp }) (Phase 3B only)
 *     -> NO_ACTIVE_WHITELIST | ALLOWED -> next()
 *        DENIED | UNRESOLVABLE_IP      -> 403 { success:false, message }
 *        IP_POLICY_LOOKUP_FAILED       -> 503 { success:false, message }
 *
 * Exemptions (by construction, not by bypass list):
 *   - No principal (public/bootstrap/unauthenticated routes) -> skip. Those
 *     routes cannot safely derive an organization; they are reported as a
 *     remaining authentication gap, not silently protected here.
 *   - Authenticated principal with no org-scoped membership (e.g. the
 *     env-configured super admin, whose AdminRoleAssignments.organizationId
 *     is null) -> skip: no organization whitelist applies to a principal
 *     that is not scoped to any organization.
 *
 * Organization resolution (trusted server-side lookups only):
 *   - Employee: OrganizationEmployees record for employeeId -> organizationId.
 *     Employee-provided organization_id / headers are NEVER used.
 *   - Admin: AdminRoleAssignments for adminId (deletedAt null, org not null).
 *     If the request carries an organization hint (x-org-id /
 *     organizationId header / organization_id query - the portal's active
 *     organization context), it is used ONLY after verifying membership.
 *     Otherwise the first org-scoped assignment is used, matching the
 *     existing admin-service verify-token mechanism. A forged hint can
 *     therefore never select an organization the admin does not belong to.
 *
 * No Redis caching (Phase 3B decision carried forward). No attendance rules.
 * Does not modify legacy ipWhitelist.js / rate limiter / traffic middleware.
 */

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const HTTP_403 = { success: false, message: "Access denied from this IP address." };
const HTTP_503 = { success: false, message: "Service temporarily unavailable." };

function isValidOrgId(value) {
    return typeof value === "string" && OBJECT_ID_REGEX.test(value.trim());
}

/**
 * Reads the portal's active-organization hint. NEVER trusted by itself -
 * only returned when it matches the principal's own memberships.
 */
function organizationHint(c) {
    try {
        const header =
            c.req.header("x-org-id") ||
            c.req.header("organizationId") ||
            c.req.header("organization_id");
        if (isValidOrgId(header)) return header.trim().toLowerCase();
        const query = c.req.query("organization_id");
        if (isValidOrgId(query)) return query.trim().toLowerCase();
    } catch {
        /* ignore malformed request context */
    }
    return null;
}

export async function lookupAdminOrganizationId(adminId, c) {
    const assignments = await prisma.adminRoleAssignments.findMany({
        where: { adminId, deletedAt: null, organizationId: { not: null } },
        select: { organizationId: true },
        orderBy: { createdAt: "asc" },
    });
    const organizations = [
        ...new Set(
            assignments
                .map((row) => (isValidOrgId(row.organizationId) ? row.organizationId.trim().toLowerCase() : null))
                .filter(Boolean)
        ),
    ];
    if (organizations.length === 0) return null; // not org-scoped (e.g. super admin)

    const hint = organizationHint(c);
    if (hint && organizations.includes(hint)) return hint; // verified active-org context
    return organizations[0]; // repo mechanism: first org-scoped assignment
}

export async function lookupEmployeeOrganizationId(employeeId) {
    const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employeeId },
        select: { organizationId: true, deletedAt: true },
    });
    if (!employee || employee.deletedAt || !isValidOrgId(employee.organizationId)) {
        throw new Error("authenticated employee has no resolvable organization");
    }
    return employee.organizationId.trim().toLowerCase();
}

/**
 * Factory so tests can inject failures (DB outage) without touching the
 * shared Prisma client. Production uses the default dependency set below.
 */
export function createOrganizationIpEnforcement(deps = {}) {
    const resolveIp = deps.resolveClientIp || resolveClientIp;
    const resolvePolicy = deps.resolveOrganizationIpPolicy || resolveOrganizationIpPolicy;
    const lookupAdminOrg = deps.lookupAdminOrganizationId || lookupAdminOrganizationId;
    const lookupEmployeeOrg = deps.lookupEmployeeOrganizationId || lookupEmployeeOrganizationId;

    return async function organizationIpEnforcement(c, next) {
        const adminId = c.get("adminId");
        const employeeId = c.get("employeeId");

        // No authenticated principal: public/bootstrap/unauthenticated route.
        // Organization cannot be derived - enforcement does not apply here.
        if (!adminId && !employeeId) {
            return await next();
        }

        let organizationId = null;
        try {
            organizationId = adminId
                ? await lookupAdminOrg(adminId, c)
                : await lookupEmployeeOrg(employeeId);
        } catch (err) {
            // Trusted organization lookup failed: never fail open, never 403-as-allow.
            console.error(
                `[org-ip-enforcement] organization lookup failed: ${err?.message || "unknown"}`
            );
            return c.json(HTTP_503, 503);
        }

        // Principal exists but is not scoped to any organization
        // (super admin / unassigned): no organization whitelist applies.
        if (!organizationId) {
            return await next();
        }

        const clientIp = resolveIp(c);

        let policy;
        try {
            policy = await resolvePolicy({ organizationId, clientIp });
        } catch (err) {
            // IP_POLICY_LOOKUP_FAILED (and any policy-layer failure):
            // controlled 503, never NO_ACTIVE_WHITELIST, never silent allow.
            console.error(
                `[org-ip-enforcement] IP policy lookup failed (${err?.code || "UNKNOWN"}): ${
                    err?.message || "unknown"
                }`
            );
            return c.json(HTTP_503, 503);
        }

        if (
            policy.status === IP_POLICY_STATUS.NO_ACTIVE_WHITELIST ||
            policy.status === IP_POLICY_STATUS.ALLOWED
        ) {
            return await next();
        }

        // DENIED | UNRESOLVABLE_IP -> 403 before any handler executes.
        console.warn(
            `[org-ip-enforcement] ${policy.status} organization=${policy.organizationId} clientIp=${
                policy.clientIp ?? "unknown"
            } path=${new URL(c.req.url).pathname}`
        );
        return c.json(HTTP_403, 403);
    };
}

export const organizationIpEnforcement = createOrganizationIpEnforcement();
