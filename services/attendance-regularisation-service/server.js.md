# Attendance Regularisation Service

## Purpose
Allows employees to request corrections to their attendance records (check-in/check-out times) and managers to approve or reject those requests.

## Key gRPC Methods
- **CreateRegularisation** - Creates a regularisation request with corrected check-in/check-out times stored as JSON in `correctedData`.
- **ListRegularisations** - Lists regularisations filtered by employee, organization, or status.
- **ApproveRegularisation** - Updates the original attendance record with corrected times, marks the regularisation as APPROVED, and creates an approval log entry.
```js
// Update original attendance with corrected times
await prisma.attendance.update({
    where: { id: reg.attendanceId },
    data: {
        checkIn: reg.correctedData?.newCheckIn ? new Date(reg.correctedData.newCheckIn) : undefined,
        checkOut: reg.correctedData?.newCheckOut ? new Date(reg.correctedData.newCheckOut) : undefined,
    },
});
```
- **RejectRegularisation** - Marks the regularisation as REJECTED with approver remarks and creates an approval log entry.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `parseDate(d)` | Safely parses a date string, returning `null` for invalid values |
| `mapReg(r)` | Maps regularisation to API format, extracting corrected check-in/out from `correctedData` JSON |

**Server port:** `process.env.REGULARISATION_SERVICE_PORT || 5073`
