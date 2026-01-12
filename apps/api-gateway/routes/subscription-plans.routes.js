import { z, ZodError } from 'zod';
import { subscriptionPlanClient } from '../grpc/subscription.client.js';

export default function registerSubscriptionPlanRoutes({ openapi }) {
    /* ----------------------------------------------------
       🧩 SHARED SCHEMAS
    ---------------------------------------------------- */

    const idParamSchema = z.object({
        id: z.string({ required_error: 'ID is required' }),
    });

    const paginationSchema = z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional().default(''),
        sort_by: z.string().optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).default('desc'),
    });

    /* ----------------------------------------------------
       🧩 PLAN SCHEMAS
    ---------------------------------------------------- */

    const createPlanSchema = z.object({
        name: z.string().min(2, 'Plan name must have at least 2 characters'),
        description: z.string().optional(),
        monthly_price: z.number().positive().optional(),
        yearly_price: z.number().positive().optional(),
        trial_days: z.number().int().positive().optional(),
        gst: z.number().min(0).max(100).optional(),
    });

    const updatePlanSchema = z.object({
        name: z.string().min(2).optional(),
        description: z.string().optional(),
        monthly_price: z.number().positive().optional(),
        yearly_price: z.number().positive().optional(),
        is_active: z.boolean().optional(),
        gst: z.number().min(0).max(100).optional(),
    });

    const addFeatureSchema = z.object({
        key: z.string(),
        value: z.number().optional(),
        unit: z.string().optional(),
        is_unlimited: z.boolean().optional(),
    });

    const updateFeatureSchema = z.object({
        value: z.number().optional(),
        unit: z.string().optional(),
        is_unlimited: z.boolean().optional(),
    });

    /* ====================================================
       🟢 CREATE SUBSCRIPTION PLAN
    ==================================================== */
    openapi(
        {
            method: 'get',
            path: '/payment/process-payment/{id}',
            tags: ['Subscription Plans'],
            summary: 'Process subscription plan',
            request: {
                params: idParamSchema,
            },
            responses: {
                201: { description: 'Subscription plan created' },
                400: { description: 'Validation error' },
            },
        },
        async (c) => {
            try {

                const { id } = c.req.param();
                const query = c.req.valid('query');

                console.log('subscription-plans.routes.js @ Line 79:', query, id);


                return c.json({}, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        { success: false, message: 'Validation failed', errors: error.errors },
                        400
                    );
                }
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );
    openapi(
        {
            method: 'post',
            path: '/subscription-plans',
            tags: ['Subscription Plans'],
            summary: 'Create subscription plan',
            request: {
                body: {
                    content: {
                        'application/json': { schema: createPlanSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Subscription plan created' },
                400: { description: 'Validation error' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const payload = createPlanSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.CreateSubscriptionPlan(
                        payload,
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        { success: false, message: 'Validation failed', errors: error.errors },
                        400
                    );
                }
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       🟣 GET SUBSCRIPTION PLAN
    ==================================================== */
    openapi(
        {
            method: 'get',
            path: '/subscription-plans/{id}',
            tags: ['Subscription Plans'],
            summary: 'Get subscription plan by ID',
            request: {
                params: idParamSchema,
            },
            responses: {
                200: { description: 'Subscription plan details' },
                404: { description: 'Not found' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.GetSubscriptionPlan(
                        { id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       🟡 LIST SUBSCRIPTION PLANS (PAGINATION + SEARCH)
    ==================================================== */
    openapi(
        {
            method: 'get',
            path: '/subscription-plans',
            tags: ['Subscription Plans'],
            summary: 'List subscription plans',
            request: {
                query: paginationSchema, // ✅ SAME AS ORGANIZATION ROUTES
            },
            responses: {
                200: { description: 'Paginated list of subscription plans' },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.ListSubscriptionPlans(
                        {
                            page: query.page,
                            limit: query.limit,
                            search: query.search,
                            sort_by: query.sort_by,
                            sort_order: query.sort_order,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       🟠 UPDATE SUBSCRIPTION PLAN
    ==================================================== */
    openapi(
        {
            method: 'put',
            path: '/subscription-plans/{id}',
            tags: ['Subscription Plans'],
            summary: 'Update subscription plan',
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        'application/json': { schema: updatePlanSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Subscription plan updated' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();
                const body = await c.req.json();
                const payload = updatePlanSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.UpdateSubscriptionPlan(
                        { id, ...payload },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        { success: false, message: 'Validation failed', errors: error.errors },
                        400
                    );
                }
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       🔴 DELETE SUBSCRIPTION PLAN
    ==================================================== */
    openapi(
        {
            method: 'delete',
            path: '/subscription-plans/{id}',
            tags: ['Subscription Plans'],
            summary: 'Delete subscription plan',
            request: {
                params: idParamSchema,
            },
            responses: {
                200: { description: 'Subscription plan deleted' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.DeleteSubscriptionPlan(
                        { id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       ➕ ADD PLAN FEATURE
    ==================================================== */
    openapi(
        {
            method: 'post',
            path: '/subscription-plans/{id}/features',
            tags: ['Subscription Plan Features'],
            summary: 'Add subscription plan feature',
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        'application/json': { schema: addFeatureSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Feature added' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();
                const body = await c.req.json();
                const payload = addFeatureSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.AddPlanFeature(
                        { plan_id: id, ...payload },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        { success: false, message: 'Validation failed', errors: error.errors },
                        400
                    );
                }
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );


    /* ====================================================
       🟠 UPDATE FEATURES
    ==================================================== */

    openapi(
        {
            method: 'put',
            path: '/subscription-plan-features/{id}',
            tags: ['Subscription Plan Features'],
            summary: 'Update subscription plan feature',
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        'application/json': { schema: updateFeatureSchema },
                    },
                },
            },
            responses: {
                200: { description: 'Feature updated' },
            },
        },
        async (c) => {
            const { id } = c.req.param();
            const body = await c.req.json();
            const payload = updateFeatureSchema.parse(body);

            const resp = await new Promise((resolve, reject) => {
                subscriptionPlanClient.UpdatePlanFeature(
                    { id, ...payload },
                    (err, res) => (err ? reject(err) : resolve(res))
                );
            });

            return c.json(resp, 200);
        }
    );

    /* ====================================================
       📋 LIST PLAN FEATURES
    ==================================================== */
    openapi(
        {
            method: 'get',
            path: '/subscription-plans/{id}/features',
            tags: ['Subscription Plan Features'],
            summary: 'List subscription plan features',
            request: {
                params: idParamSchema,
            },
            responses: {
                200: { description: 'List of plan features' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.ListPlanFeatures(
                        { plan_id: id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );

    /* ====================================================
       ➖ REMOVE PLAN FEATURE
    ==================================================== */
    openapi(
        {
            method: 'delete',
            path: '/subscription-plan-features/{id}',
            tags: ['Subscription Plan Features'],
            summary: 'Remove subscription plan feature',
            request: {
                params: idParamSchema,
            },
            responses: {
                200: { description: 'Feature removed' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    subscriptionPlanClient.RemovePlanFeature(
                        { id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ success: false, message: error.message }, 500);
            }
        }
    );
}
