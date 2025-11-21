// src/routes/approval.routes.js
import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import {
  approvalFlowClient,
  approvalInstanceClient,
} from '../grpc/approval.client.js';

const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

// =======================================================
//  REGISTER ROUTES
// =======================================================
export default function registerApprovalRoutes({ openapi }) {
  // ---------------------------------------------------
  //  FLOW ROUTES
  // ---------------------------------------------------
  const flowLevelSchema = z.object({
    level: z.number().int().min(1),
    auto_approve_days: z.number().int().min(0).default(3),
    escalation_role: z.string().optional().nullable(),
    is_active: z.boolean().default(true),
    approvers: z
      .array(
        z.object({
          user_id: objectIdSchema.optional().nullable(),
          role: z.string().optional().nullable(),
        })
      )
      .default([]),
  });

  const createFlowSchema = z
    .object({
      organization_id: objectIdSchema,
      entity_type: z.enum(['LEAVE', 'REGULARISATION', 'WORKDAY']),
      levels: z.array(flowLevelSchema).min(1),
    })
    .strict();

  // POST /approval/flows
  openapi(
    {
      method: 'post',
      path: '/approval/flows',
      tags: ['Approval-Flow'],
      summary: 'Create approval flow',
      request: {
        body: {
          content: {
            'application/json': { schema: createFlowSchema },
          },
        },
      },
      responses: {
        201: { description: 'Created' },
        400: { description: 'Validation error' },
      },
    },
    async (c) => {
      try {
        const body = await c.req.json();
        const parsed = createFlowSchema.parse(body);

        const res = await new Promise((resolve, reject) => {
          approvalFlowClient.CreateFlow(parsed, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res, 201);
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
            400
          );
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // GET /approval/flows/{id}
  openapi(
    {
      method: 'get',
      path: '/approval/flows/{id}',
      tags: ['Approval-Flow'],
      summary: 'Get approval flow by id',
      request: {
        params: z.object({ id: objectIdSchema }),
      },
      responses: { 200: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const res = await new Promise((resolve, reject) => {
          approvalFlowClient.GetFlow({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        if (!res || !res.flow) {
          return c.json({ error: 'Not found' }, 404);
        }

        return c.json(res);
      } catch (error) {
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // GET /approval/flows
  openapi(
    {
      method: 'get',
      path: '/approval/flows',
      tags: ['Approval-Flow'],
      summary: 'List flows',
      request: {
        query: z.object({
          organization_id: objectIdSchema.optional(),
          entity_type: z.enum(['LEAVE', 'REGULARISATION', 'WORKDAY']).optional(),
        }),
      },
      responses: { 200: {} },
    },
    async (c) => {
      try {
        const q = c.req.valid('query');

        const res = await new Promise((resolve, reject) => {
          approvalFlowClient.ListFlows(q, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // PUT /approval/flows/{id}
  const updateFlowBodySchema = z.object({
    levels: z.array(flowLevelSchema).min(1),
  });

  openapi(
    {
      method: 'put',
      path: '/approval/flows/{id}',
      tags: ['Approval-Flow'],
      summary: 'Update approval flow',
      request: {
        params: z.object({ id: objectIdSchema }),
        body: {
          content: {
            'application/json': { schema: updateFlowBodySchema },
          },
        },
      },
      responses: { 200: {}, 400: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const parsed = updateFlowBodySchema.parse(body);

        const payload = {
          id,
          levels: parsed.levels,
        };

        const res = await new Promise((resolve, reject) => {
          approvalFlowClient.UpdateFlow(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
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
            400
          );
        }
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // DELETE /approval/flows/{id}
  openapi(
    {
      method: 'delete',
      path: '/approval/flows/{id}',
      tags: ['Approval-Flow'],
      summary: 'Soft delete approval flow',
      request: {
        params: z.object({ id: objectIdSchema }),
      },
      responses: { 200: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const res = await new Promise((resolve, reject) => {
          approvalFlowClient.DeleteFlow({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
      } catch (error) {
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // ---------------------------------------------------
  //  INSTANCE ROUTES
  // ---------------------------------------------------
  const startApprovalSchema = z
    .object({
      organization_id: objectIdSchema,
      entity_id: objectIdSchema,
      entity_type: z.enum(['LEAVE', 'REGULARISATION', 'WORKDAY']),
      employee_id: objectIdSchema,
    })
    .strict();

  // POST /approval/instances/start
  openapi(
    {
      method: 'post',
      path: '/approval/instances/start',
      tags: ['Approval-Instance'],
      summary: 'Start approval for an entity',
      request: {
        body: {
          content: {
            'application/json': { schema: startApprovalSchema },
          },
        },
      },
      responses: { 201: {}, 400: {}, 404: {} },
    },
    async (c) => {
      try {
        const body = await c.req.json();
        const parsed = startApprovalSchema.parse(body);

        const res = await new Promise((resolve, reject) => {
          approvalInstanceClient.StartApproval(parsed, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res, 201);
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
            400
          );
        }
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // GET /approval/instances/{id}
  openapi(
    {
      method: 'get',
      path: '/approval/instances/{id}',
      tags: ['Approval-Instance'],
      summary: 'Get approval instance by id',
      request: {
        params: z.object({ id: objectIdSchema }),
      },
      responses: { 200: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');

        const res = await new Promise((resolve, reject) => {
          approvalInstanceClient.GetApproval({ id }, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        if (!res || !res.approval) {
          return c.json({ error: 'Not found' }, 404);
        }

        return c.json(res);
      } catch (error) {
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  const actionSchema = z.object({
    remarks: z.string().optional().nullable(),
  });

  // POST /approval/instances/{id}/approve
  openapi(
    {
      method: 'post',
      path: '/approval/instances/{id}/approve',
      tags: ['Approval-Instance'],
      summary: 'Approve an instance',
      request: {
        params: z.object({ id: objectIdSchema }),
        body: {
          content: {
            'application/json': {
              schema: actionSchema.extend({
                approver_id: objectIdSchema,
              }),
            },
          },
        },
      },
      responses: { 200: {}, 400: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const parsed = actionSchema
          .extend({ approver_id: objectIdSchema })
          .parse(body);

        const payload = {
          id,
          approver_id: parsed.approver_id,
          remarks: parsed.remarks ?? null,
        };

        const res = await new Promise((resolve, reject) => {
          approvalInstanceClient.Approve(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
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
            400
          );
        }
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // POST /approval/instances/{id}/reject
  openapi(
    {
      method: 'post',
      path: '/approval/instances/{id}/reject',
      tags: ['Approval-Instance'],
      summary: 'Reject an instance',
      request: {
        params: z.object({ id: objectIdSchema }),
        body: {
          content: {
            'application/json': {
              schema: actionSchema.extend({
                approver_id: objectIdSchema,
              }),
            },
          },
        },
      },
      responses: { 200: {}, 400: {}, 404: {} },
    },
    async (c) => {
      try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const parsed = actionSchema
          .extend({ approver_id: objectIdSchema })
          .parse(body);

        const payload = {
          id,
          approver_id: parsed.approver_id,
          remarks: parsed.remarks ?? null,
        };

        const res = await new Promise((resolve, reject) => {
          approvalInstanceClient.Reject(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
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
            400
          );
        }
        if (error.code === grpc.status.NOT_FOUND) {
          return c.json({ error: error.message }, 404);
        }
        return c.json({ error: error.message }, 500);
      }
    }
  );

  // GET /approval/instances/pending
  openapi(
    {
      method: 'get',
      path: '/approval/instances/pending',
      tags: ['Approval-Instance'],
      summary: 'List pending approvals (KEKA-style: include all)',
      request: {
        query: z.object({
          organization_id: objectIdSchema,
          approver_id: objectIdSchema.optional(),
          page: z.string().transform(Number).default('1'),
          limit: z.string().transform(Number).default('10'),
        }),
      },
      responses: { 200: {} },
    },
    async (c) => {
      try {
        const q = c.req.valid('query');

        const payload = {
          organization_id: q.organization_id,
          approver_id: q.approver_id ?? '',
          page: q.page,
          limit: q.limit,
        };

        const res = await new Promise((resolve, reject) => {
          approvalInstanceClient.ListPending(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
        });

        return c.json(res);
      } catch (error) {
        return c.json({ error: error.message }, 500);
      }
    }
  );
}
