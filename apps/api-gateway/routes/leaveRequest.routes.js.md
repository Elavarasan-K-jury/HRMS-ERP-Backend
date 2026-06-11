# Leave Request Routes

**Service:** Leave Request gRPC (`leaveRequestClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/leave/apply` | Apply for a leave |
| POST | `/leave/cancel` | Cancel a leave request |
| POST | `/leave/approve` | Approve a leave request |
| POST | `/leave/reject` | Reject a leave request |
| GET | `/leave/{id}` | Fetch a leave request by ID |
| GET | `/leave` | List leave requests |
| GET | `/leave/balance` | Fetch leave balance |
| GET | `/leave/calendar` | Fetch leave calendar for a month |

## Code Snippet

```js
async (c) => {
    try {
        const data = applyLeaveSchema.parse(await c.req.json());
        const resp = await new Promise((resolve, reject) => {
            leaveRequestClient.ApplyLeave(data, (err, res) =>
                err ? reject(err) : resolve(res)
            );
        });
        return c.json(resp);
    } catch (error) {
        return handleError(c, error);
    }
}
```

## Request/Response Schemas

- **ApplyLeave**: `{ employee_id, organization_id, leave_type_id, start_date, end_date, is_half_day?, half_day_type?, reason?, documents? }`
- **CancelLeave**: `{ request_id, employee_id, reason? }`
- **ApproveSchema**: `{ request_id, approver_id }`
- **RejectSchema**: `{ request_id, approver_id, reason }`
- **CalendarSchema**: `{ employee_id, organization_id, month (YYYY-MM) }`

## Unique Logic

- Uses a shared `handleError` helper function that handles `ZodError` (400) and generic errors (500).
- `half_day_type` is `enum('FIRST_HALF', 'SECOND_HALF')`.
- Calendar month validated via regex `/^\d{4}-\d{2}$/`.
