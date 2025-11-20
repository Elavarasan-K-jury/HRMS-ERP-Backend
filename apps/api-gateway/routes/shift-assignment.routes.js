import { z, ZodError } from 'zod';
import { shiftAssignmentClient } from '../grpc/shift_assignment.client';

export default function registerShiftAssignmentRoutes({ openapi }) {
  const isoDateTime = z
    .string({ required_error: 'Datetime is required' })
    .datetime('Invalid datetime format');

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
    },
    async (c) => {
      try {
        const body = await c.req.json();
        const parsed = assignShiftSchema.parse(body);

        const assignment = await new Promise((resolve, reject) => {
          shiftAssignmentClient.AssignShift(parsed, (err, resp) => {
            if (err) return reject(err);
            resolve(resp.assignment);
          });
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
        return c.json({ error: error.message }, 500);
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

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.ListShiftAssignments(
            {
              employee_id: query.employee_id || '',
              shift_id: query.shift_id || '',
              active_only: query.active_only || false,
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
      valid_to: isoDateTime.optional(),
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
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = updateAssignmentSchema.parse(await c.req.json());

        const assignment = await new Promise((resolve, reject) => {
          shiftAssignmentClient.UpdateShiftAssignment(
            { id, ...body },
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
        return c.json({ error: error.message }, 500);
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
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const response = await new Promise((resolve, reject) => {
          shiftAssignmentClient.DeleteShiftAssignment({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(response, 200);
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    },
  );
}
