# salary-and-payroll-service/handlers/Payroll.handler.js

## Purpose
gRPC handlers for retrieving system payroll data and computing per-employee payroll calculations (attendance-based proration, leave deductions, expense reimbursements).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `GetSystemPayroll` | Fetches all employees with attendance, salary structures, leaves, and expenses for a given month |
| `CalculatePayroll` | Computes net pay per employee by prorating earnings against attendance and adding expense reimbursements |

## Important Logic

### Full Month Attendance Generation
Generates a day-by-day attendance report for an entire month, filling missing days as ABSENT:

```js
function getFullMonthAttendance(attendanceArray, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
        const currentDate = new Date(year, month - 1, d);
        const dayRecord = attendanceArray.find(item => {
            const itemDate = new Date(item.date);
            return itemDate.getFullYear() == year && itemDate.getMonth() == month - 1 && itemDate.getDate() == d;
        });
        report.push({
            day: currentDate.toISOString(),
            status: dayRecord?.status || 'ABSENT',
            startTime: dayRecord?.checkIn ? new Date(dayRecord.checkIn).toLocaleTimeString('en-IN', { hour12: true }) : 'N/A',
            totalEffectiveHours: formatDuration(dayRecord?.effectiveHours),
            // ...
        });
    }
    return report;
}
```

### Attendance Summary with Status Mapping
Maps various attendance status strings (PRESENT, ABSENT, HALF_DAY, LATE, HOLIDAY, WEEKOFF) to counts:

```js
const status = (att?.status || 'ABSENT').toString().toUpperCase().trim();
if (status === 'PRESENT' || status === 'P') presentDays++;
else if (status === 'ABSENT' || status === 'A') absentDays++;
else if (status === 'HALF_DAY' || status === 'HD') { presentDays += 0.5; absentDays += 0.5; }
else if (status === 'LATE' || status === 'L') lateCount++;
else if (status === 'HOLIDAY' || status === 'H') holidayCount++;
else if (status === 'WEEKOFF' || status === 'W') weekoffCount++;
```

### Payroll Calculation (Net Pay Computation)
For each employee, the calculator:
1. Gets the active salary structure's `inHandMonthly`
2. Computes attendance summary and leave summary
3. Deducts for absences: `dailyRate = grossMonthly / totalDaysInMonth`
4. Computes component-level earnings, deductions, and benefits
5. Adds approved expense reimbursements

```js
const effectivePresentDays = attendanceSummary.present_days + leaveSummary.total_leave_days;
const absentDays = Math.max(0, totalDaysInMonth - effectivePresentDays);

let deductionForAbsences = 0;
if (absentDays > 0 && grossMonthly > 0) {
    const dailyRate = grossMonthly / totalDaysInMonth;
    deductionForAbsences = Math.round(absentDays * dailyRate * 100) / 100;
}

const netPay = (grossMonthly - totalActualDeductions) + expenseSummary.total_approved;
```

### Expense Summary
Aggregates total claimed and approved expenses:

```js
function calculateExpenseSummary(expenses) {
    let totalClaimed = 0, totalApproved = 0;
    for (const exp of expenses || []) {
        totalClaimed += exp.amount || 0;
        if (exp.status === 'APPROVED') totalApproved += exp.amount || 0;
    }
    return { total_claimed: totalClaimed, total_approved: Math.round(totalApproved * 100) / 100, approved_expenses };
}
```

## Helper Functions

- **`getFullMonthAttendance(attendanceArray, year, month)`** — Builds a day-by-day attendance array for the month.
- **`calculateAttendanceSummary(attendanceRecords, startDate, endDate)`** — Counts present/absent/late/holiday/weekoff days.
- **`calculateLeaveSummary(leaveRequests, year, month)`** — Aggregates approved leave days by type within the month.
- **`calculateExpenseSummary(expenses)`** — Sums claimed and approved expense amounts.
