# Approval Service

## Purpose
Manages configurable multi-level approval flows and approval instances for leave requests, attendance regularisation, and workday requests.

## Key gRPC Methods

### Approval Flow Service
- **CreateFlow** - Creates an approval flow with nested levels and approvers for a given organization and entity type (LEAVE, REGULARISATION, WORKDAY).
- **GetFlow** - Fetches a single flow by ID with levels and approvers.
- **ListFlows** - Lists all flows for an organization, optionally filtered by entity type.
- **UpdateFlow** - Replaces all levels/approvers atomically (deletes old, creates new).
- **DeleteFlow** - Soft-deletes a flow.

### Approval Instance Service
- **StartApproval** - Starts an approval instance by finding the active flow for the entity type, creating an instance at level 1 with PENDING status, and logging INITIATED.
- **GetApproval** - Fetches a full approval instance with organization, employee, entity data, and approval logs.
- **Approve** - Records an APPROVED log, advances to the next level (or marks COMPLETED if at max level).
- **Reject** - Records a REJECTED log and sets status to REJECTED.
- **ListPending** - Paginated listing of PENDING/IN_PROGRESS approvals with optional approver_id filtering.

```js
// Advancing approval through levels
if (currentLevel >= maxLevel) {
    newStatus = 'COMPLETED';
} else {
    const nextLevel = levels.find((l) => l.level > currentLevel);
    if (nextLevel) {
        newLevel = nextLevel.level;
        newStatus = 'IN_PROGRESS';
        await prisma.approvalLogs.create({
            data: { action: 'MOVED_TO_NEXT_LEVEL', ... }
        });
    }
}
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `isObjectId(id)` | Validates 24-character hex string |
| `loadEntityWithIncludes(entityType, entityId)` | Loads the underlying entity (leave, regularisation, workday) with relevant includes |
| `loadEmployeeWithRelations(employeeId)` | Loads employee with designation and department assignments |
| `buildApproverMap(logs)` | Builds a Map of approverId → employee for log approvers |
| `buildEmployeeMapFromLevels(levels)` | Builds a Map of userId → employee for flow approvers |
| `mapOrganization(org)` | Maps org DB object to API format |
| `mapEmployee(emp)` | Maps employee with designation/department relations |
| `mapFlow(flow, employeeMap)` | Maps flow with nested levels/approvers |
| `mapInstance(instance, org, employee, entityData, logsMapped)` | Maps a full approval instance including entity-specific data |
| `mapLog(log, approverMap)` | Maps approval log with approver employee data |
| `mapLeaveEntity(leave)` | Maps leave request entity |
| `mapRegularisationEntity(reg)` | Maps attendance regularisation entity |
| `mapWorkdayEntity(w)` | Maps workday request entity |
