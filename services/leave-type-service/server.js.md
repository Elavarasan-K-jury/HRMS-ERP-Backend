# leave-type-service/server.js

## Purpose
gRPC microservice for CRUD operations on leave type definitions (e.g., Sick Leave, Casual Leave, Annual Leave).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateLeaveType` | Creates a new leave type with all configuration fields |
| `UpdateLeaveType` | Updates an existing leave type |
| `GetLeaveType` | Fetches a single leave type by ID |
| `ListLeaveTypes` | Lists all leave types for an organization |
| `DeleteLeaveType` | Soft-deletes a leave type |

## Important Logic

### Full-config Creation
Each leave type stores accrual, carry-forward, encashment, gender restriction, probation, sandwich rule, and document requirements in a single record:

```js
const type = await prisma.leaveTypes.create({
    data: {
        organizationId: data.organization_id,
        name: data.name,
        paid: data.paid,
        maxPerYear: data.max_per_year,
        allowHalfDay: data.allow_half_day,
        requiresDocument: data.requires_document,
        carryForward: data.carry_forward,
        encashmentAllowed: data.encashment_allowed,
        genderRestriction: data.gender_restriction,
        probationAllowed: data.probation_allowed,
        sandwichRule: data.sandwich_rule,
        accrualEnabled: data.accrual_enabled,
        monthlyAccrualRate: data.monthly_accrual_rate,
        // ... more fields
    },
});
```

### Soft Delete
Leave types are never hard-deleted; they are marked with a `deletedAt` timestamp:

```js
await prisma.leaveTypes.update({
    where: { id },
    data: { deletedAt: new Date(), updatedAt: new Date() },
});
```

## Helper Functions

- **`toAPI(t)`** — Maps a Prisma `leaveTypes` record to the gRPC response shape, converting all configuration fields from `camelCase` to `snake_case`, with fallback defaults for optional fields.
