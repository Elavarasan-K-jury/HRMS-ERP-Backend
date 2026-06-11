# Attendance Logs Service

## Purpose
Provides filtered querying of attendance check-in/check-out logs with support for organization, employee, attendance, and date filters.

## Key gRPC Methods
- **ListAttendanceLogs** - Fetches all attendance logs with optional filters (organization_id, employee_id, attendance_id, date). Logs are filtered in-memory after fetching with the attendance relation.

```js
// Client-side filtering after database fetch
const filtered = logs.filter((log) => {
    const att = log.attendance;
    if (!att) return false;
    if (organization_id && String(att.organizationId) !== String(organization_id)) return false;
    if (employee_id && String(att.employeeId) !== String(employee_id)) return false;
    if (date) {
        const attDate = toDateString(att.date);
        if (attDate !== date) return false;
    }
    return true;
});
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `toDateString(d)` | Converts a date to `YYYY-MM-DD` UTC string |
| `mapAttendanceLog(log)` | Maps log to API format with employee/org/date resolved from the `attendance` relation, serializing `geoLocation` as JSON |

**Server port:** `process.env.ATTENDANCE_LOG_SERVICE_PORT || 5070`
