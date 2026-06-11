# Holiday Policy Service

## Purpose
Manages holiday policies that define regional holiday rules and applicability for organizations.

## Key gRPC Methods
- **CreateHolidayPolicy** - Creates a holiday policy with name, region, and list of applicable employee types.
- **UpdateHolidayPolicy** - Updates policy fields with partial update support (only changed fields sent).
- **DeleteHolidayPolicy** - Soft-deletes by setting `deletedAt` and `isActive: false`.
- **GetHolidayPolicy** - Fetches a single policy by ID.
- **ListHolidayPolicies** - Lists policies with optional filters (organization, region, active-only) and returns `total_count`.

```js
const where = {
    organizationId: organization_id,
    deletedAt: null,
    ...(region ? { region } : {}),
    ...(is_active_only ? { isActive: true } : {}),
};
const [rows, count] = await Promise.all([
    prisma.holidayPolicies.findMany({ where, ... }),
    prisma.holidayPolicies.count({ where }),
]);
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `toApiPolicy(p)` | Maps policy to API format with `applicable_to` array and ISO timestamps |

**Server port:** `process.env.HOLIDAY_POLICY_SERVICE_PORT || 5080`
