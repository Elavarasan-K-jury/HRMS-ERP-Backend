import { z, ZodError } from 'zod';
import { weeklyOffPolicyClient } from '../grpc/weekly_off.client.js';

const dayOfWeekEnum = z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
const frequencyEnum = z.enum(['ALL', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'LAST']);
const dayTypeEnum = z.enum(['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF']);

const dayOffSchema = z.object({
    frequency: frequencyEnum,
    day_type: dayTypeEnum,
});

const weekOffSchema = z.object({
    day_of_week: dayOfWeekEnum,
    day_offs: z.array(dayOffSchema).min(1, 'At least one day_off required'),
});

function refineWeekOffs(weekOffs) {
    if (!weekOffs || weekOffs.length === 0) return 'At least one week_offs entry required';
    const seen = new Set();
    for (const d of weekOffs) {
        if (seen.has(d.day_of_week)) return `Duplicate day_of_week: ${d.day_of_week}`;
        seen.add(d.day_of_week);
        const freqs = new Set();
        let hasAll = false;
        for (const off of d.day_offs) {
            if (freqs.has(off.frequency)) return `Duplicate frequency ${off.frequency} for ${d.day_of_week}`;
            freqs.add(off.frequency);
            if (off.frequency === 'ALL') hasAll = true;
        }
        if (hasAll && freqs.size > 1) return `ALL cannot be combined with other frequencies for ${d.day_of_week}`;
    }
    return null;
}

const createPolicySchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    effective_from: z.string().optional(),
    code: z.string().min(1).optional(),
    week_offs: z.array(weekOffSchema).min(1, 'At least one week_offs entry required'),
}).strict().superRefine((val, ctx) => {
    const err = refineWeekOffs(val.week_offs);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['week_offs'], message: err });
});

const updatePolicySchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    effective_from: z.string().optional(),
    code: z.string().min(1).optional(),
    week_offs: z.array(weekOffSchema).min(1).optional(),
}).strict().superRefine((val, ctx) => {
    if (val.week_offs) {
        const err = refineWeekOffs(val.week_offs);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['week_offs'], message: err });
    }
});

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

function mapGrpcError(e) {
    const msg = String(e?.message || '');
    const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
    if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists')) return { status: 409, error: clean };
    if (msg.includes('NOT_FOUND') || msg.includes('not found')) return { status: 404, error: clean };
    if (msg.includes('INVALID_ARGUMENT')) return { status: 400, error: clean };
    if (msg.includes('PERMISSION_DENIED')) return { status: 403, error: clean };
    return { status: 500, error: clean || msg };
}

function zodDetails(e) {
    const issues = e.issues || e.errors || [];
    return issues.map(i => ({ field: (i.path || []).join('.'), message: i.message }));
}

// Resolve org: c.get (never set today) → x-org-id header (FE layout) → query/body
function resolveOrganizationId(c) {
    const fromCtx = c.get('organizationId');
    if (fromCtx) return fromCtx;
    const fromHeader = c.req.header('x-org-id') || c.req.header('organizationId') || c.req.header('organization_id');
    if (fromHeader) return fromHeader;
    const fromQuery = c.req.query('organization_id');
    if (fromQuery) return fromQuery;
    return '';
}

function requireOrganizationId(c) {
    const organizationId = resolveOrganizationId(c);
    if (!organizationId || !objectIdRegex.test(organizationId)) {
        return null;
    }
    return organizationId;
}

export default function registerWeeklyOffPolicyRoutes({ openapi }) {
    openapi(
        {
            method: 'post',
            path: '/weekly-off/policies',
            tags: ['Weekly Off Policy'],
            summary: 'Create a weekly off policy',
            requestBody: { content: { 'application/json': { schema: createPolicySchema } } },
            responses: { 201: { description: 'Created' } },
        },
        async (c) => {
            try {
                const body = createPolicySchema.parse(await c.req.json());
                const organizationId = requireOrganizationId(c);
                if (!organizationId) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }

                const result = await new Promise((resolve, reject) => {
                    weeklyOffPolicyClient.CreateWeeklyOffPolicy(
                        { organization_id: organizationId, ...body },
                        (err, resp) => (err ? reject(err) : resolve(resp.policy))
                    );
                });
                return c.json(result, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: zodDetails(e) }, 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'get',
            path: '/weekly-off/policies',
            tags: ['Weekly Off Policy'],
            summary: 'List weekly off policies',
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const organizationId = requireOrganizationId(c);
                if (!organizationId) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }
                const result = await new Promise((resolve, reject) => {
                    weeklyOffPolicyClient.ListWeeklyOffPolicies({ organization_id: organizationId }, (err, resp) => (err ? reject(err) : resolve(resp)));
                });
                return c.json(result);
            } catch (e) {
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'get',
            path: '/weekly-off/policies/{id}',
            tags: ['Weekly Off Policy'],
            summary: 'Get weekly off policy by ID',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Found' }, 404: { description: 'Not found' } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const organizationId = requireOrganizationId(c);
                const result = await new Promise((resolve, reject) => {
                    weeklyOffPolicyClient.GetWeeklyOffPolicy(
                        { id, organization_id: organizationId || '' },
                        (err, resp) => (err ? reject(err) : resolve(resp.policy))
                    );
                });
                if (!result) return c.json({ error: 'Not found' }, 404);
                return c.json(result);
            } catch (e) {
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'put',
            path: '/weekly-off/policies/{id}',
            tags: ['Weekly Off Policy'],
            summary: 'Update weekly off policy',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: { content: { 'application/json': { schema: updatePolicySchema } } },
            responses: { 200: { description: 'Updated' } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = updatePolicySchema.parse(await c.req.json());
                const organizationId = requireOrganizationId(c);
                const result = await new Promise((resolve, reject) => {
                    weeklyOffPolicyClient.UpdateWeeklyOffPolicy(
                        { id, organization_id: organizationId || '', ...body },
                        (err, resp) => (err ? reject(err) : resolve(resp.policy))
                    );
                });
                return c.json(result);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: zodDetails(e) }, 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'delete',
            path: '/weekly-off/policies/{id}',
            tags: ['Weekly Off Policy'],
            summary: 'Delete weekly off policy',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Deleted' } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const organizationId = requireOrganizationId(c);
                const result = await new Promise((resolve, reject) => {
                    weeklyOffPolicyClient.DeleteWeeklyOffPolicy(
                        { id, organization_id: organizationId || '' },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });
                return c.json(result);
            } catch (e) {
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );
}
