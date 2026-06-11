# attendance.routes.js

**Service:** Proxies to `attendanceClient` (gRPC attendance service)

**Export:** `registerAttendanceRoutes({ openapi })` — registers routes on an OpenAPIHono app

## Routes

### Check-In / Check-Out

#### `POST /attendance/check-in`
- **Summary:** Employee check-in
- **Tags:** `Attendance`
- **Request Body:** `{ employee_id, ip_address?, latitude?, longitude?, source? }`
- **Response 200:** `attendanceObjectSchema` / 400

#### `POST /attendance/check-out`
- **Summary:** Employee check-out
- **Tags:** `Attendance`
- **Request Body:** `{ employee_id, ip_address?, latitude?, longitude?, source? }`
- **Response 200:** `attendanceObjectSchema` / 400

### Attendance CRUD

#### `POST /attendance`
- **Summary:** Create manual attendance entry
- **Tags:** `Attendance`
- **Request Body:** `{ organization_id, employee_id, date (YYYY-MM-DD), check_in?, check_out?, location?, gross_hours?, effective_hours?, late_arrival_minutes?, status?, is_holiday?, notes?, mode? }`
- **Response 201:** Attendance object / 400 / 409

#### `POST /attendance/recompute`
- **Summary:** Recompute attendance for a given date
- **Tags:** `Attendance`
- **Request Body:** `{ employee_id, date? (YYYY-MM-DD) }`
- **Response 200:** Attendance object / 404

#### `GET /attendance`
- **Summary:** List attendance for an employee in a month
- **Tags:** `Attendance`
- **Query:** `{ employee_id, month (YYYY-MM) }`
- **Response 200:** `{ attendance: [...] }`

#### `GET /attendance/organization-monthly`
- **Summary:** Day-wise attendance of ALL employees in an organization for a month
- **Tags:** `Attendance`
- **Query:** `{ organization_id, month (YYYY-MM) }`
- **Response 200:** `{ days: [{ date, raw_date, attendance: [...] }], success, message }`

### Attendance Reports (Async)

#### `GET /attendance/report`
- **Summary:** Initiate attendance report generation (async)
- **Tags:** `Attendance`
- **Query:** `{ organization_id, department_id?, designation_id?, employee_id?, start_date?, end_date? }`
- **Response 200:** `{ report_id, status, success, message }`

#### `GET /attendance/report/result`
- **Summary:** Fetch the processed attendance report
- **Tags:** `Attendance`
- **Query:** `{ report_id (24-char string) }`
- **Response 200:** Report result with `data` parsed from JSON and sorted by date descending

#### `GET /attendance/report/list`
- **Summary:** List all attendance report requests with pagination
- **Tags:** `Attendance`
- **Query:** `{ organization_id, page?, limit? }`
- **Response 200:** `{ reports: [...], page, limit, total, success }`

### Attendance Policies

#### `POST /attendance-policies`
- **Summary:** Create attendance policy
- **Tags:** `Attendance Policies`
- **Request Body:** `{ organization_id, name, grace_minutes?, half_day_minutes?, ... }`
- **Response 201:** Policy object

#### `PUT /attendance-policies/{id}`
- **Summary:** Update attendance policy
- **Tags:** `Attendance Policies`
- **Params:** `id`
- **Request Body:** Partial create schema
- **Response 200:** Updated / 404

#### `GET /attendance-policies`
- **Summary:** List attendance policies for org
- **Tags:** `Attendance Policies`
- **Query:** `{ organization_id }`
- **Response 200:** `{ policies: [...] }`

### Network Policies

#### `POST /network-policies`
- **Summary:** Create network policy (IP restriction)
- **Tags:** `Network Policies`
- **Request Body:** `{ organization_id, name, enforce_on?, allowed_ips? }`
- **Response 201:** Policy object

#### `PUT /network-policies/{id}`
- **Summary:** Update network policy
- **Tags:** `Network Policies`
- **Params:** `id`
- **Request Body:** Partial create schema
- **Response 200:** Updated / 404

#### `GET /network-policies`
- **Summary:** List network policies for org
- **Tags:** `Network Policies`
- **Query:** `{ organization_id }`
- **Response 200:** `{ policies: [...] }`

### Geo Fences

#### `POST /geo-fences`
- **Summary:** Create geofence for attendance
- **Tags:** `Geo Fences`
- **Request Body:** `{ organization_id, name, latitude, longitude, radius_meters }`
- **Response 201:** Geofence object

#### `PUT /geo-fences/{id}`
- **Summary:** Update geofence
- **Tags:** `Geo Fences`
- **Params:** `id`
- **Request Body:** Partial create schema
- **Response 200:** Updated / 404

#### `GET /geo-fences`
- **Summary:** List geofences for organization
- **Tags:** `Geo Fences`
- **Query:** `{ organization_id }`
- **Response 200:** `{ geofences: [...] }`

## Unique Logic

- Report result parses `response.report.responseData` from JSON string and sorts by date descending
- Uses `grpc.status.ALREADY_EXISTS` for 409 conflict on create attendance
- Policy/geofence updates use nested payload `{ policy_id: id, data: body }` and `{ geofence_id: id, data: body }`
- Comprehensive Zod schemas with strict mode (`.strict()`) on most create schemas

## Code Snippet

```js
openapi(
    {
        method: 'post',
        path: '/attendance/check-in',
        tags: ['Attendance'],
        summary: 'Employee check-in',
        request: {
            body: {
                content: {
                    'application/json': { schema: checkInSchema },
                },
            },
        },
        responses: {
            200: {
                description: 'Check-in successful',
                content: { 'application/json': { schema: attendanceObjectSchema } },
            },
            400: { description: 'Validation / policy error' },
        },
    },
    async (c) => {
        try {
            const body = checkInSchema.parse(await c.req.json());
            const resp = await new Promise((resolve, reject) => {
                attendanceClient.CheckIn(body, (err, res) => {
                    if (err) return reject(err);
                    resolve(res);
                });
            });
            return c.json(resp, 200);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
            }
            return c.json({ error: error.message || 'Internal server error' }, 500);
        }
    }
);
```
