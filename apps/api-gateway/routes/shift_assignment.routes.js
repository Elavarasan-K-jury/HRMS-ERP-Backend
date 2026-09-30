import { z, ZodError } from 'zod';
import { shiftAssignmentClient } from '../grpc/shift_assignment.client.js';
import { requirePermission } from '../middlewares/require_permission.js';

const MANAGE_PERM = requirePermission('attendance.manage', 'attendance_regularisation.manage');
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

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
  if (!organizationId || !objectIdRegex.test(organizationId)) return null;
  return organizationId;
}

function isAdminScope(c) {
  return c.get('tokenScope') === 'admin' && !!c.get('adminId');
}

function mapGrpcError(e, fallback = 'Request failed') {
  const msg = String(e?.message || e?.details || '');
  const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
  if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists')) {
    return { status: 409, error: clean || 'Conflict' };
  }
  if (msg.includes('NOT_FOUND') || msg.includes('not found')) return { status: 404, error: clean || 'Not found' };
  if (msg.includes('ABORTED')) return { status: 409, error: clean || 'Conflict' };
  if (msg.includes('INVALID_ARGUMENT')) return { status: 400, error: clean || 'Invalid argument' };
  if (msg.includes('PERMISSION_DENIED')) return { status: 403, error: clean || 'Forbidden' };
  if (msg.includes('UNAVAILABLE') || msg.includes('ECONNREFUSED')) {
    return { status: 503, error: 'Shift assignment service unavailable' };
  }
  return { status: 500, error: clean || msg || fallback };
}

export default function registerShiftAssignmentRoutes({ openapi }) {
  const isoDateTime = z
    .string({ required_error: 'Datetime is required' })

  // ================
  // Template Download
  // ================
  openapi(
    {
      method: 'get',
      path: '/shift-assignments/template',
      tags: ['Shift Assignment'],
      summary: 'Download shift assignment import template (CSV)',
      responses: { 200: { description: 'CSV template file' } },
    },
    async (c) => {
      if (!isAdminScope(c)) {
        return c.json({ error: 'Admin access required' }, 403);
      }
      const csv = 'employee_id,shift_id,start_date,end_date\n';
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="shift_import_template.csv"',
        },
      });
    },
  );

  // ================
  // Create (Assign)
  // ================
  const assignShiftSchema = z
    .object({
      employee_id: z.string({ required_error: 'Employee ID is required' }),
      shift_id: z.string({ required_error: 'Shift ID is required' }),
      valid_from: isoDateTime,
      valid_to: isoDateTime.optional(),
    })
    .strict();

  const assignmentResponseSchema = z.object({
    id: z.string(),
    employee_id: z.string(),
    shift_id: z.string(),
    valid_from: z.string(),
    valid_to: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    deleted_at: z.string().optional(),
  });

  openapi(
    {
      method: 'post',
      path: '/shift-assignments',
      tags: ['ShiftAssignment'],
      summary: 'Assign a shift to an employee (with validity period)',
      request: {
        body: {
          content: {
            'application/json': {
              schema: assignShiftSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Shift assigned successfully',
          content: {
            'application/json': {
              schema: assignmentResponseSchema,
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: z.object({
                error: z.string(),
                details: z
                  .array(
                    z.object({
                      field: z.string(),
                      message: z.string(),
                    }),
                  )
                  .optional(),
              }),
            },
          },
        },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = await c.req.json();
        const parsed = assignShiftSchema.parse(body);

        const assignment = await new Promise((resolve, reject) => {
          shiftAssignmentClient.AssignShift(
            { ...parsed, organization_id: organizationId },
            (err, resp) => {
            if (err) return reject(err);
            resolve(resp.assignment);
          },
          );
        });

        return c.json(assignment, 201);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const msg = String(error?.message || error?.details || '');
        const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
        if (msg.includes('ALREADY_EXISTS') || msg.includes('already exists') || msg.includes('overlap') || msg.includes('Overlap')) {
          return c.json({ error: clean || 'Overlapping assignment exists for this employee' }, 409);
        }
        if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
          return c.json({ error: clean || 'Not found' }, 404);
        }
        if (msg.includes('INVALID_ARGUMENT')) {
          return c.json({ error: clean || 'Invalid argument' }, 400);
        }
        if (msg.includes('PERMISSION_DENIED')) {
          return c.json({ error: clean || 'Forbidden' }, 403);
        }
        return c.json({ error: clean || msg || 'Failed to assign shift' }, 500);
      }
    },
  );

  // =========================
  // Get by ID
  // =========================
  openapi(
    {
      method: 'get',
      path: '/shift-assignments/{id}',
      tags: ['ShiftAssignment'],
      summary: 'Get a shift assignment by ID',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Assignment ID is required' }),
        }),
      },
      responses: {
        200: {
          description: 'Shift assignment details',
          content: {
            'application/json': {
              schema: assignmentResponseSchema,
            },
          },
        },
        404: { description: 'Assignment not found' },
      },
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const id = c.req.param('id');

        const assignment = await new Promise((resolve, reject) => {
          shiftAssignmentClient.GetShiftAssignment({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp.assignment);
          });
        });

        if (!assignment) return c.json({ error: 'Assignment not found' }, 404);

        return c.json(assignment, 200);
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    },
  );

  // =========================
  // List assignments
  // =========================
  const listQuerySchema = z.object({
    employee_id: z.string().optional(),
    shift_id: z.string().optional(),
    active_only: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  });

  openapi(
    {
      method: 'get',
      path: '/shift-assignments',
      tags: ['ShiftAssignment'],
      summary: 'List shift assignments (by employee, shift, active-only)',
      request: {
        query: listQuerySchema,
      },
      responses: {
        200: {
          description: 'List of shift assignments',
          content: {
            'application/json': {
              schema: z.object({
                assignments: z.array(assignmentResponseSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query'); // zod-openapi parsed

        // Employee tokens may only read their own assignments.
        if (c.get('tokenScope') === 'employee') {
          const employeeId = c.get('employeeId');
          if (!query.employee_id || query.employee_id !== employeeId) {
            return c.json({ error: 'Forbidden' }, 403);
          }
        }

        const organizationId = isAdminScope(c) ? resolveOrganizationId(c) : '';

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.ListShiftAssignments(
            {
              employee_id: query.employee_id || '',
              shift_id: query.shift_id || '',
              active_only: query.active_only || false,
              organization_id: organizationId || '',
            },
            (err, resp) => {
              if (err) return reject(err);
              resolve(resp);
            },
          );
        });

        return c.json(response, 200);
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    },
  );

  // =========================
  // Update assignment (dates)
  // =========================
  const updateAssignmentSchema = z
    .object({
      valid_from: isoDateTime.optional(),
      // null = explicit clear (open-ended assignment); undefined = unchanged
      valid_to: isoDateTime.nullable().optional(),
    })
    .strict();

  openapi(
    {
      method: 'put',
      path: '/shift-assignments/{id}',
      tags: ['ShiftAssignment'],
      summary: 'Update an existing shift assignment (valid_from / valid_to)',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Assignment ID is required' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: updateAssignmentSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Shift assignment updated successfully',
          content: {
            'application/json': {
              schema: assignmentResponseSchema,
            },
          },
        },
        400: { description: 'Validation error' },
        404: { description: 'Assignment not found' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const id = c.req.param('id');
        const body = updateAssignmentSchema.parse(await c.req.json());
        const { valid_to: validTo, ...rest } = body;

        const assignment = await new Promise((resolve, reject) => {
          shiftAssignmentClient.UpdateShiftAssignment(
            {
              id,
              organization_id: organizationId,
              ...rest,
              ...(validTo === null ? { clear_valid_to: true } : {}),
              ...(validTo != null ? { valid_to: validTo } : {}),
            },
            (err, resp) => {
              if (err) return reject(err);
              resolve(resp.assignment);
            },
          );
        });

        return c.json(assignment, 200);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const msg = String(error?.message || error?.details || '');
        const clean = msg.replace(/^\d+ [A-Z_]+: /, '');
        if (msg.includes('ALREADY_EXISTS') || msg.includes('overlap') || msg.includes('Overlap')) {
          return c.json({ error: clean || 'Updated range overlaps with another assignment' }, 409);
        }
        if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
          return c.json({ error: clean || 'Assignment not found' }, 404);
        }
        if (msg.includes('INVALID_ARGUMENT')) {
          return c.json({ error: clean || 'Invalid argument' }, 400);
        }
        return c.json({ error: clean || msg || 'Failed to update assignment' }, 500);
      }
    },
  );

  // =========================
  // Delete assignment (soft)
  // =========================
  openapi(
    {
      method: 'delete',
      path: '/shift-assignments/{id}',
      tags: ['ShiftAssignment'],
      summary: 'Soft delete a shift assignment',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Assignment ID is required' }),
        }),
      },
      responses: {
        200: {
          description: 'Shift assignment deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                message: z.string(),
              }),
            },
          },
        },
        404: { description: 'Assignment not found' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const id = c.req.param('id');

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.DeleteShiftAssignment({ id, organization_id: organizationId }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(response, 200);
      } catch (error) {
        const m = mapGrpcError(error, 'Failed to delete assignment');
        return c.json({ error: m.error }, m.status);
      }
    },
  );

  // ================
  // Atomic Move (Phase 2)
  // ================
  const moveShiftSchema = z
    .object({
      employee_ids: z
        .array(z.string().min(1, 'employee_id must not be empty'))
        .min(1, 'employee_ids must not be empty')
        .max(500, 'Too many employees in a single move'),
      destination_shift_id: z.string().min(1, 'destination_shift_id is required'),
      effective_from: z
        .string({ required_error: 'effective_from is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be a YYYY-MM-DD business date'),
    })
    .strict();

  openapi(
    {
      method: 'post',
      path: '/shift-assignments/move',
      tags: ['ShiftAssignment'],
      summary: 'Atomically move one or more employees to a destination shift from a business date',
      request: {
        body: {
          content: {
            'application/json': {
              schema: moveShiftSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Move completed (all employees) — transactional, all-or-nothing',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                effective_from: z.string(),
                destination_shift_id: z.string(),
                results: z.array(
                  z.object({
                    employee_id: z.string(),
                    previous_assignment_id: z.string(),
                    previous_shift_id: z.string(),
                    previous_valid_to: z.string(),
                    new_assignment_id: z.string(),
                    new_shift_id: z.string(),
                    new_valid_from: z.string(),
                    new_valid_to: z.string(),
                  }),
                ),
              }),
            },
          },
        },
        400: { description: 'Validation error' },
        404: { description: 'Employee or shift not found' },
        409: { description: 'Conflicting assignment exists' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = moveShiftSchema.parse(await c.req.json());

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.MoveShift(
            { organization_id: organizationId, ...body },
            (err, resp) => (err ? reject(err) : resolve(resp)),
          );
        });

        return c.json(response, 200);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const m = mapGrpcError(error, 'Failed to move employees');
        return c.json({ error: m.error }, m.status);
      }
    },
  );

  // ================
  // Atomic Change (Phase 2.4)
  // ================
  const changeShiftSchema = z
    .object({
      employee_id: z.string().min(1, 'employee_id is required'),
      shift_id: z.string().min(1, 'shift_id is required'),
      effective_from: z
        .string({ required_error: 'effective_from is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be a YYYY-MM-DD business date'),
      valid_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'valid_to must be a YYYY-MM-DD business date')
        .optional()
        .or(z.literal('')),
    })
    .strict();

  openapi(
    {
      method: 'post',
      path: '/shift-assignments/change',
      tags: ['ShiftAssignment'],
      summary: 'Atomically change an employee shift: close covering assignment at D-1 and create the destination shift from D',
      request: {
        body: {
          content: {
            'application/json': {
              schema: changeShiftSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Change persisted (transactional, all-or-nothing)',
          content: {
            'application/json': {
              schema: z.object({
                previous_assignment: assignmentResponseSchema.optional(),
                assignment: assignmentResponseSchema,
              }),
            },
          },
        },
        400: { description: 'Validation error (incl. same-shift / past date)' },
        404: { description: 'Employee, shift, or covering assignment not found' },
        409: { description: 'Conflicting/future assignment exists' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = changeShiftSchema.parse(await c.req.json());

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.ChangeShiftAssignment(
            { organization_id: organizationId, ...body },
            (err, resp) => (err ? reject(err) : resolve(resp)),
          );
        });

        return c.json(response, 200);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const m = mapGrpcError(error, 'Failed to change shift assignment');
        return c.json({ error: m.error }, m.status);
      }
    },
  );

  // ================
  // Atomic Swap (Phase 2.5)
  // ================
  const swapShiftSchema = z
    .object({
      employee_a_id: z.string().min(1, 'employee_a_id is required'),
      employee_b_id: z.string().min(1, 'employee_b_id is required'),
      effective_from: z
        .string({ required_error: 'effective_from is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be a YYYY-MM-DD business date'),
    })
    .strict();

  openapi(
    {
      method: 'post',
      path: '/shift-assignments/swap',
      tags: ['ShiftAssignment'],
      summary:
        'Atomically swap exactly two employees’ covering shifts from a business date, preserving assignment history',
      request: {
        body: {
          content: {
            'application/json': {
              schema: swapShiftSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Swap persisted (transactional, all-or-nothing for both employees)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                effective_from: z.string(),
                employee_a: z.object({
                  employee_id: z.string(),
                  previous_assignment: assignmentResponseSchema,
                  new_assignment: assignmentResponseSchema,
                }),
                employee_b: z.object({
                  employee_id: z.string(),
                  previous_assignment: assignmentResponseSchema,
                  new_assignment: assignmentResponseSchema,
                }),
              }),
            },
          },
        },
        400: { description: 'Validation error (incl. same employee / same shift / past date)' },
        403: { description: 'Employee or shift outside the authorized organization' },
        404: { description: 'Employee, shift, or covering assignment not found' },
        409: { description: 'Conflicting/future assignment exists or concurrent change aborted the swap' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = swapShiftSchema.parse(await c.req.json());

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.SwapShiftAssignment(
            { organization_id: organizationId, ...body },
            (err, resp) => (err ? reject(err) : resolve(resp)),
          );
        });

        return c.json(response, 200);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const m = mapGrpcError(error, 'Failed to swap shift assignments');
        return c.json({ error: m.error }, m.status);
      }
    },
  );

  // ================
  // Atomic Rotation (Phase 2.6)
  // ================
  const rotateShiftSchema = z
    .object({
      shift_1_id: z.string().min(1, 'shift_1_id is required'),
      shift_2_id: z.string().min(1, 'shift_2_id is required'),
      shift_3_id: z.string().min(1, 'shift_3_id is required'),
      effective_from: z
        .string({ required_error: 'effective_from is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be a YYYY-MM-DD business date'),
    })
    .strict();

  // Employee-scope tokens must get a 403 (Admin access required), not the
  // requirePermission middleware's 401 — scope check runs before the permission check.
  const rotateGuard = async (c, next) => {
    if (!isAdminScope(c)) {
      return c.json({ error: 'Admin access required' }, 403);
    }
    return MANAGE_PERM(c, next);
  };

  openapi(
    {
      method: 'post',
      path: '/shift-assignments/rotate',
      tags: ['ShiftAssignment'],
      summary:
        'Atomically rotate all employees in three shift groups (1→2→3→1) from a business date, preserving assignment history',
      request: {
        body: {
          content: {
            'application/json': {
              schema: rotateShiftSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description:
            'Rotation persisted (transactional, all-or-nothing for every affected employee)',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                effective_from: z.string(),
                shift_1_id: z.string(),
                shift_2_id: z.string(),
                shift_3_id: z.string(),
                affected_employee_count: z.number(),
                group_counts: z.array(
                  z.object({
                    shift_id: z.string(),
                    shift_name: z.string(),
                    employee_count: z.number(),
                  }),
                ),
                results: z.array(
                  z.object({
                    employee_id: z.string(),
                    previous_shift_id: z.string(),
                    new_shift_id: z.string(),
                    mode: z.string(),
                    previous_assignment: assignmentResponseSchema,
                    new_assignment: assignmentResponseSchema,
                  }),
                ),
              }),
            },
          },
        },
        400: {
          description:
            'Validation error (past date / duplicate shifts / no employees on the selected shifts)',
        },
        403: { description: 'Shift outside the authorized organization' },
        404: { description: 'One of the rotation shifts not found' },
        409: {
          description:
            'Rotation already applied for this date, future/conflicting assignment exists, or concurrent change aborted the rotation',
        },
      },
      middleware: rotateGuard,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = rotateShiftSchema.parse(await c.req.json());

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.RotateShiftAssignment(
            { organization_id: organizationId, ...body },
            (err, resp) => (err ? reject(err) : resolve(resp)),
          );
        });

        return c.json(response, 200);
      } catch (error) {
        if (error instanceof ZodError) {
          return c.json(
            {
              error: 'Validation failed',
              details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
              })),
            },
            400,
          );
        }
        const m = mapGrpcError(error, 'Failed to rotate shift assignments');
        return c.json({ error: m.error }, m.status);
      }
    },
  );

  // ================
  // Bulk Import
  // ================
  openapi(
    {
      method: 'post',
      path: '/shift-assignments/import',
      tags: ['Shift Assignment'],
      summary: 'Bulk import shift assignments from parsed Excel/CSV',
      requestBody: {
        content: {
          'application/json': {
            schema: z.object({
              organization_id: z.string(),
              items: z.array(z.object({
                employee_id: z.string(),
                shift_id: z.string(),
                valid_from: z.string(),
                valid_to: z.string().optional(),
              })).min(1),
            }),
          },
        },
      },
      responses: {
        200: { description: 'Import completed' },
      },
      middleware: MANAGE_PERM,
    },
    async (c) => {
      try {
        if (!isAdminScope(c)) {
          return c.json({ error: 'Admin access required' }, 403);
        }
        const organizationId = requireOrganizationId(c);
        if (!organizationId) {
          return c.json({ error: 'Valid organization context is required (x-org-id header or organization_id)' }, 400);
        }
        const body = await c.req.json();
        const { organization_id, items } = body;

        if (!items?.length) {
          return c.json({ error: 'items required' }, 400);
        }
        if (organization_id && organization_id !== organizationId) {
          return c.json({ error: 'organization_id does not match organization context' }, 400);
        }

        const results = [];
        for (const item of items) {
          try {
            const response = await new Promise((resolve, reject) => {
              shiftAssignmentClient.AssignShift({
                employee_id: item.employee_id,
                shift_id: item.shift_id,
                valid_from: item.valid_from,
                valid_to: item.valid_to || '',
                organization_id: organizationId,
              }, (err, resp) => (err ? reject(err) : resolve(resp)));
            });
            results.push({ employee_id: item.employee_id, status: 'SUCCESS', assignment_id: response.assignment?.id });
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
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    },
  );
}
