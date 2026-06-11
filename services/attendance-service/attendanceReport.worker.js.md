# Attendance Report Worker

## Purpose
Background worker that processes attendance report jobs: fetches attendance data, generates a PDF, uploads it to file storage, and updates the report record with the result.

## Key Functions

### `processAttendanceReport(reportId)`
The main worker function that runs inside the queue:
1. Updates report status to `PROCESSING`
2. Calls `getOrganizationAttendanceReport()` to build attendance data grouped by day + employee
3. Generates a PDF via `generateAttendancePDF()`
4. Uploads the PDF buffer using `@jury-hrms/files` `FileService.upload()`
5. Saves the report as `COMPLETED` with `responseData` and `pdfUrl`
6. On failure, saves the report as `FAILED` with error message

### `getOrganizationAttendanceReport({ organizationId, departmentId, designationId, employeeId, startDate, endDate })`
Fetches employees matching the filter criteria, retrieves their attendance records for the date range, groups by day, and returns stats (present/absent/late counts, average hours).

```js
const dayMap = {};
for (const rec of attendanceRows) {
    const dateKey = rec.date.toISOString().slice(0, 10);
    if (!dayMap[dateKey]) dayMap[dateKey] = [];
    dayMap[dateKey].push({
        attendance_id: rec.id,
        employee: { id: emp.id, name: emp.fullName, code: emp.employeeCode, ... },
        date: dateKey,
        status: rec.status,
        check_in: rec.checkIn,
        check_out: rec.checkOut,
        ...
    });
}
```

### `enqueueAttendanceReport(reportId)`
Adds a report processing task to the `p-queue` for sequential execution.
