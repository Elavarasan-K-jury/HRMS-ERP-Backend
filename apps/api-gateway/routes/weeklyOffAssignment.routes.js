import { z, ZodError } from 'zod';
import { weeklyOffAssignmentClient } from '../grpc/weekly_off.client.js';
import { requirePermission } from '../middlewares/require_permission.js';
import { prisma } from '@jury-hrms/db/client.js';

const MANAGE_PERM = requirePermission('attendance_regularisation.manage');

const assignSchema = z.object({
    employee_id: z.string().min(1),
    weekly_off_policy_id: z.string().min(1),
    effective_from: z.string().min(1),
    effective_to: z.string().optional(),
}).strict();

const updateSchema = z.object({
    weekly_off_policy_id: z.string().optional(),
    effective_from: z.string().optional(),
    effective_to: z.string().optional(),
}).strict();

const bulkAssignSchema = z.object({
    weekly_off_policy_id: z.string().min(1),
    employee_ids: z.array(z.string()).min(1),
    effective_from: z.string().min(1),
    effective_to: z.string().optional(),
}).strict();

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

function isZodError(e) {
    return e instanceof ZodError || e?.name === 'ZodError' || Array.isArray(e?.errors);
}

function zodErrorResponse(e) {
    const errors = (e?.errors || []).map(err => ({ field: (err.path || []).join('.'), message: err.message }));
    return { error: 'Validation failed', details: errors };
}

function locationLabelFromEmployee(emp) {
    const loc = emp?.location;
    if (!loc) return '';
    const base =
        loc.name ||
        loc.formattedAddress ||
        [loc.city, loc.state, loc.country].filter(Boolean).join(', ') ||
        '';
    if (loc.entityType === 'branch') {
        const branchName = emp?.branch?.name;
        return branchName ? `${branchName} — ${base}` : base;
    }
    if (loc.entityType === 'organization') {
        return `Organization${loc.isHeadquarters ? ' (HQ)' : ''} — ${base}`;
    }
    return base;
}

function mapGrpcError(e) {
    const msg = String(e?.message || e?.details || '');
    const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
    if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists') || msg.includes('Overlapping')) {
        return { status: 409, error: clean || 'Conflict' };
    }
    if (msg.includes('NOT_FOUND') || msg.includes('not found')) return { status: 404, error: clean || 'Not found' };
    if (msg.includes('INVALID_ARGUMENT')) return { status: 400, error: clean || 'Invalid argument' };
    if (msg.includes('PERMISSION_DENIED')) return { status: 403, error: clean || 'Forbidden' };
    if (msg.includes('UNAVAILABLE') || msg.includes('ECONNREFUSED')) {
        return { status: 503, error: 'Weekly off service unavailable' };
    }
    return { status: 500, error: clean || msg || 'Internal Server Error' };
}

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

function isEmployeeScope(c) {
    return c.get('tokenScope') === 'employee';
}

async function ownEmployeeOrganizationId(employeeId) {
    const emp = await prisma.organizationEmployees.findUnique({
        where: { id: employeeId },
        select: { organizationId: true },
    });
    return emp?.organizationId || '';
}

// Employee-scope list resolution: employees may only read their own
// assignments, always within their own organization. Organization context is
// derived from the employee record when not supplied by header/query.
async function resolveEmployeeScopedOrg(c, requestedEmployeeId) {
    const ownId = c.get('employeeId');
    if (!ownId) return { error: { error: 'Unauthorized' }, status: 401 };
    if (requestedEmployeeId && requestedEmployeeId !== ownId) {
        return { error: { error: 'Forbidden' }, status: 403 };
    }
    const ownOrgId = await ownEmployeeOrganizationId(ownId);
    if (!ownOrgId || !objectIdRegex.test(ownOrgId)) {
        return { error: { error: 'Valid organization context is required (x-org-id header or organization_id)' }, status: 400 };
    }
    const provided = resolveOrganizationId(c);
    if (provided && provided !== ownOrgId) {
        return { error: { error: 'Forbidden' }, status: 403 };
    }
    return { organizationId: ownOrgId, employeeId: ownId };
}

export default function registerWeeklyOffAssignmentRoutes({ openapi }) {
    // ================
    // Template Download
    // ================
    openapi(
        {
            method: 'get',
            path: '/weekly-off/assignments/template',
            tags: ['Weekly Off Assignment'],
            summary: 'Download weekly off assignment import template (CSV)',
            responses: { 200: { description: 'CSV template file' } },
        },
        async (c) => {
            if (isEmployeeScope(c)) {
                return c.json({ error: 'Forbidden' }, 403);
            }
            const csv = 'employee_id,weekly_off_policy_id,effective_from,effective_to\n';
            return new Response(csv, {
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': 'attachment; filename="weekly_off_import_template.csv"',
                },
            });
        }
    );

    // ================
    // Bulk Import
    // ================
    openapi(
        {
            method: 'post',
            path: '/weekly-off/assignments/import',
            tags: ['Weekly Off Assignment'],
            summary: 'Bulk import weekly off assignments from parsed CSV/Excel',
            requestBody: { content: { 'application/json': { schema: z.object({
                organization_id: z.string(),
                items: z.array(z.object({
                    employee_id: z.string(),
                    weekly_off_policy_id: z.string(),
                    effective_from: z.string(),
                    effective_to: z.string().optional(),
                })).min(1),
            })} } },
            responses: { 200: { description: 'Import completed' } },
        },
        async (c) => {
            try {
                if (isEmployeeScope(c)) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                const body = await c.req.json();
                const { organization_id, items } = body;
                if (!organization_id || !items?.length) {
                    return c.json({ error: 'organization_id and items required' }, 400);
                }
                const results = [];
                for (const item of items) {
                    try {
                        const result = await new Promise((resolve, reject) => {
                            weeklyOffAssignmentClient.AssignWeeklyOff(
                                { organization_id, ...item },
                                (err, resp) => (err ? reject(err) : resolve(resp.assignment))
                            );
                        });
                        results.push({ employee_id: item.employee_id, status: 'SUCCESS', assignment_id: result?.id });
                    } catch (e) {
                        results.push({ employee_id: item.employee_id, status: 'FAILED', message: e.message || e.details });
                    }
                }
                return c.json({
                    success: true,
                    processed: results.filter(r => r.status === 'SUCCESS').length,
                    failed: results.filter(r => r.status === 'FAILED').length,
                    results,
                });
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    openapi(
        {
            method: 'post',
            path: '/weekly-off/assignments',
            tags: ['Weekly Off Assignment'],
            summary: 'Assign weekly off policy to employee',
            requestBody: { content: { 'application/json': { schema: assignSchema } } },
            responses: { 201: { description: 'Assigned' } },
        },
        async (c) => {
            try {
                if (isEmployeeScope(c)) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                let raw;
                try {
                    raw = await c.req.json();
                } catch {
                    return c.json({ error: 'Invalid JSON body' }, 400);
                }
                const body = assignSchema.parse(raw);
                const organizationId = requireOrganizationId(c);
                if (!organizationId) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.AssignWeeklyOff(
                        { organization_id: organizationId, ...body },
                        (err, resp) => (err ? reject(err) : resolve(resp.assignment))
                    );
                });
                return c.json(result, 201);
            } catch (e) {
                if (isZodError(e)) return c.json(zodErrorResponse(e), 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'get',
            path: '/weekly-off/assignments',
            tags: ['Weekly Off Assignment'],
            summary: 'List weekly off assignments',
            parameters: [
                { name: 'employee_id', in: 'query', schema: { type: 'string' } },
                { name: 'active_only', in: 'query', schema: { type: 'boolean' } },
                { name: 'weekly_off_policy_id', in: 'query', schema: { type: 'string' } },
            ],
            responses: { 200: { description: 'List' } },
        },
        async (c) => {
            try {
                const query = c.req.query();
                let organizationId;
                let employeeIdFilter = query.employee_id || '';
                if (isEmployeeScope(c)) {
                    const scoped = await resolveEmployeeScopedOrg(c, employeeIdFilter);
                    if (scoped.error) return c.json(scoped.error, scoped.status);
                    organizationId = scoped.organizationId;
                    employeeIdFilter = scoped.employeeId;
                } else {
                    organizationId = requireOrganizationId(c);
                    if (!organizationId) {
                        return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                    }
                }
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.ListWeeklyOffAssignments(
                        {
                            employee_id: employeeIdFilter,
                            organization_id: organizationId,
                            active_only: query.active_only === 'true',
                            weekly_off_policy_id: query.weekly_off_policy_id || '',
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });
                return c.json(result);
            } catch (e) {
                const m = mapGrpcError(e);
                if (m.status === 404) {
                    return c.json({ error: 'Policy not found' }, 404);
                }
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'get',
            path: '/weekly-off/policies/{id}/assigned-employees',
            tags: ['Weekly Off Assignment'],
            summary: 'List employees currently assigned to a weekly off policy',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'List' }, 404: { description: 'Not found' } },
        },
        async (c) => {
            try {
                if (isEmployeeScope(c)) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                const id = c.req.param('id');
                if (!objectIdRegex.test(id)) {
                    return c.json({ error: 'Invalid policy id' }, 400);
                }
                const organizationId = requireOrganizationId(c);
                if (!organizationId) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.ListWeeklyOffAssignments(
                        {
                            employee_id: '',
                            organization_id: organizationId,
                            active_only: true,
                            weekly_off_policy_id: id,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                const assignments = result?.assignments || [];
                const employeeIds = [
                    ...new Set(assignments.map(a => a.employee_id).filter(id2 => id2 && objectIdRegex.test(id2))),
                ];
                const employees = employeeIds.length
                    ? await prisma.organizationEmployees.findMany({
                        where: { id: { in: employeeIds } },
                        select: {
                            id: true,
                            fullName: true,
                            employeeCode: true,
                            designation: { select: { name: true } },
                            manager: { select: { fullName: true } },
                            departmentAssignments: {
                                select: { department: { select: { name: true } } },
                                take: 1,
                            },
                            location: {
                                select: {
                                    name: true,
                                    entityType: true,
                                    isHeadquarters: true,
                                    formattedAddress: true,
                                    city: true,
                                    state: true,
                                    country: true,
                                },
                            },
                            branch: { select: { name: true } },
                        },
                    })
                    : [];
                const byId = new Map(employees.map(e => [e.id, e]));
                const enriched = assignments.map(a => {
                    const emp = byId.get(a.employee_id);
                    return {
                        ...a,
                        employee_name: a.employee_name || emp?.fullName || '',
                        employee_code: a.employee_code || emp?.employeeCode || '',
                        job_title: emp?.designation?.name || '',
                        reporting_to: emp?.manager?.fullName || '',
                        department: emp?.departmentAssignments?.[0]?.department?.name || '',
                        location: locationLabelFromEmployee(emp),
                    };
                });
                return c.json({ ...result, assignments: enriched });
            } catch (e) {
                const m = mapGrpcError(e);
                if (m.status === 404) {
                    return c.json({ error: 'Policy not found' }, 404);
                }
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'get',
            path: '/weekly-off/assignments/{id}',
            tags: ['Weekly Off Assignment'],
            summary: 'Get weekly off assignment by ID',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Found' }, 404: { description: 'Not found' } },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.GetWeeklyOffAssignment({ id }, (err, resp) => (err ? reject(err) : resolve(resp.assignment)));
                });
                if (!result) return c.json({ error: 'Not found' }, 404);
                if (isEmployeeScope(c) && result.employee_id !== c.get('employeeId')) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                return c.json(result);
            } catch (e) {
                const m = mapGrpcError(e);
                if (m.status === 404) return c.json({ error: 'Not found' }, 404);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'put',
            path: '/weekly-off/assignments/{id}',
            tags: ['Weekly Off Assignment'],
            summary: 'Update weekly off assignment',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: { content: { 'application/json': { schema: updateSchema } } },
            responses: { 200: { description: 'Updated' } },
        },
        async (c) => {
            try {
                if (isEmployeeScope(c)) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                const id = c.req.param('id');
                let raw;
                try {
                    raw = await c.req.json();
                } catch {
                    return c.json({ error: 'Invalid JSON body' }, 400);
                }
                const body = updateSchema.parse(raw);
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.UpdateWeeklyOffAssignment({ id, ...body }, (err, resp) => (err ? reject(err) : resolve(resp.assignment)));
                });
                return c.json(result);
            } catch (e) {
                if (isZodError(e)) return c.json(zodErrorResponse(e), 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );

    openapi(
        {
            method: 'delete',
            path: '/weekly-off/assignments/{id}',
            tags: ['Weekly Off Assignment'],
            summary: 'Delete weekly off assignment',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Deleted' } },
        },
        async (c) => {
            try {
                if (isEmployeeScope(c)) {
                    return c.json({ error: 'Forbidden' }, 403);
                }
                const id = c.req.param('id');
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.DeleteWeeklyOffAssignment({ id }, (err, resp) => (err ? reject(err) : resolve(resp)));
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
            method: 'post',
            path: '/weekly-off/assignments/bulk',
            tags: ['Weekly Off Assignment'],
            summary: 'Bulk assign weekly off to multiple employees',
            requestBody: { content: { 'application/json': { schema: bulkAssignSchema } } },
            responses: { 200: { description: 'Bulk assigned' } },
        },
        MANAGE_PERM,
        async (c) => {
            try {
                const body = bulkAssignSchema.parse(await c.req.json());
                const organizationId = requireOrganizationId(c);
                if (!organizationId) {
                    return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
                }
                const result = await new Promise((resolve, reject) => {
                    weeklyOffAssignmentClient.BulkAssignWeeklyOff(
                        { organization_id: organizationId, ...body },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });
                return c.json(result);
            } catch (e) {
                if (isZodError(e)) return c.json(zodErrorResponse(e), 400);
                const m = mapGrpcError(e);
                return c.json({ error: m.error }, m.status);
            }
        }
    );
}
