import { requirePermission, checkPermission } from '../middlewares/require_permission.js';
import { regularisationClient } from '../grpc/regularization.client.js';
import { prisma } from '@jury-hrms/db/client.js';
import { resolveTrustedOrganization } from '../utils/organization_context.js';

const VIEW_PERM = requirePermission('attendance_regularisation.view');
const MANAGE_PERM = requirePermission('attendance_regularisation.manage');

function grpcToHttpStatus(code) {
    switch (code) {
        case 3: return 400;   // INVALID_ARGUMENT
        case 4: return 404;   // DEADLINE_EXCEEDED→unused; NOT_FOUND=5
        case 5: return 404;   // NOT_FOUND
        case 6: return 409;   // ALREADY_EXISTS
        case 7: return 403;   // PERMISSION_DENIED
        case 9: return 412;   // FAILED_PRECONDITION
        case 13: return 500;  // INTERNAL
        case 16: return 401;  // UNAUTHENTICATED
        default: return 500;
    }
}

/**
 * Resolve organizationId for the authenticated principal.
 * - Context organization (if a trusted middleware already set it) wins.
 * - Employee: fetched from the employee's own record (client org ignored).
 * - Admin: resolved from the verified-membership organization context
 *   (Phase 3D trusted helper; requested x-org-id must match a membership).
 */
async function resolveOrgId(c) {
    let organizationId = c.get('organizationId');
    if (organizationId) return organizationId;
    const employeeId = c.get('employeeId');
    if (!employeeId) {
        if (c.get('adminId')) {
            const ctx = await resolveTrustedOrganization(c);
            return ctx.ok ? ctx.organizationId : null;
        }
        return null;
    }
    const emp = await prisma.organizationEmployees.findFirst({
        where: { id: employeeId },
        select: { organizationId: true },
    });
    return emp?.organizationId || null;
}

export default function registerRegularisationRoutes({ openapi }) {
    /* --------------------------------------------------------
       POST /attendance/regularise
       Employee submits a regularisation request
    -------------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/attendance/regularise',
            tags: ['Attendance Regularisation'],
            summary: 'Submit a regularisation request',
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['attendance_id', 'type', 'note'],
                            properties: {
                                attendance_id: { type: 'string' },
                                date: { type: 'string', description: 'YYYY-MM-DD, used if no attendance_id' },
                                type: { type: 'string', enum: ['ADJUST_LOGS', 'EXEMPT_PENALTY'] },
                                requested_in_time: { type: 'string', description: 'ISO DateTime, required for ADJUST_LOGS' },
                                requested_out_time: { type: 'string', description: 'ISO DateTime, required for ADJUST_LOGS' },
                                note: { type: 'string' },
                            },
                        },
                    },
                },
            },
            responses: {
                200: { description: 'Regularisation created' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const employeeId = c.get('employeeId');
                const organizationId = await resolveOrgId(c);
                if (!organizationId) {
                    return c.json({ error: 'Could not resolve organization for employee' }, 400);
                }

                const result = await new Promise((resolve, reject) => {
                    regularisationClient.CreateRegularisation(
                        {
                            organization_id: organizationId,
                            employee_id: employeeId,
                            attendance_id: body.attendance_id || '',
                            date: body.date || '',
                            type: body.type,
                            requested_in_time: body.requested_in_time || '',
                            requested_out_time: body.requested_out_time || '',
                            note: body.note,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json({ success: true, regularisation: result.regularisation });
            } catch (error) {
                return c.json(
                    { error: error.details || error.message || 'Failed to submit regularisation' },
                    grpcToHttpStatus(error.code) || 500,
                );
            }
        }
    );

    /* --------------------------------------------------------
       GET /attendance/regularise
       List regularisation requests (own or team)
       RBAC: no permission needed for own requests; VIEW_PERM required
       when viewing another employee's requests (employee_id param).
    -------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/attendance/regularise',
            tags: ['Attendance Regularisation'],
            summary: 'List regularisation requests',
            parameters: [
                { name: 'status', in: 'query', schema: { type: 'string' } },
                { name: 'date_from', in: 'query', schema: { type: 'string' } },
                { name: 'date_to', in: 'query', schema: { type: 'string' } },
                { name: 'employee_id', in: 'query', schema: { type: 'string' }, description: 'Manager/admin filter — requires attendance_regularisation.view permission' },
            ],
            responses: {
                200: { description: 'List of regularisations' },
            },
        },
        async (c) => {
            const query = c.req.query();
            const authEmployeeId = c.get('employeeId');
            const organizationId = await resolveOrgId(c);
            if (!organizationId) {
                return c.json({ error: 'Could not resolve organization for employee' }, 400);
            }

            // RBAC: if viewing another employee's data, require VIEW_PERM
            const targetEmployeeId = query.employee_id || authEmployeeId;
            if (query.employee_id && query.employee_id !== authEmployeeId) {
                // Manager/admin viewing someone else — check permission
                const hasPermission = await checkPermission(c.get('adminId'), 'attendance_regularisation.view');
                if (!hasPermission) {
                    return c.json({ error: 'Insufficient permissions to view other employees\' regularisations' }, 403);
                }
            }

            const result = await new Promise((resolve, reject) => {
                regularisationClient.ListRegularisations(
                    {
                        employee_id: targetEmployeeId,
                        organization_id: organizationId,
                        status: query.status || '',
                        date_from: query.date_from || '',
                        date_to: query.date_to || '',
                    },
                    (err, resp) => (err ? reject(err) : resolve(resp))
                );
            });

            return c.json({ success: true, regularisations: result.regularisations });
        }
    );

    /* --------------------------------------------------------
       GET /attendance/regularise/:id
       Detail view
    -------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/attendance/regularise/{id}',
            tags: ['Attendance Regularisation'],
            summary: 'Get regularisation detail',
            parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
                200: { description: 'Regularisation detail' },
                404: { description: 'Not found' },
            },
        },
        async (c) => {
            const id = c.req.param('id');

            const result = await new Promise((resolve, reject) => {
                regularisationClient.GetRegularisation(
                    { regularisation_id: id },
                    (err, resp) => (err ? reject(err) : resolve(resp))
                );
            });

            return c.json({ success: true, regularisation: result.regularisation });
        }
    );

    /* --------------------------------------------------------
       POST /attendance/regularise/bulk
       Admin bulk regularise — bypasses approval, requires manage perm
    -------------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/attendance/regularise/bulk',
            tags: ['Attendance Regularisation'],
            summary: 'Bulk regularise (admin, bypasses approval)',
            security: [{ bearerAuth: [] }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['items', 'confirmation_flag'],
                            properties: {
                                confirmation_flag: { type: 'string', description: 'Must be CONFIRMED' },
                                items: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: ['employee_id', 'date', 'type', 'note'],
                                        properties: {
                                            employee_id: { type: 'string' },
                                            attendance_id: { type: 'string' },
                                            date: { type: 'string' },
                                            type: { type: 'string', enum: ['ADJUST_LOGS', 'EXEMPT_PENALTY'] },
                                            requested_in_time: { type: 'string' },
                                            requested_out_time: { type: 'string' },
                                            note: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            responses: {
                200: { description: 'Bulk regularisation results' },
            },
        },
        MANAGE_PERM,
        async (c) => {
            const body = await c.req.json();
            const adminId = c.get('adminId');
            const organizationId = await resolveOrgId(c);
            if (!organizationId) {
                return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
            }

            const result = await new Promise((resolve, reject) => {
                regularisationClient.BulkRegularise(
                    {
                        organization_id: organizationId,
                        admin_id: adminId,
                        items: body.items,
                        confirmation_flag: body.confirmation_flag,
                    },
                    (err, resp) => (err ? reject(err) : resolve(resp))
                );
            });

            return c.json({ success: true, processed: result.processed, results: result.results });
        }
    );
}
