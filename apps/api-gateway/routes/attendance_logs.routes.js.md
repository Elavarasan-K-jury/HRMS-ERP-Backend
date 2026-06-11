# attendance_logs.routes.js

**Service:** Proxies to `attendanceLogClient` (gRPC attendance log service)

**Export:** `registerAttendanceLogRoutes({ openapi })` — registers routes on an OpenAPIHono app

## Routes

#### `GET /attendance/logs`
- **Summary:** List raw attendance logs (check-in/check-out)
- **Tags:** `Attendance Logs`
- **Query:** `{ organization_id?, employee_id?, attendance_id?, date? (YYYY-MM-DD) }`
- **Response 200:** `{ logs: [{ id, attendance_id, organization_id, employee_id, date, type, ip_address, source, geo_location, created_at }] }`
- **Response 400/500**

## Unique Logic

- Only 1 route in this file — a simple list endpoint
- Query parameters are all optional (empty string defaults)
- Date regex: `/^\d{4}-\d{2}-\d{2}$/`

## Code Snippet

```js
openapi(
    {
        method: "get",
        path: "/attendance/logs",
        tags: ["Attendance Logs"],
        summary: "List raw attendance logs (check-in/check-out)",
        request: { query: listLogsQuerySchema },
        responses: {
            200: {
                description: "List of attendance logs",
                content: {
                    "application/json": {
                        schema: z.object({ logs: z.array(attendanceLogSchema) }),
                    },
                },
            },
        },
    },
    async (c) => {
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
    }
);
```
