import { z, ZodError } from "zod";
import { organizationSubscriptionClient } from "../grpc/organization_subscription.client.js";

export default function registerOrganizationSubscriptionRoutes({ openapi }) {
    /* ----------------------------------------------------
       🧩 Schemas
    ---------------------------------------------------- */

    const orgParamSchema = z.object({
        organization_id: z.string({ required_error: "organization_id is required" }),
    });

    const assignPlanSchema = z.object({
        plan_id: z.string({ required_error: "plan_id is required" }),
        billing_interval: z.enum(["MONTHLY", "YEARLY"]).optional(),
    }).strict();

    const cancelSubscriptionSchema = z.object({
        cancel_at_period_end: z.boolean().optional().default(false),
    }).strict();

    const changePlanSchema = z.object({
        new_plan_id: z.string({ required_error: "new_plan_id is required" }),
        effective_immediately: z.boolean().optional().default(true),
        reason: z.string().optional(),
    }).strict();

    /* ----------------------------------------------------
       🟢 Assign Plan to Organization
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/organizations/{organization_id}/subscription",
            tags: ["Organization Subscription"],
            summary: "Assign a subscription plan to an organization",
            request: {
                params: orgParamSchema,
                body: {
                    content: {
                        "application/json": {
                            schema: assignPlanSchema,
                        },
                    },
                },
            },
            responses: {
                201: { description: "Subscription assigned successfully" },
                400: { description: "Validation error" },
                409: { description: "Organization already has active subscription" },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.param();
                const body = await c.req.json();
                const parsed = assignPlanSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    organizationSubscriptionClient.CreateSubscription(
                        {
                            organization_id,
                            plan_id: parsed.plan_id,
                            billing_interval: parsed.billing_interval,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: "Validation failed",
                            details: error.errors.map((e) => ({
                                field: e.path.join("."),
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

    /* ----------------------------------------------------
       🔵 Get Organization Subscription
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/organizations/{organization_id}/subscription",
            tags: ["Organization Subscription"],
            summary: "Get current subscription for an organization",
            request: {
                params: orgParamSchema,
            },
            responses: {
                200: { description: "Subscription retrieved successfully" },
                404: { description: "Subscription not found" },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    organizationSubscriptionClient.GetOrganizationSubscription(
                        { organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🔴 Cancel Subscription
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/organizations/{organization_id}/subscription/cancel",
            tags: ["Organization Subscription"],
            summary: "Cancel an organization's subscription",
            request: {
                params: orgParamSchema,
                body: {
                    content: {
                        "application/json": {
                            schema: cancelSubscriptionSchema,
                        },
                    },
                },
            },
            responses: {
                200: { description: "Subscription cancelled" },
                400: { description: "Invalid request" },
                404: { description: "Subscription not found" },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.param();
                const body = await c.req.json();
                const parsed = cancelSubscriptionSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    organizationSubscriptionClient.CancelSubscription(
                        {
                            organization_id,
                            cancel_at_period_end: parsed.cancel_at_period_end,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: "Validation failed",
                            details: error.errors.map((e) => ({
                                field: e.path.join("."),
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

    /* ----------------------------------------------------
       🔁 Change Subscription Plan
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/organizations/{organization_id}/subscription/change-plan",
            tags: ["Organization Subscription"],
            summary: "Change subscription plan (upgrade or downgrade)",
            request: {
                params: orgParamSchema,
                body: {
                    content: {
                        "application/json": {
                            schema: changePlanSchema,
                        },
                    },
                },
            },
            responses: {
                200: { description: "Subscription plan changed" },
                400: { description: "Invalid request" },
                404: { description: "Subscription or plan not found" },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.param();
                const body = await c.req.json();
                const parsed = changePlanSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    organizationSubscriptionClient.ChangePlan(
                        {
                            organization_id,
                            new_plan_id: parsed.new_plan_id,
                            effective_immediately: parsed.effective_immediately,
                            reason: parsed.reason,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: "Validation failed",
                            details: error.errors.map((e) => ({
                                field: e.path.join("."),
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
}
