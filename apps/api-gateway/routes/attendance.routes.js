import { z, ZodError } from 'zod';
import { attendanceClient } from '../grpc/attendance.client.js';

export default function registerAttendanceRoutes({ openapi }) {
  /* ---------------------------
     Schemas
  --------------------------- */

  const checkInSchema = z
    .object({
      employee_id: z.string(),
      ip_address: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      source: z.string().optional(),
    })
    .strict();

  const checkOutSchema = checkInSchema; // same fields

  const recomputeSchema = z
    .object({
      employee_id: z.string(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-mm-dd')
        .optional(),
    })
    .strict();

  const attendanceObjectSchema = z.object({
    id: z.string(),
    organization_id: z.string(),
    employee_id: z.string(),
    date: z.string(),
    check_in: z.string().optional(),
    check_out: z.string().optional(),
    gross_hours: z.number(),
    effective_hours: z.number(),
    late_arrival_minutes: z.number(),
    status: z.string(),
  });

  const listAttendanceQuerySchema = z.object({
    employee_id: z.string(),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  });

  /* AttendancePolicy schemas */

  const attendancePolicyCreateSchema = z
    .object({
      organization_id: z.string(),
      name: z.string().min(2),
      grace_minutes: z.number().int().min(0).optional(),
      half_day_minutes: z.number().int().min(0).optional(),
      full_day_minutes: z.number().int().min(0).optional(),
      allow_geo_checkin: z.boolean().optional(),
      allow_outside_geo: z.boolean().optional(),
      auto_mark_absent: z.boolean().optional(),
      checkin_buffer_min: z.number().int().min(0).optional(),
      checkout_buffer_min: z.number().int().min(0).optional(),
      rounding_strategy: z.string().optional(),
      overtime_allowed: z.boolean().optional(),
      min_overtime_minutes: z.number().int().min(0).optional(),
    })
    .strict();

  const attendancePolicyResponseSchema = z.object({
    id: z.string(),
    organization_id: z.string(),
    name: z.string(),
    grace_minutes: z.number(),
    half_day_minutes: z.number(),
    full_day_minutes: z.number(),
    allow_geo_checkin: z.boolean(),
    allow_outside_geo: z.boolean(),
    auto_mark_absent: z.boolean(),
    checkin_buffer_min: z.number(),
    checkout_buffer_min: z.number(),
    rounding_strategy: z.string(),
    overtime_allowed: z.boolean(),
    min_overtime_minutes: z.number(),
  });

  /* NetworkPolicy schemas */

  const networkPolicyCreateSchema = z
    .object({
      organization_id: z.string(),
      name: z.string().min(2),
      enforce_on: z
        .enum(['ATTENDANCE', 'LOGIN', 'BOTH'])
        .default('ATTENDANCE')
        .optional(),
      allowed_ips: z.array(z.string()).optional(),
    })
    .strict();

  const networkPolicyResponseSchema = z.object({
    id: z.string(),
    organization_id: z.string(),
    name: z.string(),
    enforce_on: z.string(),
    allowed_ips: z.array(z.string()),
  });

  /* GeoFence schemas */

  const geoFenceCreateSchema = z
    .object({
      organization_id: z.string(),
      name: z.string().min(2),
      latitude: z.number(),
      longitude: z.number(),
      radius_meters: z.number().int().positive(),
    })
    .strict();

  const geoFenceResponseSchema = z.object({
    id: z.string(),
    organization_id: z.string(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    radius_meters: z.number(),
  });

  /* ============================================================
     ROUTES
  ============================================================ */

  // ------------------ Check-In ------------------
  openapi(
    {
      method: 'post',
      path: '/attendance/check-in',
      tags: ['Attendance'],
      summary: 'Employee check-in',
      request: {
        body: {
          content: {
            'application/json': {
              schema: checkInSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Check-in successful',
          content: {
            'application/json': {
              schema: attendanceObjectSchema,
            },
          },
        },
        400: { description: 'Validation / policy error' },
      },
    },
    async (c) => {
      try {
        const body = checkInSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.CheckIn(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 200);
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

        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // ------------------ Check-Out ------------------
  openapi(
    {
      method: 'post',
      path: '/attendance/check-out',
      tags: ['Attendance'],
      summary: 'Employee check-out',
      request: {
        body: {
          content: {
            'application/json': {
              schema: checkOutSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Check-out successful',
          content: {
            'application/json': {
              schema: attendanceObjectSchema,
            },
          },
        },
        400: { description: 'Validation / policy error' },
      },
    },
    async (c) => {
      try {
        const body = checkOutSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.CheckOut(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 200);
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

        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // ------------------ Recompute ------------------
  openapi(
    {
      method: 'post',
      path: '/attendance/recompute',
      tags: ['Attendance'],
      summary: 'Recompute attendance for a given date',
      request: {
        body: {
          content: {
            'application/json': {
              schema: recomputeSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Attendance recomputed',
          content: {
            'application/json': {
              schema: attendanceObjectSchema,
            },
          },
        },
        404: { description: 'No attendance for given date' },
      },
    },
    async (c) => {
      try {
        const body = recomputeSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.RecomputeAttendance(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 200);
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

        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // ------------------ List Attendance ------------------
  openapi(
    {
      method: 'get',
      path: '/attendance',
      tags: ['Attendance'],
      summary: 'List attendance for an employee in a month',
      request: {
        query: listAttendanceQuerySchema,
      },
      responses: {
        200: {
          description: 'List of attendance records',
          content: {
            'application/json': {
              schema: z.object({
                attendance: z.array(attendanceObjectSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query');

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.ListAttendance(
            {
              employee_id: query.employee_id,
              month: query.month,
            },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
      } catch (error) {
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  /* ============================================================
     Attendance Policy Routes
  ============================================================ */

  // Create
  openapi(
    {
      method: 'post',
      path: '/attendance-policies',
      tags: ['Attendance Policies'],
      summary: 'Create attendance policy',
      request: {
        body: {
          content: {
            'application/json': {
              schema: attendancePolicyCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Created',
          content: {
            'application/json': {
              schema: attendancePolicyResponseSchema,
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const body = attendancePolicyCreateSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.CreateAttendancePolicy(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 201);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // Update
  openapi(
    {
      method: 'put',
      path: '/attendance-policies/{id}',
      tags: ['Attendance Policies'],
      summary: 'Update attendance policy',
      request: {
        params: z.object({
          id: z.string(),
        }),
        body: {
          content: {
            'application/json': {
              schema: attendancePolicyCreateSchema.partial(),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Updated',
          content: {
            'application/json': {
              schema: attendancePolicyResponseSchema,
            },
          },
        },
        404: { description: 'Not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = attendancePolicyCreateSchema
          .partial()
          .parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.UpdateAttendancePolicy(
            { policy_id: id, data: body },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // List
  openapi(
    {
      method: 'get',
      path: '/attendance-policies',
      tags: ['Attendance Policies'],
      summary: 'List attendance policies for org',
      request: {
        query: z.object({
          organization_id: z.string(),
        }),
      },
      responses: {
        200: {
          description: 'List',
          content: {
            'application/json': {
              schema: z.object({
                policies: z.array(attendancePolicyResponseSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query');

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.ListAttendancePolicy(
            { organization_id: query.organization_id },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
      } catch (error) {
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  /* ============================================================
     Network Policy Routes
  ============================================================ */

  // Create
  openapi(
    {
      method: 'post',
      path: '/network-policies',
      tags: ['Network Policies'],
      summary: 'Create network policy (IP restriction)',
      request: {
        body: {
          content: {
            'application/json': {
              schema: networkPolicyCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Created',
          content: {
            'application/json': {
              schema: networkPolicyResponseSchema,
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const body = networkPolicyCreateSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.CreateNetworkPolicy(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 201);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // Update
  openapi(
    {
      method: 'put',
      path: '/network-policies/{id}',
      tags: ['Network Policies'],
      summary: 'Update network policy',
      request: {
        params: z.object({
          id: z.string(),
        }),
        body: {
          content: {
            'application/json': {
              schema: networkPolicyCreateSchema.partial(),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Updated',
          content: {
            'application/json': {
              schema: networkPolicyResponseSchema,
            },
          },
        },
        404: { description: 'Not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = networkPolicyCreateSchema
          .partial()
          .parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.UpdateNetworkPolicy(
            { policy_id: id, data: body },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // List
  openapi(
    {
      method: 'get',
      path: '/network-policies',
      tags: ['Network Policies'],
      summary: 'List network policies for org',
      request: {
        query: z.object({
          organization_id: z.string(),
        }),
      },
      responses: {
        200: {
          description: 'List',
          content: {
            'application/json': {
              schema: z.object({
                policies: z.array(networkPolicyResponseSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query');

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.ListNetworkPolicy(
            { organization_id: query.organization_id },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
      } catch (error) {
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  /* ============================================================
     GeoFence Routes
  ============================================================ */

  // Create
  openapi(
    {
      method: 'post',
      path: '/geo-fences',
      tags: ['Geo Fences'],
      summary: 'Create geofence for attendance',
      request: {
        body: {
          content: {
            'application/json': {
              schema: geoFenceCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Created',
          content: {
            'application/json': {
              schema: geoFenceResponseSchema,
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const body = geoFenceCreateSchema.parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.CreateGeoFence(body, (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
        });

        return c.json(resp, 201);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // Update
  openapi(
    {
      method: 'put',
      path: '/geo-fences/{id}',
      tags: ['Geo Fences'],
      summary: 'Update geofence',
      request: {
        params: z.object({
          id: z.string(),
        }),
        body: {
          content: {
            'application/json': {
              schema: geoFenceCreateSchema.partial(),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Updated',
          content: {
            'application/json': {
              schema: geoFenceResponseSchema,
            },
          },
        },
        404: { description: 'Not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = geoFenceCreateSchema.partial().parse(await c.req.json());

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.UpdateGeoFence(
            { geofence_id: id, data: body },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
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
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );

  // List
  openapi(
    {
      method: 'get',
      path: '/geo-fences',
      tags: ['Geo Fences'],
      summary: 'List geofences for organization',
      request: {
        query: z.object({
          organization_id: z.string(),
        }),
      },
      responses: {
        200: {
          description: 'List',
          content: {
            'application/json': {
              schema: z.object({
                geofences: z.array(geoFenceResponseSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query');

        const resp = await new Promise((resolve, reject) => {
          attendanceClient.ListGeoFence(
            { organization_id: query.organization_id },
            (err, res) => {
              if (err) return reject(err);
              resolve(res);
            },
          );
        });

        return c.json(resp, 200);
      } catch (error) {
        return c.json(
          { error: error.message || 'Internal server error' },
          500,
        );
      }
    },
  );
}
