import { z, ZodError } from 'zod';
import { shiftPolicyClient } from '../grpc/shift_policy.client.js';

export default function registerShiftPolicyRoutes({ openapi }) {
  // Reusable core schema
  const baseShiftPolicySchema = z.object({
    organization_id: z.string({ required_error: 'Organization ID is required' }),
    name: z
      .string({ required_error: 'Policy name is required' })
      .min(2, 'Name must have at least 2 characters'),

    auto_assign: z.boolean().optional().default(false),

    grace_before_start: z
      .number()
      .int()
      .min(0, 'Grace before start cannot be negative')
      .optional(),

    grace_after_end: z
      .number()
      .int()
      .min(0, 'Grace after end cannot be negative')
      .optional(),

    night_shift_start: z
      .string()
      .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'night_shift_start must be HH:mm format')
      .optional(),

    night_shift_end: z
      .string()
      .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'night_shift_end must be HH:mm format')
      .optional(),

    rotational: z.boolean().optional().default(false),

    rotation_period: z
      .number()
      .int()
      .positive('rotation_period must be positive')
      .optional(),

    is_active: z.boolean().optional().default(true),
  });

  // For create, all required as defined above
  const createShiftPolicySchema = baseShiftPolicySchema
    .refine(
      (data) => !data.rotational || typeof data.rotation_period === 'number',
      {
        message: 'rotation_period is required when rotational=true',
        path: ['rotation_period'],
      },
    )
    .strict();

  // For update, all optional
  const updateShiftPolicySchema = baseShiftPolicySchema
    .partial()
    .refine(
      (data) => {
        if (data.rotational === true && data.rotation_period === undefined) {
          return false;
        }
        return true;
      },
      {
        message: 'rotation_period is required when rotational=true',
        path: ['rotation_period'],
      },
    )
    .strict();

  const shiftPolicyResponseSchema = z.object({
    id: z.string(),
    organization_id: z.string(),
    name: z.string(),
    auto_assign: z.boolean(),
    grace_before_start: z.number(),
    grace_after_end: z.number(),
    night_shift_start: z.string(),
    night_shift_end: z.string(),
    rotational: z.boolean(),
    rotation_period: z.number(),
    is_active: z.boolean(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    deleted_at: z.string().optional(),
  });

  // ----------------------------------------------------
  // POST /shift-policies  → Create shift policy
  // ----------------------------------------------------
  openapi(
    {
      method: 'post',
      path: '/shift-policies',
      tags: ['Shift Policies'],
      summary: 'Create a new shift policy',
      request: {
        body: {
          content: {
            'application/json': {
              schema: createShiftPolicySchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Shift policy created successfully',
          content: {
            'application/json': {
              schema: shiftPolicyResponseSchema,
            },
          },
        },
        400: { description: 'Validation error' },
      },
    },
    async (c) => {
      try {
        const body = await c.req.json();
        const parsed = createShiftPolicySchema.parse(body);

        const response = await new Promise((resolve, reject) => {
          shiftPolicyClient.CreateShiftPolicy(parsed, (err, resp) => {
            if (err) return reject(err);
            resolve(resp.policy);
          });
        });

        return c.json(response, 201);
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

        return c.json({ error: error.message || 'Internal server error' }, 500);
      }
    },
  );

  // ----------------------------------------------------
  // GET /shift-policies/{id}  → Get by ID
  // ----------------------------------------------------
  openapi(
    {
      method: 'get',
      path: '/shift-policies/{id}',
      tags: ['Shift Policies'],
      summary: 'Fetch a shift policy by ID',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Policy ID is required' }),
        }),
      },
      responses: {
        200: {
          description: 'Shift policy details',
          content: {
            'application/json': {
              schema: shiftPolicyResponseSchema,
            },
          },
        },
        404: { description: 'Shift policy not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const response = await new Promise((resolve, reject) => {
          shiftPolicyClient.GetShiftPolicy({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp.policy);
          });
        });

        if (!response) {
          return c.json({ error: 'Shift policy not found' }, 404);
        }

        return c.json(response, 200);
      } catch (error) {
        return c.json({ error: error.message || 'Internal server error' }, 500);
      }
    },
  );

  // ----------------------------------------------------
  // GET /shift-policies  → List by organization
  // ?organization_id=...&only_active=true
  // ----------------------------------------------------
  openapi(
    {
      method: 'get',
      path: '/shift-policies',
      tags: ['Shift Policies'],
      summary: 'List shift policies for an organization',
      request: {
        query: z.object({
          organization_id: z.string({
            required_error: 'Organization ID is required',
          }),
          only_active: z
            .string()
            .optional()
            .default('false'),
        }),
      },
      responses: {
        200: {
          description: 'List of shift policies',
          content: {
            'application/json': {
              schema: z.object({
                policies: z.array(shiftPolicyResponseSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid('query');

        const onlyActive =
          query.only_active?.toLowerCase() === 'true' ? true : false;

        const response = await new Promise((resolve, reject) => {
          shiftPolicyClient.ListShiftPolicies(
            {
              organization_id: query.organization_id,
              only_active: onlyActive,
            },
            (err, resp) => {
              if (err) return reject(err);
              resolve(resp);
            },
          );
        });

        return c.json(response, 200);
      } catch (error) {
        return c.json({ error: error.message || 'Internal server error' }, 500);
      }
    },
  );

  // ----------------------------------------------------
  // PUT /shift-policies/{id}  → Update policy
  // ----------------------------------------------------
  openapi(
    {
      method: 'put',
      path: '/shift-policies/{id}',
      tags: ['Shift Policies'],
      summary: 'Update a shift policy',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Policy ID is required' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: updateShiftPolicySchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Shift policy updated successfully',
          content: {
            'application/json': {
              schema: shiftPolicyResponseSchema,
            },
          },
        },
        400: { description: 'Validation error' },
        404: { description: 'Shift policy not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = updateShiftPolicySchema.parse(await c.req.json());

        const payload = { id, ...body };

        const response = await new Promise((resolve, reject) => {
          shiftPolicyClient.UpdateShiftPolicy(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp.policy);
          });
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

        return c.json({ error: error.message || 'Internal server error' }, 500);
      }
    },
  );

  // ----------------------------------------------------
  // DELETE /shift-policies/{id} → Soft delete policy
  // ----------------------------------------------------
  openapi(
    {
      method: 'delete',
      path: '/shift-policies/{id}',
      tags: ['Shift Policies'],
      summary: 'Soft delete a shift policy',
      request: {
        params: z.object({
          id: z.string({ required_error: 'Policy ID is required' }),
        }),
      },
      responses: {
        200: {
          description: 'Shift policy deleted successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: z.boolean(),
                message: z.string(),
              }),
            },
          },
        },
        404: { description: 'Shift policy not found' },
      },
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const response = await new Promise((resolve, reject) => {
          shiftPolicyClient.DeleteShiftPolicy({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(response, 200);
      } catch (error) {
        return c.json({ error: error.message || 'Internal server error' }, 500);
      }
    },
  );
}
