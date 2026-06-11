# report-service/handlers/employeeReportData.js

## Purpose
Data-fetching and HTML-generation engine that produces a modern, visual employee profile report with attendance, salary, engagement, leave, and performance metrics.

## Important Logic

### Comprehensive Employee Data Fetch
Fetches an employee with 38+ related models in a single Prisma query to power all report sections:

```js
const employee = await prisma.organizationEmployees.findUnique({
    where: { id: employeeId, deletedAt: null },
    include: {
        organization: true, designation: true, departmentAssignments: { include: { department: true, reporting: true } },
        attendance: { orderBy: { date: "asc" } }, pollPosts: true, pollLikes: true, pollComments: true,
        pollVotes: true, salaryStructures: { where: { isCurrentActive: true } }, category: true,
        assetAssignment: true, pollSaves: true, pollShares: true, leaveRequests: true, payslips: true,
        // ... 25+ more relations
    },
});
```

### Metrics Calculation

**Attendance Rate:**
```js
const attendanceRate = attendanceTotal ? ((presentDays / attendanceTotal) * 100).toFixed(1) : "0.0";
```

**Engagement Score:**
```js
const engagementScore =
    employee.pollPosts.length * 10 + employee.pollLikes.length * 2 +
    employee.pollComments.length * 3 + employee.pollVotes.length * 2 +
    employee.pollSaves.length * 2 + employee.pollShares.length * 5;
const engagementLevel = engagementScore > 80 ? "High" : engagementScore > 40 ? "Medium" : "Low";
```

**Performance Score (composite):**
```js
const performanceScore = Math.min(100, Math.round(
    (parseFloat(attendanceRate) * 0.4) + (Math.min(engagementScore, 100) * 0.3) +
    (avgWorkHours >= 8 ? 30 : (avgWorkHours / 8) * 30)
));
```

### HTML Output
The function returns a complete self-contained HTML document using Tailwind CSS with:
- Glass-morphism hero header
- SVG donut chart for attendance breakdown
- 30-day attendance sparkline with tooltips
- Stacked salary distribution bar
- Leave requests table
- Engagement activity breakdown

### 30-Day Attendance Generation
Fills the last 30 days with actual attendance records (defaulting to ABSENT when missing):

```js
function generateLast30DaysAttendance(attendanceRecords) {
    const last30Days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const actualRecord = attendanceRecords.find(a => {
            const recordDate = new Date(a.date);
            recordDate.setHours(0, 0, 0, 0);
            return recordDate.getTime() === date.getTime();
        });
        last30Days.push({
            date: date.toISOString(),
            status: actualRecord?.status || "ABSENT",
            effectiveHours: actualRecord?.effectiveHours || 0,
        });
    }
    return last30Days;
}
```

## Helper Functions

| Function | Purpose |
|---|---|
| `metricCard(label, value, pct, color, emoji)` | Renders a glass-morphism stat card with progress bar |
| `donutChart(segments)` | SVG donut chart with stroke-dasharray |
| `legendItem(label, count, pct, color)` | Legend row for donut chart |
| `salaryMetric(label, value)` | Compact salary figure card |
| `detailRow(label, value)` | Key-value row for employee details |
| `engagementStat(label, count, emoji)` | Engagement activity row |
| `quickStat(label, count)` | Small stat tile |
| `statusBadge(status)` | Colored badge for leave status |
| `fmt(d)` | Formats a date to `YYYY-MM-DD` or `—` |
