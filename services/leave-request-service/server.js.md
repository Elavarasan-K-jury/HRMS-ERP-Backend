# leave-request-service/server.js

## Purpose
gRPC microservice that handles employee leave requests — applying, cancelling, approving, rejecting, listing, checking balances, and generating a monthly leave calendar.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `ApplyLeave` | Creates a leave request + approval instance |
| `CancelLeave` | Soft-cancels a pending leave |
| `ApproveLeave` | Marks leave as APPROVED |
| `RejectLeave` | Marks leave as REJECTED with reason |
| `GetLeaveRequest` | Fetches a single leave by ID |
| `ListLeaveRequests` | Lists leaves by employee + organization |
| `GetLeaveBalance` | Computes accrued/used/available per leave type |
| `GetLeaveCalendar` | Returns a month grid marking LEAVE / HOLIDAY / NONE |

## Important Logic

### Leave Application with Approval Instance
When a leave is applied, the service creates both a `leaveRequests` row and an `approvalInstance` row, linking them together:

```js
const approvalInstance = await prisma.approvalInstance.create({
    data: {
        organizationId: organization_id,
        entityId: req.id,
        entityType: 'LEAVE',
        flowId: await getLeaveFlowId(organization_id),
        currentLevel: 1,
        status: 'PENDING',
    },
});

await prisma.leaveRequests.update({
    where: { id: req.id },
    data: { approvalInstanceId: approvalInstance.id },
});
```

### Leave Balance Calculation
Aggregates approved leave days grouped by leave type and compares against the monthly accrual rate defined on each `leaveTypes` record:

```js
const used = await prisma.leaveRequests.groupBy({
    by: ['leaveTypeId'],
    where: { employeeId: employee_id, status: 'APPROVED' },
    _sum: { totalDays: true },
});

const balances = types.map((t) => ({
    leave_type_id: t.id,
    leave_type_name: t.name,
    accrued: t.monthlyAccrualRate || 0,
    used: usedMap[t.id] || 0,
    available: (t.monthlyAccrualRate || 0) - (usedMap[t.id] || 0),
}));
```

### Leave Calendar (Monthly Grid)
Iterates over each day of a given month, cross-referencing both holidays and approved leave requests:

```js
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const isHoliday = holidays.some((h) => h.date.toISOString().startsWith(dateStr));
    const leave = leaves.find((l) => new Date(l.startDate) <= d && new Date(l.endDate) >= d);
    result.push({
        date: dateStr,
        status: leave ? 'LEAVE' : isHoliday ? 'HOLIDAY' : 'NONE',
        leave_type_name: leave?.leaveType?.name || '',
    });
}
```

## Helper Functions

- **`toApiLeaveRequest(r)`** — Maps a Prisma `leaveRequests` record to the gRPC response shape, converting `camelCase` DB fields to `snake_case` proto fields and serialising `Date` objects to ISO strings.
