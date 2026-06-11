# Attendance Service

## Purpose
Core attendance management system handling check-in/check-out, attendance computation (with shift and policy enforcement), geofence and network policy enforcement, attendance policy CRUD, network policy CRUD, geofence CRUD, and attendance report generation.

## Key gRPC Methods

### Check-in/Check-out
- **CheckIn** - Validates employee, enforces network/IP and geo-fence policies, finds or creates today's attendance record, logs CHECK_IN, and recomputes attendance status.
- **CheckOut** - Similar to CheckIn but logs CHECK_OUT and updates checkout time.

```js
// Geofence enforcement with Haversine distance
for (const fence of fences) {
    const d = distanceInMeters(lat, lon, fence.latitude, fence.longitude);
    if (d <= fence.radiusMeters) { inside = true; break; }
}
```

### Attendance Management
- **CreateAttendance** - Manual attendance creation with full field support (mode, is_holiday, notes).
- **RecomputeAttendance** - Recalculates attendance metrics (gross hours, effective hours, late minutes, status) for an existing record.
- **ListAttendance** - Lists attendance records for an employee in a given month (YYYY-MM).
- **ListOrganizationAttendanceByMonth** - Day-wise attendance for an entire organization with monthly statistics (average check-in/out, attendance rate, most late employee, best attendance employee).

```js
// Attendance status computation logic
if (effectiveMinutes >= (policy.fullDayMinutes ?? 480)) {
    status = "PRESENT";
} else if (effectiveMinutes >= (policy.halfDayMinutes ?? 240)) {
    status = "HALF_DAY";
} else if (lateMinutes > 0) {
    status = "LATE";
} else {
    status = "ABSENT";
}
```

### Reports
- **AttendanceReport** - Creates an `attendanceReports` entry and enqueues a background job for PDF generation via a worker queue.
- **ListAttendanceReports** - Paginated listing of generated reports.
- **GetAttendanceReportResult** - Fetches a specific report by ID with full status and PDF URL.

### Policy CRUD
- **CreateAttendancePolicy** / **UpdateAttendancePolicy** / **ListAttendancePolicy** - Manage attendance policies (grace period, half-day/full-day thresholds, geo settings, overtime, rounding).
- **CreateNetworkPolicy** / **UpdateNetworkPolicy** / **ListNetworkPolicy** - Manage network policies (IP allowlisting) scoped to ATTENDANCE or BOTH.
- **CreateGeoFence** / **UpdateGeoFence** / **ListGeoFence** - Manage geofence locations with lat/lng/radius.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `parseDate(value)` | Safely parses ISO date |
| `startOfDay(date)` / `endOfDay(date)` | Truncates date to start/end of day |
| `distanceInMeters(lat1, lon1, lat2, lon2)` | Haversine distance calculation |
| `getActiveAttendancePolicy(organizationId)` | Fetches active policy, returns defaults if none |
| `getActiveNetworkPolicyForAttendance(organizationId)` | Fetches active network policy for attendance |
| `getActiveGeoFences(organizationId)` | Fetches active geofences |
| `enforceNetworkPolicy({organizationId, ipAddress})` | Throws PERMISSION_DENIED if IP not allowed |
| `enforceGeoFence({organizationId, lat, lon})` | Throws if outside geofence |
| `getShiftForDate(employeeId, dateOnly)` | Looks up employee's shift assignment for a date |
| `computeAttendanceStatus({attendance, shift, policy})` | Computes gross/effective hours, late minutes, status |
| `mapAttendanceToProto(att)` | Maps attendance to gRPC response with formatted dates and nested employee/organization |

**Server port:** `process.env.ATTENDANCE_SERVICE_PORT || 5062`
