import { prisma } from "@jury-hrms/db/client.js";

/**
 * ==========================================================
 * NEXT-GEN Employee Report with Advanced Visualizations
 * ==========================================================
 */
export async function generateEmployeeReportHTML(employeeId) {
    const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employeeId, deletedAt: null },
        include: {
            organization: true,
            designation: true,
            departmentAssignments: {
                include: { department: true, reporting: true }
            },
            attendance: { orderBy: { date: "asc" } },
            pollPosts: true,
            pollLikes: true,
            pollComments: true,
            pollVotes: true,
            salaryStructures: { where: { isCurrentActive: true } },
            category: true,
            assetAssignment: true,
            pollSaves: true,
            pollShares: true,
            onboardingProgress: true,
            assetRequests: true,
            approvedRequests: true,
            acknowledgedConditions: true,
            EmployeeShiftAssignment: true,
            regularisations: true,
            leaveRequests: true,
            workrequests: true,
            organizationDepartments: true,
            assetConditions: true,
            attendanceReports: true,
            salaryRevisions: true,
            payslips: true
        }
    });

    if (!employee) throw new Error("Employee not found");

    /* ==========================================================
       ADVANCED METRICS & ANALYTICS
    ========================================================== */

    const attendanceTotal = employee.attendance.length;
    const presentDays = employee.attendance.filter(a => a.status === "PRESENT").length;
    const absentDays = employee.attendance.filter(a => a.status === "ABSENT").length;
    const halfDays = employee.attendance.filter(a => a.status === "HALF_DAY").length;

    const attendanceRate = attendanceTotal ? ((presentDays / attendanceTotal) * 100).toFixed(1) : "0.0";
    const presentPct = attendanceTotal ? Math.round((presentDays / attendanceTotal) * 100) : 0;
    const absentPct = attendanceTotal ? Math.round((absentDays / attendanceTotal) * 100) : 0;
    const halfPct = attendanceTotal ? Math.round((halfDays / attendanceTotal) * 100) : 0;

    // Engagement metrics
    const engagementScore =
        employee.pollPosts.length * 10 +
        employee.pollLikes.length * 2 +
        employee.pollComments.length * 3 +
        employee.pollVotes.length * 2 +
        employee.pollSaves.length * 2 +
        employee.pollShares.length * 5;

    const engagementLevel = engagementScore > 80 ? "High" : engagementScore > 40 ? "Medium" : "Low";
    const engagementColor = engagementScore > 80 ? "#10b981" : engagementScore > 40 ? "#f59e0b" : "#ef4444";

    // Salary breakdown
    const salary = employee.salaryStructures[0];
    const earningPct = salary?.grossAnnual
        ? parseFloat((salary.totalEarnings / salary.grossAnnual) * 100).toFixed(2)
        : 0;

    const deductionPct = salary?.grossAnnual
        ? parseFloat((salary.totalDeductions / salary.grossAnnual) * 100).toFixed(2)
        : 0;

    const benefitPct = salary?.grossAnnual
        ? parseFloat((salary.totalBenefits / salary.grossAnnual) * 100).toFixed(2)
        : 0;

    // Department & reporting
    const departmentNames = employee.departmentAssignments
        .map(d => d.department?.name)
        .filter(Boolean)
        .join(", ");

    const managers = employee.departmentAssignments
        .map(d => d.reporting?.fullName)
        .filter(Boolean);

    // Recent attendance for sparkline
    const recentAttendance = generateLast30DaysAttendance(employee.attendance);
    // Calculate average work hours
    const avgWorkHours = employee.attendance.length > 0
        ? (employee.attendance.reduce((sum, a) => sum + (a.effectiveHours || 0), 0) / employee.attendance.length).toFixed(1)
        : "0.0";

    // Leave statistics
    const pendingLeaves = employee.leaveRequests.filter(l => l.status === "PENDING").length;
    const approvedLeaves = employee.leaveRequests.filter(l => l.status === "APPROVED").length;
    const totalLeaveDays = employee.leaveRequests.reduce((sum, l) => sum + (l.totalDays || 0), 0);

    // Performance score (0-100)
    const performanceScore = Math.min(100, Math.round(
        (parseFloat(attendanceRate) * 0.4) +
        (Math.min(engagementScore, 100) * 0.3) +
        (avgWorkHours >= 8 ? 30 : (avgWorkHours / 8) * 30)
    ));

    /* ==========================================================
       ENHANCED HTML WITH MODERN DESIGN
    ========================================================== */

    return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Employee Profile — ${employee.fullName}</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  
  * { font-family: 'Inter', sans-serif; }
  body { 
    -webkit-print-color-adjust: exact;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }
  
  .glass {
    background: rgba(255, 255, 255, 0);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  
  .glass-dark {
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .gradient-bg {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }
  .gradient-text {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-stroke: 1px #fff;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .stat-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .stat-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }
  
  .progress-ring {
    transition: stroke-dashoffset 0.5s ease;
  }
  
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .animate-in {
    animation: fadeInUp 0.6s ease forwards;
  }
  
  .sparkline-dot {
    transition: all 0.2s ease;
  }
  
  .sparkline-dot:hover {
    transform: scale(1.5);
    filter: brightness(1.2);
  }
  
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  
  .donut-segment {
    transition: all 0.3s ease;
    cursor: pointer;
  }
  
  .donut-segment:hover {
    opacity: 0.8;
    filter: brightness(1.1);
  }
</style>
</head>

<body class="p-4 min-h-screen">
  <div class="max-w-7xl mx-auto space-y-2">

    <!-- HERO HEADER -->
    <div class="glass rounded-lg p-8 shadow-2xl animate-in">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div class="flex items-center gap-6">
          <div class="w-24 h-24 rounded-lg gradient-bg flex items-center justify-center text-white text-3xl font-bold shadow-lg">
            ${employee.fullName.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div>
            <h1 class="text-4xl font-bold text-slate-900 mb-2">${employee.fullName}</h1>
            <div class="flex flex-wrap gap-2 mb-3">
              <span class="badge bg-purple-100 text-purple-700">${employee.employeeCode}</span>
              <span class="badge bg-blue-100 text-blue-700">${employee.designation?.name ?? "—"}</span>
              ${departmentNames ? `<span class="badge bg-emerald-100 text-emerald-700">${departmentNames}</span>` : ''}
            </div>
            <p class="text-sm uppercase text-slate-600">${employee.organization.name}</p>
          </div>
        </div>
        
        <div class="flex flex-col items-end gap-2">
          <div class="text-sm text-slate-500">Performance Score</div>
          <div class="text-5xl font-bold gradient-text">${performanceScore}</div>
          <div class="text-xs uppercase text-slate-400">out of 100</div>
        </div>
      </div>
    </div>

    <!-- KEY METRICS GRID -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      ${metricCard("Attendance", `${attendanceRate}%`, presentPct, "#10b981", "📊")}
      ${metricCard("Avg Work Hours", `${avgWorkHours}h`, Math.min((parseFloat(avgWorkHours) / 8) * 100, 100), "#3b82f6", "⏰")}
      ${metricCard("Engagement", engagementScore, Math.min(engagementScore, 100), engagementColor, "🔥")}
      ${metricCard("Leave Balance", totalLeaveDays, Math.min(totalLeaveDays * 10, 100), "#f59e0b", "🏖️")}
    </div>

    <!-- MAIN CONTENT GRID -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
      
      <!-- LEFT COLUMN -->
      <div class="lg:col-span-2 space-y-2">
        
        <!-- ATTENDANCE OVERVIEW -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-bold text-slate-900">Attendance Overview</h2>
            <span class="text-sm text-slate-500">${attendanceTotal} total days</span>
          </div>
          
          <!-- Donut Chart -->
          <div class="flex flex-col md:flex-row items-center gap-8 mb-6">
            <div class="relative w-48 h-48">
              ${donutChart([
        { label: 'Present', value: presentPct, color: '#10b981' },
        { label: 'Absent', value: absentPct, color: '#ef4444' },
        { label: 'Half Day', value: halfPct, color: '#f59e0b' }
    ])}
            </div>
            
            <div class="flex-1 grid grid-cols-3 gap-4 w-full">
              ${legendItem("Present", presentDays, presentPct, "#10b981")}
              ${legendItem("Absent", absentDays, absentPct, "#ef4444")}
              ${legendItem("Half Day", halfDays, halfPct, "#f59e0b")}
            </div>
          </div>
          
          <!-- 30-Day Attendance Trend -->
          <div>
            <h3 class="text-sm font-semibold text-slate-700 mb-3">Last 30 Days Trend</h3>
            <div class="flex items-end gap-[2px] h-15">
  ${recentAttendance.map(a => {
        const scale =
            a.status === "PRESENT" ? 1 :
                a.status === "HALF_DAY" ? 0.75 : 0.35;

        const color =
            a.status === "PRESENT" ? "#10b981" :
                a.status === "HALF_DAY" ? "#f59e0b" :
                    "#ef4444";

        return `
      <div class="flex-1 flex items-end group relative">
        <div
          class="w-full rounded-md transition-all duration-300"
          style="
            height: 100%;
            transform: scaleY(${scale});
            transform-origin: bottom;
            background: ${color};
            min-height: 8px;
          "
        ></div>

        <!-- Tooltip -->
        <div class="absolute -top-16 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100
                    transition-opacity bg-slate-900 text-white text-xs px-3 py-2
                    rounded-lg whitespace-nowrap shadow-xl z-10">
          <div class="font-semibold">${fmt(a.date)}</div>
          <div class="text-slate-300">${a.status.replace('_', ' ')}</div>
          ${a.effectiveHours > 0
                ? `<div class="text-slate-400 text-[10px] mt-1">${a.effectiveHours.toFixed(1)}h worked</div>`
                : ''
            }
        </div>
      </div>
    `;
    }).join("")}
</div>

          </div>
        </div>

        <!-- SALARY BREAKDOWN -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <h2 class="text-xl font-bold text-slate-900 mb-2">Compensation Breakdown</h2>
          
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            ${salaryMetric("Gross Annual", salary?.grossAnnual)}
            ${salaryMetric("Total Earnings", salary?.totalEarnings)}
            ${salaryMetric("Deductions", salary?.totalDeductions)}
            ${salaryMetric("In-Hand Annual", salary?.inHandAnnual)}
          </div>
          
          <!-- Salary Distribution -->
<div class="mt-6">
  <div class="flex justify-between items-center mb-3">
    <span class="text-sm font-semibold text-white/90">Salary Distribution</span>
    <span class="text-sm text-white/70">100% of Gross</span>
  </div>

  <!-- STACKED BAR -->
  <div class="relative w-full h-5 rounded-full overflow-hidden bg-white/20 backdrop-blur-sm">

    <!-- EARNINGS -->
    <div
      class="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-blue-600"
      style="width:${earningPct}%"
    ></div>

    <!-- BENEFITS (SUBSET OF EARNINGS) -->
    <div
      class="absolute left-0 top-0 h-full"
      style="
        width:${benefitPct}%;
        background:
          repeating-linear-gradient(
            45deg,
            rgba(168,85,247,0.7),
            rgba(168,85,247,0.7) 6px,
            rgba(196,132,252,0.7) 6px,
            rgba(196,132,252,0.7) 12px
          );
      "
      title="Benefits"
    ></div>

    <!-- DEDUCTIONS -->
    <div
      class="absolute right-0 top-0 h-full bg-gradient-to-r from-rose-500 to-rose-600"
      style="width:${deductionPct}%"
    ></div>
  </div>

  <!-- LEGEND -->
  <div class="flex flex-wrap gap-6 mt-4 text-sm text-white/90">
    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full bg-blue-500"></span>
      <span>Earnings</span>
      <span class="text-white/60">(${earningPct}%)</span>
    </div>

    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full bg-purple-500"></span>
      <span>Benefits</span>
      <span class="text-white/60">(part of earnings · ${benefitPct}%)</span>
    </div>

    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full bg-rose-500"></span>
      <span>Deductions</span>
      <span class="text-white/60">(${deductionPct}%)</span>
    </div>
  </div>
</div>


          
          <div class="mt-2 p-4 bg-slate-50 rounded-xl">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-slate-700">Monthly In-Hand</span>
              <span class="text-2xl font-bold text-emerald-600">₹${salary?.inHandMonthly?.toLocaleString() ?? "0"}</span>
            </div>
          </div>
        </div>

        <!-- LEAVE REQUESTS -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-bold text-slate-900">Leave Management</h2>
            <div class="flex gap-2">
              <span class="badge bg-amber-100 text-amber-700">${pendingLeaves} Pending</span>
              <span class="badge bg-emerald-100 text-emerald-700">${approvedLeaves} Approved</span>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-50 border-b-2 border-slate-200">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold text-slate-700">Period</th>
                  <th class="px-4 py-3 text-left font-semibold text-slate-700">Days</th>
                  <th class="px-4 py-3 text-left font-semibold text-slate-700">Reason</th>
                  <th class="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${employee.leaveRequests.slice(0, 5).map(l => `
                  <tr class="hover:bg-slate-50 transition-colors">
                    <td class="px-4 py-3">
                      <div class="font-medium text-slate-900">${fmt(l.startDate)}</div>
                      <div class="text-xs text-slate-500">to ${fmt(l.endDate)}</div>
                    </td>
                    <td class="px-4 py-3">
                      <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm">
                        ${l.totalDays}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-slate-600">${l.reason}</td>
                    <td class="px-4 py-3">
                      ${statusBadge(l.status)}
                    </td>
                  </tr>
                `).join("") || `<tr><td colspan="4" class="px-4 py-8 text-center text-slate-400">No leave requests</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN -->
      <div class="grid grid-cols-2 gap-2">
        
        <!-- EMPLOYEE DETAILS -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <h2 class="text-xl font-bold text-slate-900 mb-6">Employee Details</h2>
          <div class="space-y-2">
            ${detailRow("📧 Email", employee.email)}
            ${detailRow("📱 Phone", employee.phone)}
            ${detailRow("👤 Gender", employee.gender)}
            ${detailRow("🎂 Date of Birth", fmt(employee.dateOfBirth))}
            ${detailRow("📋 Category", employee.category?.name)}
            ${detailRow("⏱️ Probation", employee.category?.probationMonths ? `${employee.category.probationMonths} months` : "—")}
          </div>
        </div>

        <!-- REPORTING STRUCTURE -->
        <div class="glass rounded-lg p-6  shadow-xl">
          <h2 class="text-xl font-bold text-slate-900 mb-6">Reporting Structure</h2>
          <div class="space-y-4">
            ${managers.map(m => `
              <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                  ${m.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <div class="font-semibold text-slate-900">${m}</div>
                  <div class="text-xs text-slate-500">Reporting Manager</div>
                </div>
              </div>
            `).join("") || '<p class="text-slate-400 text-sm">No reporting structure</p>'}
          </div>
        </div>

        <!-- ENGAGEMENT BREAKDOWN -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <h2 class="text-xl font-bold text-slate-900 mb-6">Engagement Activity</h2>
          <div class="space-y-2">
            ${engagementStat("Posts", employee.pollPosts.length, "📝")}
            ${engagementStat("Comments", employee.pollComments.length, "💬")}
            ${engagementStat("Likes", employee.pollLikes.length, "❤️")}
            ${engagementStat("Votes", employee.pollVotes.length, "🗳️")}
            ${engagementStat("Shares", employee.pollShares.length, "🔄")}
          </div>
          
          <div class="mt-4 p-4 rounded-xl" style="background: linear-gradient(135deg, ${engagementColor}25, ${engagementColor}15);">
            <div class="text-center">
              <div class="text-sm text-slate-600 mb-1">Engagement Level</div>
              <div class="text-2xl font-bold" style="color: ${engagementColor};">${engagementLevel}</div>
            </div>
          </div>
        </div>

        <!-- QUICK STATS -->
        <div class="glass rounded-lg p-6 shadow-xl">
          <h2 class="text-xl font-bold text-slate-900 mb-6">Quick Stats</h2>
          <div class="grid grid-cols-2 gap-3">
            ${quickStat("Assets", employee.assetAssignment.length)}
            ${quickStat("Requests", employee.assetRequests.length)}
            ${quickStat("Shifts", employee.EmployeeShiftAssignment.length)}
            ${quickStat("Payslips", employee.payslips.length)}
          </div>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="glass rounded-lg p-6 shadow-xl text-center">
      <p class="text-sm text-slate-500">
        Report generated on <span class="font-semibold">${new Date().toLocaleString()}</span>
      </p>
      <p class="text-xs text-slate-400 mt-2">Jury HRMS · Confidential Employee Report</p>
    </div>

  </div>
</body>
</html>
`;
}

/**
 * Generate last 30 days attendance data with fallback to ABSENT
 * If actual attendance exists, merge it with the 30-day template
 */
function generateLast30DaysAttendance(attendanceRecords) {
    const last30Days = [];
    const today = new Date();

    // Generate last 30 days template
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        // Try to find actual attendance record for this date
        const actualRecord = attendanceRecords.find(a => {
            const recordDate = new Date(a.date);
            recordDate.setHours(0, 0, 0, 0);
            return recordDate.getTime() === date.getTime();
        });

        last30Days.push({
            date: date.toISOString(),
            status: actualRecord?.status || "ABSENT",
            effectiveHours: actualRecord?.effectiveHours || 0
        });
    }
    return last30Days;
}


/* ==========================================================
   COMPONENT HELPERS
========================================================== */

const metricCard = (label, value, pct, color, emoji) => `
<div class="glass stat-card rounded-lg p-6 shadow-lg">
  <div class="flex justify-between items-start mb-4">
    <div>
      <div class="text-sm text-slate-500 mb-1">${label}</div>
      <div class="text-3xl font-bold text-slate-900">${value}</div>
    </div>
    <div class="text-3xl">${emoji}</div>
  </div>
  <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
    <div class="h-full rounded-full transition-all duration-500" 
         style="width:${pct}%; background:${color};"></div>
  </div>
</div>
`;

const donutChart = (segments) => {
    let offset = 0;
    const radius = 70;
    const circumference = 2 * Math.PI * radius;

    return `
    <svg viewBox="0 0 200 200" class="w-full h-full transform -rotate-90">
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="#f1f5f9" stroke-width="28"/>
      ${segments.map(seg => {
        const length = (seg.value / 100) * circumference;
        const result = `
          <circle class="donut-segment" cx="100" cy="100" r="${radius}" 
                  fill="none" stroke="${seg.color}" stroke-width="28"
                  stroke-dasharray="${length} ${circumference}"
                  stroke-dashoffset="${-offset}"
                  stroke-linecap="round"/>
        `;
        offset += length;
        return result;
    }).join("")}
      <text x="100" y="100" text-anchor="middle" dy=".3em" 
            class="text-2xl font-bold fill-slate-900" transform="rotate(90 100 100)">
        ${segments[0].value}%
      </text>
    </svg>
  `;
};

const legendItem = (label, count, pct, color) => `
<div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
  <div class="w-4 h-4 rounded-full" style="background:${color};"></div>
  <div class="flex-1">
    <div class="text-xs text-slate-600">${label}</div>
    <div class="font-bold text-slate-900">${count} <span class="text-xs text-slate-500">(${pct}%)</span></div>
  </div>
</div>
`;

const salaryMetric = (label, value) => `
<div class="p-4 bg-slate-50 rounded-xl">
  <div class="text-xs text-slate-600">${label}</div>
  <div class="text-lg font-bold text-slate-900">₹${value?.toLocaleString() ?? "0"}</div>
</div>
`;

const distributionBar = (label, pct, colorClass) => `
<div>
  <div class="flex justify-between text-sm mb-2">
    <span class="font-medium text-slate-700">${label}</span>
    <span class="font-semibold text-slate-900">${pct}%</span>
  </div>
  <div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
    <div class="h-full ${colorClass} rounded-full transition-all duration-500" 
         style="width:${pct}%;"></div>
  </div>
</div>
`;

const detailRow = (label, value) => `
<div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
  <span class="text-sm text-slate-600">${label}</span>
  <span class="text-sm font-semibold text-slate-900">${value ?? "—"}</span>
</div>
`;

const engagementStat = (label, count, emoji) => `
<div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
  <div class="flex items-center gap-2">
    <span class="text-lg">${emoji}</span>
    <span class="text-sm text-slate-600">${label}</span>
  </div>
  <span class="text-lg font-bold text-slate-900">${count}</span>
</div>
`;

const quickStat = (label, count) => `
<div class="p-3 bg-slate-50 rounded-xl text-center">
  <div class="text-2xl font-bold text-slate-900">${count}</div>
  <div class="text-xs text-slate-600 mt-1">${label}</div>
</div>
`;

const statusBadge = (status) => {
    const colors = {
        PENDING: 'bg-amber-100 text-amber-700',
        APPROVED: 'bg-emerald-100 text-emerald-700',
        REJECTED: 'bg-rose-100 text-rose-700',
        CANCELLED: 'bg-slate-100 text-slate-700'
    };
    return `<span class="badge ${colors[status] || colors.PENDING}">${status}</span>`;
};

const fmt = d => d ? new Date(d).toISOString().split("T")[0] : "—";