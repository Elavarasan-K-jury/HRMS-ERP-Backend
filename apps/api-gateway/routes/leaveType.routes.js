// src/routes/leaveType.routes.js
import { z } from 'zod';
import { leaveTypeClient } from '../grpc/leaveType.client.js';

export default function registerLeaveTypeRoutes({ openapi }) {

    /* -------------------------------------------------------
     🧩 Shared Schemas
    ------------------------------------------------------- */

    const LeaveTypeSchema = z.object({
        id: z.string(),
        organization_id: z.string(),

        name: z.string(),
        code: z.string(),
        description: z.string().nullable().optional(),

        paid: z.boolean(),
        max_per_year: z.number(),

        allow_half_day: z.boolean(),
        requires_document: z.boolean(),
        document_after_days: z.number(),

        carry_forward: z.boolean(),
        max_carry_forward: z.number(),

        encashment_allowed: z.boolean(),
        max_encash_per_year: z.number(),

        gender_restriction: z.string(),

        probation_allowed: z.boolean(),
        min_service_months: z.number(),

        max_consecutive_days: z.number(),
        sandwich_rule: z.boolean(),

        accrual_enabled: z.boolean(),
        accrual_frequency: z.string(),
        accrue_after_days: z.number(),
        monthly_accrual_rate: z.number(),

        is_active: z.boolean(),

        created_at: z.string(),
        updated_at: z.string(),
        deleted_at: z.string(),
    });

    const LeaveTypeResponseSchema = z.object({
        leave_type: LeaveTypeSchema.optional().nullable(),
        success: z.string().nullable().optional(),
        message: z.string().nullable().optional(),
    });

    const LeaveTypeListResponseSchema = z.object({
        leave_types: z.array(LeaveTypeSchema),
    });

    /* -------------------------------------------------------
     🟢 Create Leave Type
    ------------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/leave-types',
            tags: ['Leave Types'],
            summary: 'Create a new leave type',
            description: 'Creates a new leave type within an organization.',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),

                                name: z.string(),
                                code: z.string(),
                                description: z.string().optional(),

                                paid: z.boolean().default(true),
                                max_per_year: z.number().default(0),

                                allow_half_day: z.boolean().default(true),
                                requires_document: z.boolean().default(false),
                                document_after_days: z.number().default(0),

                                carry_forward: z.boolean().default(false),
                                max_carry_forward: z.number().default(0),

                                encashment_allowed: z.boolean().default(false),
                                max_encash_per_year: z.number().default(0),

                                gender_restriction: z.string().default("NONE"),

                                probation_allowed: z.boolean().default(true),
                                min_service_months: z.number().default(0),

                                max_consecutive_days: z.number().default(0),
                                sandwich_rule: z.boolean().default(false),

                                accrual_enabled: z.boolean().default(false),
                                accrual_frequency: z.string().default('monthly'),
                                accrue_after_days: z.number().default(0),
                                monthly_accrual_rate: z.number().default(0),
                            }),
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Leave type created successfully',
                    content: { 'application/json': { schema: LeaveTypeResponseSchema } },
                },
                500: {
                    description: 'Server error',
                    content: { 'application/json': { schema: z.object({ error: z.string() }) } },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    leaveTypeClient.CreateLeaveType(body, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                console.error('CreateLeaveType error:', error);
                return c.json({ error: error.message }, 500);
            }
        },
    );

    /* -------------------------------------------------------
     🟣 Update Leave Type
    ------------------------------------------------------- */
    openapi(
        {
            method: 'put',
            path: '/leave-types/{id}',
            tags: ['Leave Types'],
            summary: 'Update an existing leave type',
            description: 'Updates all editable attributes of a leave type.',
            request: {
                params: z.object({
                    id: z.string(),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.any(), // rely on proto validation
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Leave type updated successfully',
                    content: { 'application/json': { schema: LeaveTypeResponseSchema } },
                },
                404: {
                    description: 'Leave type not found',
                },
                500: {
                    description: 'Server error',
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    leaveTypeClient.UpdateLeaveType({ id, data: body }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                const code = error.code === 5 ? 404 : 500;
                return c.json({ error: error.message }, code);
            }
        },
    );

    /* -------------------------------------------------------
     🟤 Get Leave Type by ID
    ------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/leave-types/{id}',
            tags: ['Leave Types'],
            summary: 'Get leave type details',
            description: 'Fetches a leave type by its ID.',
            request: {
                params: z.object({
                    id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'Leave type details',
                    content: { 'application/json': { schema: LeaveTypeResponseSchema } },
                },
                404: {
                    description: 'Not found',
                },
                500: {
                    description: 'Server error',
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    leaveTypeClient.GetLeaveType({ id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        },
    );

    /* -------------------------------------------------------
     🟠 List Leave Types
    ------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/leave-types',
            tags: ['Leave Types'],
            summary: 'List all leave types',
            description: 'Returns all leave types for a given organization.',
            request: {
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'List of leave types',
                    content: { 'application/json': { schema: LeaveTypeListResponseSchema } },
                },
                500: {
                    description: 'Server error',
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    leaveTypeClient.ListLeaveTypes(query, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        },
    );

    /* -------------------------------------------------------
     🔴 Delete Leave Type (Soft Delete)
    ------------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/leave-types/{id}',
            tags: ['Leave Types'],
            summary: 'Delete leave type',
            description: 'Soft deletes a leave type.',
            request: {
                params: z.object({
                    id: z.string(),
                }),
            },
            responses: {
                200: {
                    description: 'Leave type deleted',
                    content: { 'application/json': { schema: z.object({ message: z.string(), success: z.string() }) } },
                },
                404: {
                    description: 'Leave type not found',
                },
                500: {
                    description: 'Server error',
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    leaveTypeClient.DeleteLeaveType({ id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        },
    );
}
