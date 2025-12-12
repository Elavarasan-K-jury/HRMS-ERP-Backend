// services/attendance/renderAttendanceHTML.js

function escapeHtml(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatHours(value) {
    if (value === null || value === undefined) return "-";
    const num = Number(value);
    if (Number.isNaN(num)) return "-";
    return `${num.toFixed(2)} hrs`;
}

function formatMinutes(value) {
    if (value === null || value === undefined) return "-";
    const num = Number(value);
    if (Number.isNaN(num)) return "-";
    return `${num} min`;
}

function formatDateLabel(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return escapeHtml(dateStr);

    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const w = weekdays[d.getDay()];
    return `${dateStr} (${w})`;
}

function formatTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return escapeHtml(ts);
    return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function parseSource(sourceRaw) {
    if (!sourceRaw) return "";
    try {
        const obj = JSON.parse(sourceRaw);
        if (obj.source) return obj.source;
        const parts = [];
        if (obj.browser) parts.push(obj.browser);
        if (obj.os) parts.push(obj.os);
        return parts.join(" on ") || sourceRaw;
    } catch {
        return sourceRaw;
    }
}

function statusClass(status) {
    switch (status) {
        case "PRESENT":
            return "status-pill present";
        case "HALF_DAY":
            return "status-pill half";
        case "ABSENT":
            return "status-pill absent";
        default:
            return "status-pill default";
    }
}

export function renderAttendanceHTML({ reportId, days = [], summary = {} }) {
    const allAttendance = days.flatMap((d) => d.attendance || []);

    // Unique employees across all days
    const employeeMap = new Map();
    for (const day of days) {
        for (const rec of day.attendance || []) {
            if (rec.employee && !employeeMap.has(rec.employee.id)) {
                employeeMap.set(rec.employee.id, rec.employee);
            }
        }
    }
    const employees = Array.from(employeeMap.values());

    // Basic org info from first employee (if any)
    const org =
        employees[0]?.organization || {
            name: "Organization Name",
            domain: "",
        };

    // Stats
    let present = 0;
    let half = 0;
    let absent = 0;
    let totalGross = 0;
    let totalEffective = 0;

    for (const rec of allAttendance) {
        if (rec.status === "PRESENT") present++;
        if (rec.status === "HALF_DAY") half++;
        if (rec.status === "ABSENT") absent++;
        totalGross += rec.gross_hours || 0;
        totalEffective += rec.effective_hours || 0;
    }

    const stats = {
        totalRecords: allAttendance.length,
        totalDays: days.length,
        totalEmployees: employees.length,
        present,
        half,
        absent,
        totalGross,
        totalEffective,
    };

    const periodStart = summary.start || "";
    const periodEnd = summary.end || "";
    const generatedOn = new Date().toISOString().slice(0, 10);

    const orgInitials = org.name
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    // Build HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Attendance Detailed Report - ${escapeHtml(org.name)}</title>
  <style>
    :root {
      --primary: #0f766e;
      --primary-soft: #e0f2f1;
      --primary-strong: #115e59;
      --border: #e5e7eb;
      --border-soft: #f3f4f6;
      --text-main: #111827;
      --text-muted: #6b7280;
      --bg: #f9fafb;
      --danger: #b91c1c;
      --warning: #f97316;
      --success: #15803d;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text-main);
      font-size: 13px;
      line-height: 1.4;
    }

    .report-wrapper {
      max-width: 1140px;
      margin: 16px auto;
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      padding: 18px 24px 24px;
    }

    /* HEADER */

    .report-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 14px;
    }

    .org-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .org-logo {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 2px solid var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 20px;
      color: var(--primary);
      background: var(--primary-soft);
    }

    .org-text h1 {
      font-size: 18px;
      margin: 0 0 3px;
    }

    .org-text p {
      margin: 0;
      font-size: 11px;
      color: var(--text-muted);
    }

    .report-title-block {
      text-align: right;
    }

    .report-title {
      font-size: 20px;
      margin: 0;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--primary-strong);
    }

    .report-meta {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .report-meta strong {
      color: var(--text-main);
    }

    .report-id {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* ACTIONS (hidden on PDF but useful if opened in browser) */

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 10px;
    }

    .btn {
      border-radius: 999px;
      border: 1px solid var(--primary);
      padding: 5px 12px;
      font-size: 12px;
      background: #ffffff;
      color: var(--primary);
      cursor: pointer;
    }

    .btn.primary {
      background: var(--primary);
      color: #ffffff;
    }

    .btn:focus {
      outline: 2px solid #0ea5e9;
      outline-offset: 1px;
    }

    /* SUMMARY GRID */

    .summary-grid {
      display: grid;
      grid-template-columns: 2fr 1.4fr;
      gap: 14px;
      margin-bottom: 16px;
    }

    .card {
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #ffffff;
      padding: 12px 14px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }

    .card-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-muted);
    }

    .card-sub {
      font-size: 11px;
      color: var(--text-muted);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      background: var(--border-soft);
    }

    .info-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      column-gap: 8px;
      row-gap: 3px;
      font-size: 12px;
    }

    .info-label {
      color: var(--text-muted);
    }

    .info-value {
      font-weight: 500;
    }

    .stat-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 4px;
      font-size: 12px;
    }

    .stat-pill {
      min-width: 80px;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .stat-label {
      color: var(--text-muted);
    }

    .stat-value {
      font-weight: 600;
    }

    .stat-value.present {
      color: var(--success);
    }
    .stat-value.half {
      color: var(--warning);
    }
    .stat-value.absent {
      color: var(--danger);
    }

    /* EMPLOYEE LIST MINI-CARD */

    .employee-list {
      margin-top: 4px;
      border-radius: 8px;
      border: 1px dashed var(--border);
      background: #f9fafb;
      padding: 6px 8px;
      max-height: 82px;
      overflow: hidden;
    }

    .employee-list-title {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .employee-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .employee-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #ffffff;
      max-width: 210px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* DAY SECTION */

    .day-section {
      border-radius: 12px;
      border: 1px solid var(--border);
      margin-bottom: 12px;
      overflow: hidden;
      page-break-inside: avoid;
    }

    .day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--primary-soft);
      border-bottom: 1px solid var(--border);
    }

    .day-title {
      font-weight: 600;
      font-size: 14px;
    }

    .day-sub {
      font-size: 11px;
      color: var(--text-muted);
    }

    .day-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11px;
      justify-content: flex-end;
    }

    .meta-pill {
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(15, 118, 110, 0.25);
      background: #ffffff;
      color: var(--primary-strong);
    }

    .day-body {
      padding: 8px 10px 10px;
      background: #ffffff;
    }

    /* EMPLOYEE ATTENDANCE BLOCK */

    .employee-attendance {
      border-radius: 10px;
      border: 1px solid var(--border-soft);
      background: #fcfcfd;
      margin-bottom: 8px;
      padding: 8px 10px;
    }

    .emp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .emp-main {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
    }

    .emp-name {
      font-weight: 600;
      font-size: 13px;
    }

    .emp-code {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: #ffffff;
      color: var(--text-muted);
    }

    .emp-meta-line {
      font-size: 11px;
      color: var(--text-muted);
    }

    .status-pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-weight: 600;
      display: flex;
      justify-content: center;
      align-items: center;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .status-pill.present {
      border-color: rgba(21, 128, 61, 0.4);
      background: #ecfdf3;
      color: var(--success);
    }

    .status-pill.half {
      border-color: rgba(249, 115, 22, 0.4);
      background: #fff7ed;
      color: var(--warning);
    }

    .status-pill.absent {
      border-color: rgba(185, 28, 28, 0.4);
      background: #fef2f2;
      color: var(--danger);
    }

    .status-pill.default {
      background: #f3f4f6;
      color: var(--text-muted);
    }

    .metrics-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }

    .metric {
      flex: 1 1 130px;
      border-radius: 8px;
      border: 1px solid var(--border-soft);
      background: #ffffff;
      padding: 4px 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }

    .metric-label {
      color: var(--text-muted);
    }

    .metric-value {
      font-weight: 500;
    }

    .metric-id {
      flex: 1 1 200px;
    }

    /* LOGS TABLE */

    .logs-wrapper {
      margin-top: 4px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #ffffff;
      max-height: 220px;
      overflow: hidden;
    }

    table.logs {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }

    table.logs thead {
      background: #f3f4f6;
    }

    table.logs th,
    table.logs td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
      outline: none;
    }

    table.logs th {
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 9.8px;
    }

    table.logs tbody tr:nth-child(even) {
      background: #fafafa;
    }

    .tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 10px;
      border: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .tag.check-in {
      border-color: rgba(22, 163, 74, 0.5);
      color: #166534;
      background: #ecfdf3;
    }

    .tag.check-out {
      border-color: rgba(234, 88, 12, 0.5);
      color: #9a3412;
      background: #fff7ed;
    }

    .geo {
      white-space: nowrap;
    }

    .source {
      color: var(--text-muted);
      max-width: 260px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* RESPONSIVE */

    @media (max-width: 900px) {
      .report-wrapper {
        margin: 0;
        border-radius: 0;
        box-shadow: none;
        border: none;
      }

      .report-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .report-title-block {
        text-align: left;
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .day-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .day-meta {
        justify-content: flex-start;
      }
    }

    /* PRINT / PDF */

    @media print {
      body {
        background: #ffffff;
      }

      .report-wrapper {
        box-shadow: none;
        border-radius: 0;
        border: none;
        margin: 0;
        width: 100%;
        padding: 8mm 10mm;
      }

      .actions {
        display: none !important;
      }

      .day-section {
        page-break-inside: avoid;
      }

      @page {
        size: A4 landscape;
        margin: 10mm 10mm 10mm 10mm;
      }
    }
  </style>
</head>
<body>
  <div class="report-wrapper">

    <div class="actions">
      <button class="btn" onclick="window.print()">Print</button>
      <button class="btn primary">Download PDF</button>
    </div>

    <header class="report-header">
      <div class="org-info">
        <div class="org-logo">${escapeHtml(orgInitials)}</div>
        <div class="org-text">
          <h1>${escapeHtml(org.name)}</h1>
          <p>${escapeHtml(org.domain || "")}</p>
        </div>
      </div>
      <div class="report-title-block">
        <h2 class="report-title">ATTENDANCE DETAILED REPORT</h2>
        <div class="report-meta">
          Period:
          <strong>${escapeHtml(periodStart || "-")}</strong>
          to
          <strong>${escapeHtml(periodEnd || "-")}</strong><br />
          Generated on:
          <strong>${escapeHtml(generatedOn)}</strong>
        </div>
        <div class="report-id">
          Report ID: ${escapeHtml(reportId || "-")}
        </div>
      </div>
    </header>

    <!-- SUMMARY -->
    <section class="summary-grid">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Report Summary</div>
            <div class="card-sub">Overall statistics for the selected period</div>
          </div>
          <span class="chip">
            Days: ${stats.totalDays || 0} • Employees: ${stats.totalEmployees || 0}
          </span>
        </div>

        <div class="info-row" style="margin-bottom:6px;">
          <div class="info-label">Date Range</div>
          <div class="info-value">${escapeHtml(periodStart || "-")} – ${escapeHtml(periodEnd || "-")}</div>
        </div>
        <div class="info-row" style="margin-bottom:6px;">
          <div class="info-label">Total Records</div>
          <div class="info-value">${stats.totalRecords}</div>
        </div>

        <div class="stat-row">
          <div class="stat-pill">
            <span class="stat-label">Present</span>
            <span class="stat-value present">${stats.present}</span>
          </div>
          <div class="stat-pill">
            <span class="stat-label">Half-day</span>
            <span class="stat-value half">${stats.half}</span>
          </div>
          <div class="stat-pill">
            <span class="stat-label">Absent</span>
            <span class="stat-value absent">${stats.absent}</span>
          </div>
          <div class="stat-pill">
            <span class="stat-label">Gross</span>
            <span class="stat-value">${stats.totalGross.toFixed(2)} hrs</span>
          </div>
          <div class="stat-pill">
            <span class="stat-label">Effective</span>
            <span class="stat-value">${stats.totalEffective.toFixed(2)} hrs</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Employees</div>
            <div class="card-sub">Employees included in this report</div>
          </div>
        </div>
        <div class="info-row" style="margin-bottom:6px;">
          <div class="info-label">Total Employees</div>
          <div class="info-value">${stats.totalEmployees}</div>
        </div>
        <div class="employee-list">
          <div class="employee-list-title">Sample employees in this report</div>
          <div class="employee-tags">
            ${employees
            .slice(0, 12)
            .map((emp) => {
                const name = escapeHtml(emp.fullName || emp.name || "Employee");
                const code = escapeHtml(emp.code || emp.employeeCode || "");
                return `<span class="employee-tag">${name}${code ? " · " + code : ""}</span>`;
            })
            .join("")}
            ${employees.length > 12
            ? `<span class="employee-tag">+${employees.length - 12} more…</span>`
            : ""
        }
          </div>
        </div>
      </div>
    </section>

    <!-- DAYS & ATTENDANCE -->
    ${days
            .map((day) => {
                const attendance = day.attendance || [];
                const dayTitle = formatDateLabel(day.date);
                const employeesCount = attendance.length;

                return `
        <section class="day-section">
          <div class="day-header">
            <div>
              <div class="day-title">${escapeHtml(dayTitle)}</div>
              <div class="day-sub">Employees: ${employeesCount}</div>
            </div>
            <div class="day-meta">
              <span class="meta-pill">Total records: ${attendance.length
                    }</span>
            </div>
          </div>
          <div class="day-body">
            ${attendance
                        .map((rec) => {
                            const emp = rec.employee || {};
                            const empName = escapeHtml(emp.fullName || emp.name || "Employee");
                            const empCode = escapeHtml(emp.code || emp.employeeCode || "");
                            const designation = escapeHtml(emp.designation || "");
                            const department = escapeHtml(emp.department || "");
                            const phone = escapeHtml(emp.phone || "");
                            const email = escapeHtml(emp.email || "");

                            const ci = rec.check_in ? formatTime(rec.check_in) : "—";
                            const co = rec.check_out ? formatTime(rec.check_out) : "—";

                            const status = rec.status || "PENDING";
                            const statusCls = statusClass(status);

                            return `
                  <article class="employee-attendance">
                    <div class="emp-header">
                      <div>
                        <div class="emp-main">
                          <span class="emp-name">${empName}</span>
                          ${empCode
                                    ? `<span class="emp-code">${empCode}</span>`
                                    : ""
                                }
                        </div>
                        <div class="emp-meta-line">
                          ${designation ? designation : "—"}
                          ${department ? " · " + department : ""}
                          ${phone ? " · " + phone : ""}
                          ${email ? " · " + email : ""}
                        </div>
                      </div>
                      <span class="${statusCls}">${escapeHtml(status)}</span>
                    </div>

                    <div class="metrics-row">
                      <div class="metric">
                        <span class="metric-label">Check-in</span>
                        <span class="metric-value">${escapeHtml(ci)}</span>
                      </div>
                      <div class="metric">
                        <span class="metric-label">Check-out</span>
                        <span class="metric-value">${escapeHtml(co)}</span>
                      </div>
                      <div class="metric">
                        <span class="metric-label">Gross</span>
                        <span class="metric-value">${formatHours(
                                    rec.gross_hours
                                )}</span>
                      </div>
                      <div class="metric">
                        <span class="metric-label">Effective</span>
                        <span class="metric-value">${formatHours(
                                    rec.effective_hours
                                )}</span>
                      </div>
                      <div class="metric">
                        <span class="metric-label">Late</span>
                        <span class="metric-value">${formatMinutes(
                                    rec.late_minutes
                                )}</span>
                      </div>
                    </div>

                    ${(rec.logs || []).length
                                    ? `
                    <div class="logs-wrapper">
                      <table class="logs">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Time</th>
                            <th>Type</th>
                            <th>IP</th>
                            <th>Geo (Lat, Lng)</th>
                            <th>Device / Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${(rec.logs || [])
                                        .map((log, idx) => {
                                            const createdAt = formatTime(log.created_at);
                                            const tagClass =
                                                log.type === "CHECK_IN" ? "tag check-in" : "tag check-out";

                                            let geo = "";
                                            if (log.geo && typeof log.geo.latitude === "number" && typeof log.geo.longitude === "number") {
                                                const lat = log.geo.latitude.toFixed(6);
                                                const lng = log.geo.longitude.toFixed(6);
                                                geo = `${lat}, ${lng}`;
                                            }

                                            const srcText = parseSource(log.source || "");

                                            return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(createdAt)}</td>
        <td>
          <span class="${tagClass}">${escapeHtml(log.type || "")}</span>
        </td>
        <td>${escapeHtml(log.ip || "")}</td>
        <td class="geo">${escapeHtml(geo)}</td>
        <td class="source">${escapeHtml(srcText)}</td>
      </tr>
    `;
                                        })
                                        .join("")}

                        </tbody>
                      </table>
                    </div>
                    `
                                    : ""
                                }
                  </article>
                `;
                        })
                        .join("")}
          </div>
        </section>`;
            })
            .join("")}
  </div>
</body>
</html>`;

    return html;
}
