# salary-and-payroll-service/handlers/expense.handler.js

## Purpose
gRPC handlers for employee expense management — registration, approval workflow, filtering, and admin oversight.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `registerExpense` | Employee submits a new expense (PENDING status) |
| `getMyExpenses` | Employee lists own expenses with date/type/status filters |
| `updateExpense` | Updates a still-PENDING expense |
| `deleteExpense` | Soft-deletes a still-PENDING expense |
| `getAllExpenses` | Admin lists all expenses org-wide with filters |
| `updateExpenseStatus` | Admin approves/rejects an expense |
| `getExpenseDetails` | Admin views full expense details |
| `adminDeleteExpense` | Admin soft-deletes any expense |

## Important Logic

### Expense Registration with Email Notification
After creating an expense, the system finds the org admin and sends a notification email:

```js
const expense = await prisma.expenses.create({
    data: { organizationId: organization_id, employeeId: employee_id, type: type || 'OTHER', amount, description, status: 'PENDING' },
});

const organisationAdmin = await prisma.organizationEmployees.findFirst({
    where: { organizationId: organization_id, isAdmin: true },
});
sendExpenseRaisedEmail(organisationAdmin.email, expense);
```

### Status Transition Guards
Only PENDING expenses can be updated, deleted, or approved/rejected:

```js
if (expense.status !== 'PENDING') {
    return callback({
        code: grpc.status.FAILED_PRECONDITION,
        message: 'Only pending expenses can be updated',
    });
}
```

### Admin Approve/Reject with SUPER_ADMIN Fallback
If the approver is `'SUPER_ADMIN'`, the system resolves to the org's admin employee:

```js
if (approver_id == 'SUPER_ADMIN') {
    const organisationAdmin = await prisma.organizationEmployees.findFirst({
        where: { organizationId: organization_id, isAdmin: true },
    });
    approvedBy = organisationAdmin?.id;
} else {
    await validateEmployee(approver_id, organization_id);
    approvedBy = approver_id;
}
```

### Date-Range Filter Builder
Flexible date-range filtering for expense lists:

```js
function buildDateFilter(from_date, to_date) {
    if (!from_date && !to_date) return undefined;
    const filter = {};
    if (from_date) filter.gte = new Date(from_date);
    if (to_date) filter.lte = new Date(to_date);
    return filter;
}
```

## Helper Functions

| Function | Purpose |
|---|---|
| `validateOrganization(organization_id)` | Verifies the org exists; throws structured error |
| `validateEmployee(employee_id, organization_id)` | Verifies the employee exists in the org |
| `validateExpense(expense_id, organization_id)` | Verifies the expense exists in the org |
| `buildDateFilter(from_date, to_date)` | Returns a Prisma date filter object |
| `formatExpense(expense)` | Maps Prisma expense record to gRPC response shape |
