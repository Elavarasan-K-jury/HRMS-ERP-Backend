import { z, ZodError } from "zod";
import { salaryClient } from "../grpc/salary.client.js";

export default function registerSalaryRoutes({ openapi }) {

    /* ========================================================================
    1️⃣ ASSIGN SALARY TO EMPLOYEE
    ======================================================================== */
    openapi(
        {
            method: "post",
            path: "/salary/structure/assign",
            tags: ["Salary"],
            summary: "Assign salary to employee for the first time",
            request: {
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                employeeId: z.string(),
                                templateId: z.string(),
                                grossAnnual: z.number(),
                                effectiveFrom: z.string().optional(),
                                status: z.string().optional(),
                                isCurrentActive: z.boolean().optional(),
                                deductFromInHand: z.boolean().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: "Salary assigned successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
                400: { description: "Validation error" },
            },
        },

        async (c) => {
            try {
                const body = await c.req.json();

                const payload = {
                    employeeId: body.employeeId,
                    templateId: body.templateId,
                    grossAnnual: body.grossAnnual,
                    effectiveFrom: body.effectiveFrom ?? "",
                    status: body.status ?? "",
                    isCurrentActive: body.isCurrentActive ?? false,
                    deductFromInHand: body.deductFromInHand ?? false,
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.AssignSalary(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 201);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: "Validation failed", details: error.errors }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    2️⃣ UPDATE SALARY (GROSS or TEMPLATE CHANGE)
    ======================================================================== */
    openapi(
        {
            method: "put",
            path: "/salary/structure/{structureId}",
            tags: ["Salary"],
            summary: "Update employee salary (gross salary or template change)",
            request: {
                params: z.object({
                    structureId: z.string(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                newGrossAnnual: z.number(),
                                newTemplateId: z.string().optional(),

                                // Revision details
                                revisionType: z.string().optional(),
                                reason: z.string().optional(),
                                effectiveDate: z.string().optional(),
                                approvedBy: z.string().optional(),
                                approvalDate: z.string().optional(),

                                // Status fields
                                status: z.string().optional(),
                                isCurrentActive: z.boolean().optional(),
                                deductFromInHand: z.boolean().optional(),

                                // 🔥 NEW: Component overrides
                                componentOverrides: z.array(z.object({
                                    componentId: z.string(),
                                    value: z.number().optional(),
                                    formula: z.string().optional(),
                                    isOverridden: z.boolean().optional(),
                                    overrideNote: z.string().optional(),
                                })).optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Salary updated successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                                revision: z.any().optional(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const structureId = c.req.param("structureId");
                const body = await c.req.json();

                const payload = {
                    structureId,
                    newGrossAnnual: body.newGrossAnnual,
                    newTemplateId: body.newTemplateId ?? "",

                    revisionType: body.revisionType ?? "",
                    reason: body.reason ?? "",
                    effectiveDate: body.effectiveDate ?? "",
                    approvedBy: body.approvedBy ?? "",
                    approvalDate: body.approvalDate ?? "",

                    status: body.status ?? "",
                    isCurrentActive: body.isCurrentActive ?? false,
                    deductFromInHand: body.deductFromInHand ?? false,

                    componentOverrides: body.componentOverrides ?? [],
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.UpdateSalary(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: "Validation failed", details: error.errors }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    3️⃣ APPLY TEMPLATE TO STRUCTURE
    ======================================================================== */
    openapi(
        {
            method: "put",
            path: "/salary/structure/{structureId}/apply-template",
            tags: ["Salary"],
            summary: "Apply a new salary template to an existing structure",
            request: {
                params: z.object({ structureId: z.string() }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                templateId: z.string(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Template applied successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const structureId = c.req.param("structureId");
                const body = await c.req.json();

                const payload = {
                    structureId,
                    templateId: body.templateId,
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.ApplyTemplate(payload, (err, resp) => {
                        if (err) return reject(err);
                        return resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    4️⃣ RECALCULATE STRUCTURE
    ======================================================================== */
    openapi(
        {
            method: "post",
            path: "/salary/structure/{structureId}/recalculate",
            tags: ["Salary"],
            summary: "Re-run the full salary structure calculation",
            request: {
                params: z.object({ structureId: z.string() }),
            },
            responses: {
                200: {
                    description: "Recalculation completed",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const structureId = c.req.param("structureId");

                const payload = { structureId };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.Recalculate(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    5️⃣ GET CURRENT STRUCTURE FOR EMPLOYEE
    ======================================================================== */
    openapi(
        {
            method: "get",
            path: "/salary/structure/employee/{employeeId}",
            tags: ["Salary"],
            summary: "Get current active salary structure for employee",
            request: {
                params: z.object({ employeeId: z.string() }),
            },
            responses: {
                200: {
                    description: "Salary structure fetched successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const employeeId = c.req.param("employeeId");

                const payload = { employeeId };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.GetStructure(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ========================================================================
        5️⃣ GET STRUCTURE BY ID FOR EMPLOYEE
    ======================================================================== */
    openapi(
        {
            method: "get",
            path: "/salary/structure/employee/{employeeId}/{structureId}",
            tags: ["Salary"],
            summary: "Get a specific salary structure of an employee by structureId",
            request: {
                params: z.object({
                    employeeId: z.string(),
                    structureId: z.string()
                }),
            },
            responses: {
                200: {
                    description: "Salary structure fetched successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const employeeId = c.req.param("employeeId");
                const structureId = c.req.param("structureId");

                if (!employeeId || !structureId) {
                    return c.json({
                        success: false,
                        message: "employeeId & structureId are required"
                    }, 400);
                }

                const payload = {
                    employeeId,
                    structureId
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.GetStructureById(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );



    /* ========================================================================
    6️⃣ 🔥 NEW: GET SALARY REVISION HISTORY
    ======================================================================== */
    openapi(
        {
            method: "get",
            path: "/salary/revisions/employee/{employeeId}",
            tags: ["Salary"],
            summary: "Get complete salary revision history for an employee",
            request: {
                params: z.object({ employeeId: z.string() }),
                query: z.object({
                    limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
                }),
            },
            responses: {
                200: {
                    description: "Revision history fetched successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                revisions: z.array(z.any()),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const employeeId = c.req.param("employeeId");
                const limit = parseInt(c.req.query("limit") || "10");

                const payload = {
                    employeeId,
                    limit
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.GetRevisionHistory(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    7️⃣ 🔥 NEW: OVERRIDE SPECIFIC COMPONENT
    ======================================================================== */
    openapi(
        {
            method: "put",
            path: "/salary/structure/{structureId}/component/{componentId}/override",
            tags: ["Salary"],
            summary: "Override a specific salary component with custom value or formula",
            request: {
                params: z.object({
                    structureId: z.string(),
                    componentId: z.string(),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                value: z.number().optional(),
                                formula: z.string().optional(),
                                overrideNote: z.string().optional(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Component overridden successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const structureId = c.req.param("structureId");
                const componentId = c.req.param("componentId");
                const body = await c.req.json();

                const payload = {
                    structureId,
                    componentId,
                    value: body.value ?? 0,
                    formula: body.formula ?? "",
                    overrideNote: body.overrideNote ?? "",
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.OverrideComponent(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );


    /* ========================================================================
    8️⃣ 🔥 NEW: BULK RECALCULATE STRUCTURES
    ======================================================================== */
    openapi(
        {
            method: "post",
            path: "/salary/structure/bulk-recalculate",
            tags: ["Salary"],
            summary: "Recalculate salary structures for multiple employees at once",
            request: {
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                employeeIds: z.array(z.string()).min(1).max(100),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Bulk recalculation completed",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                results: z.array(z.object({
                                    employeeId: z.string(),
                                    structureId: z.string(),
                                    success: z.boolean(),
                                    error: z.string(),
                                })),
                                successCount: z.number(),
                                errorCount: z.number(),
                            }),
                        },
                    },
                },
                400: { description: "Validation error - max 100 employees per request" },
            },
        },

        async (c) => {
            try {
                const body = await c.req.json();

                if (!Array.isArray(body.employeeIds) || body.employeeIds.length === 0) {
                    return c.json({
                        error: "employeeIds array is required and cannot be empty"
                    }, 400);
                }

                if (body.employeeIds.length > 100) {
                    return c.json({
                        error: "Maximum 100 employees allowed per bulk operation"
                    }, 400);
                }

                const payload = {
                    employeeIds: body.employeeIds,
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.BulkRecalculate(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: "Validation failed", details: error.errors }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ========================================================================
    🔥 PREVIEW SALARY CALCULATION (NO DB WRITE)
    ======================================================================== */
    openapi(
        {
            method: "post",
            path: "/salary/structure/preview",
            tags: ["Salary"],
            summary: "Preview salary calculation for a template (dry run, no DB write)",
            request: {
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                templateId: z.string(),
                                grossAnnual: z.number(),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Preview salary structure calculation completed",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                structure: z.any(),
                            }),
                        },
                    },
                },
                400: { description: "Validation error" }
            },
        },

        async (c) => {
            try {
                const body = await c.req.json();

                const payload = {
                    templateId: body.templateId,
                    grossAnnual: body.grossAnnual
                };

                const response = await new Promise((resolve, reject) => {
                    salaryClient.PreviewTemplateCalculation(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);

            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: "Validation failed", details: error.errors }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

}