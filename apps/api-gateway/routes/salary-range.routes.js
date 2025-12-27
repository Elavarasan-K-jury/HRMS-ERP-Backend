import { z } from "zod";
import { SalaryRangeClient } from "../grpc/salary_range.client.js";

export default function registerSalaryRangeRoutes({ openapi }) {

    /* ============================================================
       1️⃣ CREATE RANGE
    ============================================================ */
    openapi(
        {
            method: "post",
            path: "/salary/templates/{template_id}/ranges",
            tags: ["Salary Ranges"],
            summary: "Create a salary range for a template",
            request: {
                params: z.object({
                    template_id: z.string(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                organization_id: z.string(),
                                gross_low: z.number(),
                                gross_high: z.number().optional(),
                                has_gross_high: z.boolean().default(false),
                                label: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: { description: "Range created successfully" },
            },
        },
        async (c) => {
            try {
                const { template_id } = c.req.valid("param");
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.CreateRange(
                        {
                            organization_id: body.organization_id,
                            template_id,
                            gross_low: body.gross_low,
                            gross_high: body.gross_high ?? 0,
                            has_gross_high: body.has_gross_high ?? false,
                            label: body.label ?? "",
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ============================================================
       2️⃣ UPDATE RANGE
    ============================================================ */
    openapi(
        {
            method: "put",
            path: "/salary/ranges/{range_id}",
            tags: ["Salary Ranges"],
            summary: "Update salary range",
            request: {
                params: z.object({
                    range_id: z.string(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                organization_id: z.string(),
                                gross_low: z.number(),
                                gross_high: z.number().optional(),
                                has_gross_high: z.boolean().default(false),
                                label: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: { description: "Range updated successfully" },
            },
        },
        async (c) => {
            try {
                const { range_id } = c.req.valid("param");
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.UpdateRange(
                        {
                            organization_id: body.organization_id,
                            range_id,
                            gross_low: body.gross_low,
                            gross_high: body.gross_high ?? 0,
                            has_gross_high: body.has_gross_high ?? false,
                            label: body.label ?? "",
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ============================================================
       3️⃣ DELETE RANGE
    ============================================================ */
    openapi(
        {
            method: "delete",
            path: "/salary/ranges/{range_id}",
            tags: ["Salary Ranges"],
            summary: "Delete salary range",
            request: {
                params: z.object({
                    range_id: z.string(),
                }),
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: { description: "Range deleted successfully" },
            },
        },
        async (c) => {
            try {
                const { range_id } = c.req.valid("param");
                const { organization_id } = c.req.valid("query");

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.DeleteRange(
                        { organization_id, range_id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ============================================================
       4️⃣ LIST RANGES FOR TEMPLATE
    ============================================================ */
    openapi(
        {
            method: "get",
            path: "/salary/templates/{template_id}/ranges",
            tags: ["Salary Ranges"],
            summary: "List salary ranges for template",
            request: {
                params: z.object({
                    template_id: z.string(),
                }),
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: { description: "Ranges fetched successfully" },
            },
        },
        async (c) => {
            try {
                const { template_id } = c.req.valid("param");
                const { organization_id } = c.req.valid("query");

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.ListRanges(
                        { organization_id, template_id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ============================================================
       5️⃣ SAVE RANGE COMPONENTS (FULL REPLACE)
    ============================================================ */
    openapi(
        {
            method: "post",
            path: "/salary/ranges/{range_id}/components",
            tags: ["Salary Ranges"],
            summary: "Save components for a salary range",
            request: {
                params: z.object({
                    range_id: z.string(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                organization_id: z.string(),
                                template_id: z.string(),
                                components: z.array(
                                    z.object({
                                        component_id: z.string(),
                                        kind: z.string().optional().nullable(),
                                        formula: z.string().optional().nullable(),
                                        value: z.number().optional().nullable(),
                                        priority: z.number().optional().nullable(),
                                        min_value: z.number().optional().nullable(),
                                        max_value: z.number().optional().nullable(),
                                        condition: z.string().optional().nullable(),
                                    })
                                ),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: { description: "Range components saved successfully" },
            },
        },
        async (c) => {
            try {
                const { range_id } = c.req.valid("param");
                const body = await c.req.json();

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.SaveRangeComponents(
                        {
                            organization_id: body.organization_id,
                            template_id: body.template_id,
                            range_id,
                            components: body.components,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ============================================================
       6️⃣ GET RANGE COMPONENTS
    ============================================================ */
    openapi(
        {
            method: "get",
            path: "/salary/ranges/{range_id}/components",
            tags: ["Salary Ranges"],
            summary: "Get components for a salary range",
            request: {
                params: z.object({
                    range_id: z.string(),
                }),
                query: z.object({
                    organization_id: z.string(),
                }),
            },
            responses: {
                200: { description: "Range components fetched successfully" },
            },
        },
        async (c) => {
            try {
                const { range_id } = c.req.valid("param");
                const { organization_id } = c.req.valid("query");

                const response = await new Promise((resolve, reject) => {
                    SalaryRangeClient.GetRangeComponents(
                        { organization_id, range_id },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );
}
