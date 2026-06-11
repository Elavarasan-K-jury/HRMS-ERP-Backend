# shift-assignment-service/server.js

## Purpose
gRPC microservice that assigns employees to shifts with date-range validity, overlap detection, and rotational policy integration.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `AssignShift` | Creates a shift assignment with automatic valid_to from rotational policy |
| `GetShiftAssignment` | Fetches a single assignment by ID |
| `ListShiftAssignments` | Lists assignments with optional employee/shift filter and active-only flag |
| `UpdateShiftAssignment` | Updates valid_from/valid_to with overlap re-check |
| `DeleteShiftAssignment` | Soft-deletes an assignment |

## Important Logic

### Rotational Policy Auto-Duration
If no `valid_to` is provided, the service checks for an active auto-assign shift policy. If it's rotational with a `rotationPeriod`, the end date is auto-calculated:

```js
if (!to) {
    const policy = await prisma.shiftPolicies.findFirst({
        where: { organizationId: employee.organizationId, isActive: true, autoAssign: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
    });

    if (policy && policy.rotational && policy.rotationPeriod && policy.rotationPeriod > 0) {
        to = addDays(from, policy.rotationPeriod);
    } else {
        to = null; // open-ended
    }
}
```

### Overlap Detection
Ensures no employee has overlapping shift assignments:

```js
async function hasOverlap({ employeeId, from, to, excludeId = null }) {
    const rangeEnd = to ?? new Date("9999-12-31T23:59:59.999Z");
    const overlapping = await prisma.employeeShiftAssignment.findFirst({
        where: {
            employeeId, deletedAt: null,
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
            AND: [
                { validFrom: { lte: rangeEnd } },
                { OR: [{ validTo: null }, { validTo: { gte: from } }] },
            ],
        },
    });
    return !!overlapping;
}
```

### Organization Cross-Validation
Ensures the employee and shift belong to the same organization:

```js
if (String(employee.organizationId) !== String(shift.organizationId)) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Employee and Shift belong to different organizations" });
}
```

## Helper Functions

| Function | Purpose |
|---|---|
| `parseDate(value)` | Safely parses an ISO date string; returns null if invalid |
| `addDays(date, days)` | Adds N days to a date |
| `mapEmployee(employee)` | Maps Prisma employee + designation to gRPC EmployeeSummary |
| `mapShift(shift)` | Maps Prisma shift to gRPC ShiftSummary |
| `mapAssignmentWithDetails(a)` | Maps full assignment (core + employee + shift) to gRPC response |
| `hasOverlap(...)` | Checks for overlapping assignments for an employee |
