# shift-policy-service/server.js

## Purpose
gRPC microservice for managing shift policies — rules governing auto-assignment, grace periods, night shift windows, and rotational scheduling.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateShiftPolicy` | Creates a policy with validation and single-auto-assign enforcement |
| `GetShiftPolicy` | Fetches a single policy by ID |
| `ListShiftPolicies` | Lists all policies for an org, optional active-only filter |
| `UpdateShiftPolicy` | Updates policy fields with merged validation |
| `DeleteShiftPolicy` | Soft-deletes + deactivates + disables auto-assign |

## Important Logic

### Single Auto-Assign Policy Constraint
Only one active policy with `autoAssign = true` is allowed per organization:

```js
async function ensureSingleAutoAssignPolicy({ organizationId, excludeId }) {
    const existing = await prisma.shiftPolicies.findFirst({
        where: { organizationId, autoAssign: true, isActive: true, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (existing) {
        throw {
            code: grpc.status.ALREADY_EXISTS,
            message: 'Another active auto-assign policy already exists for this organization.',
        };
    }
}
```

### Time Format Validation
Night shift start/end times must be in `HH:mm` 24-hour format:

```js
const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

if (nightShiftStart && !HH_MM_REGEX.test(nightShiftStart)) {
    throw { code: grpc.status.INVALID_ARGUMENT, message: 'night_shift_start must be in HH:mm 24-hour format' };
}
```

### Rotation Validation
If rotational, a positive `rotationPeriod` is required:

```js
if (rotational && (!rotationPeriod || rotationPeriod <= 0)) {
    throw { code: grpc.status.INVALID_ARGUMENT, message: 'rotation_period must be a positive integer when rotational=true' };
}
```

### Soft-Delete Deactivation
Deleting a policy sets `deletedAt`, `isActive = false`, and `autoAssign = false`:

```js
await prisma.shiftPolicies.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, autoAssign: false, updatedAt: new Date() },
});
```

## Helper Functions

- **`mapShiftPolicy(policy)`** — Maps Prisma policy to gRPC response shape.
- **`ensureSingleAutoAssignPolicy(...)`** — Throws if another active auto-assign policy exists.
- **`validateShiftPolicyInput(...)`** — Validates night shift time format and rotation rules.
