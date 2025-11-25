// api/routes/attendanceLogs.routes.js
import { z, ZodError } from "zod";
import { attendanceLogClient } from "../grpc/attendance_log.client.js";

export default function registerAttendanceLogRoutes({ openapi }) {
  const listLogsQuerySchema = z.object({
    organization_id: z.string().optional(),
    employee_id: z.string().optional(),
    attendance_id: z.string().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-mm-dd")
      .optional(),
  });

  const attendanceLogSchema = z.object({
    id: z.string(),
    attendance_id: z.string(),
    organization_id: z.string(),
    employee_id: z.string(),
    date: z.string(),
    type: z.string(),
    ip_address: z.string(),
    source: z.string(),
    geo_location: z.string(),
    created_at: z.string(),
  });

  // ------------------------------------
  // GET /attendance/logs
  // ------------------------------------
  openapi(
    {
      method: "get",
      path: "/attendance/logs",
      tags: ["Attendance Logs"],
      summary: "List raw attendance logs (check-in/check-out)",
      request: {
        query: listLogsQuerySchema,
      },
      responses: {
        200: {
          description: "List of attendance logs",
          content: {
            "application/json": {
              schema: z.object({
                logs: z.array(attendanceLogSchema),
              }),
            },
          },
        },
      },
    },
    async (c) => {
      try {
        const query = c.req.valid("query");

        const payload = {
          organization_id: query.organization_id || "",
          employee_id: query.employee_id || "",
          attendance_id: query.attendance_id || "",
          date: query.date || "",
        };

        const response = await new Promise((resolve, reject) => {
          attendanceLogClient.ListAttendanceLogs(payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
          });
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
        return c.json({ error: error.message || "Internal server error" }, 500);
      }
    }
  );
}
