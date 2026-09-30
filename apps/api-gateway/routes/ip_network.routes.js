import { z, ZodError } from 'zod';
import { organizationIpNetworkClient } from '../grpc/organization_ip_network.client.js';
import { resolveTrustedOrganization } from '../utils/organization_context.js';
import { invalidateIpWhitelistCache } from '../utils/ip_whitelist_resolver.js';
import { resolveClientIp, classifyIp } from '../utils/client_ip.js';

const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function ipToInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc * 256) + Number(octet), 0);
}

function mapGrpcError(e) {
    const msg = String(e?.message || '');
    const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
    if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists') || msg.includes('overlaps')) return { status: 409, error: clean };
    if (msg.includes('NOT_FOUND') || msg.includes('not found')) return { status: 404, error: clean };
    if (msg.includes('INVALID_ARGUMENT')) return { status: 400, error: clean };
    if (msg.includes('PERMISSION_DENIED')) return { status: 403, error: clean };
    return { status: 500, error: clean || msg };
}

function zodDetails(e) {
    const issues = e.issues || e.errors || [];
    return issues.map(i => ({ field: (i.path || []).join('.'), message: i.message }));
}

// Organization context is resolved via resolveTrustedOrganization (Phase 3D):
// client x-org-id / organization_id is a REQUESTED context only and is
// verified against the authenticated principal's memberships before use.

function grpcCall(method, payload) {
    return new Promise((resolve, reject) => {
        organizationIpNetworkClient[method](payload, (err, resp) => (err ? reject(err) : resolve(resp)));
    });
}

const ipNetworkSchema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
    ip_type: z.enum(['SINGLE', 'RANGE']),
    from_ip: z.string().trim().regex(ipv4Regex, 'from_ip must be a valid IPv4 address'),
    to_ip: z.string().trim().nullish(),
    is_enabled: z.boolean().default(true),
}).strict().superRefine((val, ctx) => {
    const toIp = (val.to_ip ?? '').trim();
    if (val.ip_type === 'SINGLE') {
        if (toIp) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_ip'], message: 'to_ip must be empty when ip_type is SINGLE' });
        return;
    }
    if (!toIp) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_ip'], message: 'to_ip is required when ip_type is RANGE' });
        return;
    }
    if (!ipv4Regex.test(toIp)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_ip'], message: 'to_ip must be a valid IPv4 address' });
        return;
    }
    if (ipToInt(val.from_ip) > ipToInt(toIp)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_ip'], message: 'From IP must be less than or equal to To IP' });
    }
});

export default function registerIpNetworkRoutes({ openapi }) {
    // POST /ip-networks
    openapi(
        {
            method: 'post',
            path: '/ip-networks',
            tags: ['IP Network'],
            summary: 'Create an organization IP network configuration',
            requestBody: { content: { 'application/json': { schema: ipNetworkSchema } } },
            responses: {
                201: { description: 'Created' },
                400: { description: 'Validation error' },
                409: { description: 'Duplicate name or overlapping IP range' },
            },
        },
        async (c) => {
            try {
                const body = ipNetworkSchema.parse(await c.req.json());
                const orgCtx = await resolveTrustedOrganization(c);
                if (!orgCtx.ok) {
                    return c.json({ error: orgCtx.error }, orgCtx.status);
                }
                const organizationId = orgCtx.organizationId;
                const res = await grpcCall('CreateOrganizationIpNetwork', {
                    organization_id: organizationId,
                    name: body.name,
                    ip_type: body.ip_type,
                    from_ip: body.from_ip,
                    to_ip: (body.to_ip ?? '').trim(),
                    is_enabled: body.is_enabled,
                });
                // Phase 3F: mutation point invalidates this organization's
                // whitelist cache (failure is logged inside, TTL recovers).
                await invalidateIpWhitelistCache(organizationId);
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: zodDetails(e) }, 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    // GET /ip-networks
    openapi(
        {
            method: 'get',
            path: '/ip-networks',
            tags: ['IP Network'],
            summary: 'List organization IP network configurations',
            responses: { 200: { description: 'List' }, 400: { description: 'Missing organization context' } },
        },
        async (c) => {
            try {
                const orgCtx = await resolveTrustedOrganization(c);
                if (!orgCtx.ok) {
                    return c.json({ error: orgCtx.error }, orgCtx.status);
                }
                const organizationId = orgCtx.organizationId;
                const res = await grpcCall('ListOrganizationIpNetworks', { organization_id: organizationId });
                return c.json(res);
            } catch (e) {
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    // GET /ip-networks/current-ip
    // Exposes the Phase 3A gateway-observed client IP to the IP Configuration
    // UI. Same resolveClientIp(c) used by organizationIpEnforcement - the
    // gateway is the single source of truth (no external IP service, no
    // browser-supplied value). Auth: authAdmin (server.js '/ip-networks/*').
    // Organization context: resolveTrustedOrganization (Phase 3D), same as the
    // CRUD siblings. Read-only: no cache interaction, no DB mutation.
    openapi(
        {
            method: 'get',
            path: '/ip-networks/current-ip',
            tags: ['IP Network'],
            summary: 'Get the client IP as observed by the HRMS gateway',
            description:
                'Returns the IP address resolved by the gateway Phase 3A resolver (resolveClientIp), ' +
                'which is the authoritative address used for organization IP whitelist enforcement.',
            responses: {
                200: { description: 'Gateway-observed IP, or success:false when it cannot be resolved' },
                400: { description: 'Missing organization context' },
                401: { description: 'Unauthorized' },
                403: { description: 'Forbidden organization' },
            },
        },
        async (c) => {
            try {
                const orgCtx = await resolveTrustedOrganization(c);
                if (!orgCtx.ok) {
                    return c.json({ error: orgCtx.error }, orgCtx.status);
                }
                const ip = resolveClientIp(c);
                if (!ip) {
                    return c.json({
                        success: false,
                        message: 'Unable to determine the IP address seen by HRMS.',
                    });
                }
                return c.json({
                    success: true,
                    data: {
                        ip,
                        ipType: classifyIp(ip),
                        source: 'gateway',
                    },
                });
            } catch (e) {
                // resolveClientIp never throws; this is a controlled fallback so
                // the UI gets an explicit detection failure instead of a guess.
                return c.json({
                    success: false,
                    message: 'Unable to determine the IP address seen by HRMS.',
                });
            }
        }
    );

    // PUT /ip-networks/{id}
    openapi(
        {
            method: 'put',
            path: '/ip-networks/{id}',
            tags: ['IP Network'],
            summary: 'Update an organization IP network configuration',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: { content: { 'application/json': { schema: ipNetworkSchema } } },
            responses: {
                200: { description: 'Updated' },
                400: { description: 'Validation error' },
                404: { description: 'Not found' },
                409: { description: 'Duplicate name or overlapping IP range' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = ipNetworkSchema.parse(await c.req.json());
                const orgCtx = await resolveTrustedOrganization(c);
                if (!orgCtx.ok) {
                    return c.json({ error: orgCtx.error }, orgCtx.status);
                }
                const organizationId = orgCtx.organizationId;
                const res = await grpcCall('UpdateOrganizationIpNetwork', {
                    id,
                    organization_id: organizationId,
                    name: body.name,
                    ip_type: body.ip_type,
                    from_ip: body.from_ip,
                    to_ip: (body.to_ip ?? '').trim(),
                    is_enabled: body.is_enabled,
                });
                // Phase 3F: enable/disable/IP edits must reflect on the next
                // enforcement request - invalidate the organization's cache.
                await invalidateIpWhitelistCache(organizationId);
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: zodDetails(e) }, 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    // DELETE /ip-networks/{id}
    openapi(
        {
            method: 'delete',
            path: '/ip-networks/{id}',
            tags: ['IP Network'],
            summary: 'Delete an organization IP network configuration',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const orgCtx = await resolveTrustedOrganization(c);
                if (!orgCtx.ok) {
                    return c.json({ error: orgCtx.error }, orgCtx.status);
                }
                const organizationId = orgCtx.organizationId;
                const res = await grpcCall('DeleteOrganizationIpNetwork', {
                    id,
                    organization_id: organizationId,
                });
                // Phase 3F: deleted rows must stop applying immediately.
                await invalidateIpWhitelistCache(organizationId);
                return c.json(res);
            } catch (e) {
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );
}
