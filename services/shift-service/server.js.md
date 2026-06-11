# shift-service/server.js

## Purpose
gRPC microservice for CRUD operations on shift definitions (name, start/end time, break, applicable days, weekly off).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateShift` | Creates a shift with default M-F applicable days |
| `GetShift` | Fetches a single shift by ID |
| `ListShifts` | Lists all non-deleted shifts for an organization |
| `UpdateShift` | Updates shift fields |
| `DeleteShift` | Soft-deletes a shift |

## Important Logic

### Default Applicable Days
If no `applicable_days` are provided, the shift defaults to Monday–Friday:

```js
applicableDays: applicable_days && Object.keys(applicable_days).length
    ? applicable_days
    : { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
```

### Duplicate Name Prevention
Shift names must be unique within an organization:

```js
const existing = await prisma.shifts.findFirst({
    where: { organizationId: organization_id, name, deletedAt: null },
});
if (existing) {
    return callback({ code: grpc.status.ALREADY_EXISTS, message: 'Shift with this name already exists' });
}
```

### Time Validation
End time must be after start time:

```js
if (end <= start) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'End time must be after start time' });
}
```

## Helper Functions

- **`mapShift(shift)`** — Maps Prisma shift record to gRPC response shape.
