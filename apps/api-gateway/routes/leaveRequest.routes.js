import { z, ZodError } from "zod";
import { leaveRequestClient } from "../grpc/leaveRequest.client.js";

export default function registerLeaveRequestRoutes({ openapi }) {

    /* ----------------------------------------------------
     🧩 Shared Schemas
    ---------------------------------------------------- */

    const applyLeaveSchema = z.object({
        employee_id: z.string(),
        organization_id: z.string(),
        leave_type_id: z.string(),
        start_date: z.string(),
        end_date: z.string(),
        is_half_day: z.boolean().optional(),
        half_day_type: z.enum(["FIRST_HALF", "SECOND_HALF"]).optional(),
        reason: z.string().optional(),
        documents: z.string().optional()
    });

    const cancelLeaveSchema = z.object({
        request_id: z.string(),
        employee_id: z.string(),
        reason: z.string().optional()
    });

    const approveSchema = z.object({
        request_id: z.string(),
        approver_id: z.string()
    });

    const rejectSchema = z.object({
        request_id: z.string(),
        approver_id: z.string(),
        reason: z.string()
    });

    const listSchema = z.object({
        employee_id: z.string(),
        organization_id: z.string()
    });

    const balanceSchema = z.object({
        employee_id: z.string(),
        organization_id: z.string()
    });

    const calendarSchema = z.object({
        employee_id: z.string(),
        organization_id: z.string(),
        month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM")
    });

    /* ----------------------------------------------------
     🟢 Apply Leave
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/leave/apply",
            tags: ["Leave"],
            summary: "Apply for a leave",
            request: {
                body: {
                    content: {
                        "application/json": { schema: applyLeaveSchema }
                    }
                }
            },
            responses: {
                200: {
                    description: "Leave applied successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                success: z.string().optional(),
                                message: z.string().optional(),
                                leave_request: z.any().optional()
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const data = applyLeaveSchema.parse(await c.req.json());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.ApplyLeave(data, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🔴 Cancel Leave
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/leave/cancel",
            tags: ["Leave"],
            summary: "Cancel a leave request",
            request: {
                body: {
                    content: {
                        "application/json": { schema: cancelLeaveSchema }
                    }
                }
            },
            responses: {
                200: {
                    description: "Leave cancelled successfully",
                    content: {
                        "application/json": {
                            schema: z.any()
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const data = cancelLeaveSchema.parse(await c.req.json());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.CancelLeave(data, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🟣 Approve Leave
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/leave/approve",
            tags: ["Leave"],
            summary: "Approve a leave request",
            request: {
                body: {
                    content: {
                        "application/json": { schema: approveSchema }
                    }
                }
            },
            responses: {
                200: {
                    description: "Leave approved",
                    content: { "application/json": { schema: z.any() } }
                }
            }
        },
        async (c) => {
            try {
                const data = approveSchema.parse(await c.req.json());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.ApproveLeave(data, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🟠 Reject Leave
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/leave/reject",
            tags: ["Leave"],
            summary: "Reject a leave request",
            request: {
                body: {
                    content: {
                        "application/json": { schema: rejectSchema }
                    }
                }
            },
            responses: {
                200: {
                    description: "Leave rejected",
                    content: { "application/json": { schema: z.any() } }
                }
            }
        },
        async (c) => {
            try {
                const data = rejectSchema.parse(await c.req.json());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.RejectLeave(data, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ----------------------------------------------------
     🟡 Get Leave By ID
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/leave/{id}",
            tags: ["Leave"],
            summary: "Fetch a leave request by ID",
            request: {
                params: z.object({
                    id: z.string()
                })
            },
            responses: {
                200: {
                    description: "Leave retrieved",
                    content: { "application/json": { schema: z.any() } }
                },
                404: { description: "Leave not found" }
            }
        },
        async (c) => {
            try {
                const id = c.req.param("id");

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.GetLeaveRequest({ id }, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
     🟦 List Leaves
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/leave",
            tags: ["Leave"],
            summary: "List leave requests",
            request: {
                query: listSchema
            },
            responses: {
                200: {
                    description: "List of leave requests",
                    content: { "application/json": { schema: z.any() } }
                }
            }
        },
        async (c) => {
            try {
                const query = listSchema.parse(c.req.query());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.ListLeaveRequests(query, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
     🟪 Leave Balance
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/leave/balance",
            tags: ["Leave"],
            summary: "Fetch leave balance",
            request: {
                query: balanceSchema
            },
            responses: {
                200: {
                    description: "Leave balance",
                    content: { "application/json": { schema: z.any() } }
                }
            }
        },
        async (c) => {
            try {
                const query = balanceSchema.parse(c.req.query());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.GetLeaveBalance(query, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
     🗓 Leave Calendar
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/leave/calendar",
            tags: ["Leave"],
            summary: "Fetch leave calendar for a month",
            request: {
                query: calendarSchema
            },
            responses: {
                200: {
                    description: "Leave calendar",
                    content: { "application/json": { schema: z.any() } }
                }
            }
        },
        async (c) => {
            try {
                const query = calendarSchema.parse(c.req.query());

                const resp = await new Promise((resolve, reject) => {
                    leaveRequestClient.GetLeaveCalendar(query, (err, res) =>
                        err ? reject(err) : resolve(res)
                    );
                });

                return c.json(resp);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

}

/* ----------------------------------------------------
   Helper
---------------------------------------------------- */
function handleError(c, error) {
    if (error instanceof ZodError) {
        return c.json(
            {
                error: "Validation failed",
                details: error.errors.map((e) => ({
                    field: e.path.join("."),
                    message: e.message
                }))
            },
            400
        );
    }
    return c.json({ error: error.message }, 500);
}
