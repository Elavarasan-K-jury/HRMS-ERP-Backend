import { prisma } from "@jury-hrms/db/client.js";
import { startOfDay, endOfDay } from "date-fns";
import { FileService } from "@jury-hrms/files";
import { reportQueue } from "./queue.js";
import { generateAttendancePDF } from "./pdf/generateAttendancePDF.js";

function localDayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ============================================================
   PROCESS ATTENDANCE REPORT
============================================================ */
async function processAttendanceReport(reportId) {
    try {
        console.log("Processing report:", reportId);

        // Update → PROCESSING
        await prisma.attendanceReports.update({
            where: { id: reportId },
            data: {
                status: "PROCESSING",
                startedAt: new Date(),
            },
        });

        // Fetch report record
        const report = await prisma.attendanceReports.findUnique({
            where: { id: reportId },
        });

        if (!report) throw new Error("Report not found");

        // 1️⃣ Generate attendance data (multi-employee)
        const result = await getOrganizationAttendanceReport({
            organizationId: report.organizationId,
            departmentId: report.departmentId,
            designationId: report.designationId,
            employeeId: report.employeeId,
            startDate: report.startDate,
            endDate: report.endDate,
        });

        // 2️⃣ Generate PDF (no employee argument)
        const pdfBuffer = await generateAttendancePDF({
            reportId,
            days: result.days,
            summary: {
                start: report.startDate ? report.startDate.toISOString().slice(0, 10) : 'N/A',
                end: report.endDate ? report.endDate.toISOString().slice(0, 10) : 'N/A',
            }
        });

        // 3️⃣ Upload PDF using @jury-hrms/files
        const uploaded = await FileService.upload(
            pdfBuffer,
            `attendance-report-${reportId}.pdf`,
            'attendance-report'
        );

        // uploaded = { url, path } or { url, key }

        // 4️⃣ Save COMPLETED + PDF URL
        await prisma.attendanceReports.update({
            where: { id: reportId },
            data: {
                status: "COMPLETED",
                completedAt: new Date(),
                responseData: result.days,
                pdfUrl: uploaded.url,
            },
        });

        console.log("Report completed:", reportId);

    } catch (err) {
        console.error("Report failed:", reportId, err);

        await prisma.attendanceReports.update({
            where: { id: reportId },
            data: {
                status: "FAILED",
                failedAt: new Date(),
                failingReason: err.message,
            },
        });
    }
}

/* ============================================================
   GENERATE MULTI-EMPLOYEE ATTENDANCE RESULTS
============================================================ */
export async function getOrganizationAttendanceReport({
    organizationId,
    departmentId = null,
    designationId = null,
    employeeId = null,
    startDate = null,
    endDate = null,
}) {
    try {
        console.log("\n📌 ATTENDANCE REPORT INPUT:", {
            organizationId,
            departmentId,
            designationId,
            employeeId,
            startDate,
            endDate,
        });

        if (!organizationId || organizationId.length !== 24) {
            throw new Error("Invalid organizationId");
        }

        /* ----------------------------------------
            1️⃣ FETCH EMPLOYEES
        ---------------------------------------- */
        const employeeWhere = {
            organizationId,
            ...(employeeId ? { id: employeeId } : {}),
            ...(designationId ? { designationId } : {}),
        };

        if (departmentId) {
            employeeWhere.departmentAssignments = {
                some: {
                    departmentId,
                    OR: [{ endDate: null }, { endDate: { equals: null } }],
                },
            };
        }

        const employees = await prisma.organizationEmployees.findMany({
            where: employeeWhere,
            include: {
                designation: true,
                departmentAssignments: {
                    include: { department: true },
                },
            },
        });

        if (employees.length === 0) {
            return {
                success: true,
                message: "No employees found",
                days: [],
                stats: {
                    total_records: 0,
                    present: 0,
                    absent: 0,
                    late: 0,
                    avg_gross_hours: 0,
                    avg_effective_hours: 0,
                },
            };
        }

        const employeeIds = employees.map((e) => e.id);

        /* ----------------------------------------
            2️⃣ DATE FILTER
        ---------------------------------------- */
        const dateFilter = {};
        if (startDate) dateFilter.gte = startOfDay(new Date(startDate));
        if (endDate) dateFilter.lte = endOfDay(new Date(endDate));

        /* ----------------------------------------
            3️⃣ FETCH ATTENDANCE + LOGS
        ---------------------------------------- */
        const attendanceRows = await prisma.attendance.findMany({
            where: { deletedAt: null,
                organizationId,
                employeeId: { in: employeeIds },
                ...(startDate || endDate ? { date: dateFilter } : {}),
            },
            include: {
                logs: true,
                employee: {
                    include: {
                        designation: true,
                        departmentAssignments: {
                            include: { department: true },
                        },
                        organization: true,
                    },
                },
            },
            orderBy: { date: "asc" },
        });

        /* ----------------------------------------
            4️⃣ GROUP BY DAY (with multiple employees)
        ---------------------------------------- */
        const dayMap = {};

        for (const rec of attendanceRows) {
            const dateKey = localDayKey(rec.date);
            if (!dayMap[dateKey]) dayMap[dateKey] = [];

            const emp = rec.employee;

            dayMap[dateKey].push({
                attendance_id: rec.id,
                employee: {
                    id: emp.id,
                    name: emp.fullName,
                    code: emp.employeeCode,
                    phone: emp.phone,
                    email: emp.email,
                    designation: emp.designation?.name || null,
                    designation_id: emp.designation?.id || null,
                    department:
                        emp.departmentAssignments?.[0]?.department?.name || null,
                    department_id:
                        emp.departmentAssignments?.[0]?.department?.id || null,
                    organization: {
                        id: emp.organization.id,
                        name: emp.organization.name,
                        domain: emp.organization.domain,
                    },
                },
                date: dateKey,
                status: rec.status,
                check_in: rec.checkIn,
                check_out: rec.checkOut,
                gross_hours: rec.grossHours,
                effective_hours: rec.effectiveHours,
                late_minutes: rec.lateArrivalMinutes,
                logs: rec.logs.map((log) => ({
                    id: log.id,
                    type: log.type,
                    ip: log.ipAddress,
                    created_at: log.createdAt,
                    geo: log.geoLocation || null,
                    source: log.source,
                })),
            });
        }

        const days = Object.keys(dayMap)
            .sort()
            .map((d) => ({
                date: d,
                attendance: dayMap[d], // MANY employees here
            }));

        /* ----------------------------------------
            5️⃣ SUMMARY (optional)
        ---------------------------------------- */
        let present = 0,
            absent = 0,
            late = 0,
            totalGross = 0,
            totalEffective = 0;

        for (const rec of attendanceRows) {
            if (rec.status === "PRESENT" || rec.status === "HALF_DAY") present++;
            if (rec.status === "ABSENT") absent++;
            if (rec.lateArrivalMinutes > 0) late++;

            totalGross += rec.grossHours || 0;
            totalEffective += rec.effectiveHours || 0;
        }

        const stats = {
            total_records: attendanceRows.length,
            present,
            absent,
            late,
            avg_gross_hours:
                attendanceRows.length > 0
                    ? totalGross / attendanceRows.length
                    : 0,
            avg_effective_hours:
                attendanceRows.length > 0
                    ? totalEffective / attendanceRows.length
                    : 0,
        };

        return {
            success: true,
            message: "Attendance report generated successfully",
            days,
            stats,
        };
    } catch (err) {
        console.error("[AttendanceReport ERROR]", err);
        throw err;
    }
}

/* ============================================================
   QUEUE WRAPPER
============================================================ */
export function enqueueAttendanceReport(reportId) {
    reportQueue.add(async () => {
        await processAttendanceReport(reportId);
    });
}
