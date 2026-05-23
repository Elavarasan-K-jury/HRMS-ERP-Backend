import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { checkFinanceEnabled } from '../helper/checks.js';

function getFullMonthAttendance(attendanceArray, year, month) {
    const report = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    const formatDuration = (decimal) => {
        if (!decimal) return "0h 0m";
        const mins = Math.floor(decimal * 60);
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    };

    const toIndianDate = (date) => {
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '-');
    };

    for (let d = 1; d <= daysInMonth; d++) {
        const currentDate = new Date(year, month - 1, d);
        const dayRecord = attendanceArray.find(item => {
            const itemDate = new Date(item.date);
            return itemDate.getFullYear() == year &&
                itemDate.getMonth() == month - 1 &&
                itemDate.getDate() == d;
        });

        if (dayRecord) {
            report.push({
                day: currentDate.toISOString(),
                dayText: toIndianDate(currentDate),
                status: dayRecord.status,
                startTime: dayRecord.checkIn ? new Date(dayRecord.checkIn).toLocaleTimeString('en-IN', { hour12: true }) : 'N/A',
                endTime: dayRecord.checkOut ? new Date(dayRecord.checkOut).toLocaleTimeString('en-IN', { hour12: true }) : 'N/A',
                totalHoursGross: formatDuration(dayRecord.grossHours),
                totalEffectiveHours: formatDuration(dayRecord.effectiveHours),
                raw: dayRecord
            });
        } else {
            report.push({
                day: currentDate.toISOString(),
                dayText: toIndianDate(currentDate),
                status: 'ABSENT',
                startTime: 'N/A',
                endTime: 'N/A',
                totalHoursGross: '0h 0m',
                totalEffectiveHours: '0h 0m',
                raw: null
            });
        }
    }

    return report;
}

function calculateAttendanceSummary(attendanceRecords, startDate, endDate) {
    console.log('Payroll.handler.js @ Line 61:', attendanceRecords);
    let presentDays = 0;
    let absentDays = 0;
    let lateCount = 0;
    let holidayCount = 0;
    let weekoffCount = 0;
    let totalWorkingHours = 0;
    let effectiveHours = 0;
    let lateArrivalMinutes = 0;
    const totalDays = new Date(endDate).getDate() - new Date(startDate).getDate() + 1;


    for (let date = 1; date <= totalDays; date++) {
        const dt = new Date(new Date(startDate).setDate(date));
        const att = attendanceRecords.find(item => {
            const itemDate = new Date(item.date);
            return itemDate.getFullYear() == dt.getFullYear() &&
                itemDate.getMonth() == dt.getMonth() &&
                itemDate.getDate() == dt.getDate();
        })

        console.log('Payroll.handler.js @ Line 83:', att);

        const status = (att?.status || 'ABSENT').toString().toUpperCase().trim();

        if (status === 'PRESENT' || status === 'P') {
            presentDays++;
        } else if (status === 'ABSENT' || status === 'A') {
            absentDays++;
        } else if (status === 'HALF_DAY' || status === 'HD' || status === 'HALF') {
            presentDays = presentDays + 0.5;
            absentDays = absentDays + 0.5;
        } else if (status === 'LATE' || status === 'L') {
            lateCount++;
        } else if (status === 'HOLIDAY' || status === 'H') {
            holidayCount++;
        } else if (status === 'WEEKOFF' || status === 'WEEK_OFF' || status === 'W') {
            weekoffCount++;
        } else {
            absentDays++;
        }

        totalWorkingHours += att?.grossHours || 0;
        effectiveHours += att?.effectiveHours || 0;
        lateArrivalMinutes += att?.lateArrivalMinutes || 0;
    }

    return {
        total_days: totalDays,
        present_days: presentDays,
        absent_days: absentDays,
        late_count: lateCount,
        holiday_count: holidayCount,
        weekoff_count: weekoffCount,
        total_working_hours: Math.round(totalWorkingHours * 100) / 100,
        effective_hours: Math.round(effectiveHours * 100) / 100,
        late_arrival_minutes: lateArrivalMinutes,
    };
}

function calculateLeaveSummary(leaveRequests, year, month) {
    const leaveMap = {};
    let totalLeaveDays = 0;

    for (const leave of leaveRequests || []) {
        if (leave.status !== 'APPROVED') continue;

        const leaveType = leave.leaveTypeId || 'GENERAL';
        const startDate = new Date(leave.startDate);
        const endDate = new Date(leave.endDate);

        const leaveStartMonth = startDate.getMonth() + 1;
        const leaveStartYear = startDate.getFullYear();
        const leaveEndMonth = endDate.getMonth() + 1;
        const leaveEndYear = endDate.getFullYear();

        if ((leaveStartYear === year && leaveStartMonth === month) ||
            (leaveEndYear === year && leaveEndMonth === month)) {

            const daysInCurrentMonth = new Date(year, month, 0).getDate();
            const fromDay = (leaveStartYear === year && leaveStartMonth === month)
                ? startDate.getDate()
                : 1;
            const toDay = (leaveEndYear === year && leaveEndMonth === month)
                ? endDate.getDate()
                : daysInCurrentMonth;
            const daysInMonth = toDay - fromDay + 1;

            if (!leaveMap[leaveType]) {
                leaveMap[leaveType] = { leave_type: leaveType, days: 0, status: leave.status };
            }
            leaveMap[leaveType].days += daysInMonth;
            totalLeaveDays += daysInMonth;
        }
    }

    return {
        total_leave_days: totalLeaveDays,
        leaves: Object.values(leaveMap),
    };
}

function calculateExpenseSummary(expenses) {
    let totalClaimed = 0;
    let totalApproved = 0;
    const approvedExpenses = [];

    for (const exp of expenses || []) {
        totalClaimed += exp.amount || 0;
        if (exp.status === 'APPROVED') {
            totalApproved += exp.amount || 0;
            approvedExpenses.push({
                id: exp.id,
                organization_id: exp.organizationId,
                employee_id: exp.employeeId,
                type: exp.type || 'OTHER',
                amount: exp.amount,
                description: exp.description,
                status: exp.status,
                created_at: exp.createdAt?.toISOString() || '',
            });
        }
    }

    return {
        total_claimed: totalClaimed,
        total_approved: Math.round(totalApproved * 100) / 100,
        approved_expenses: approvedExpenses,
    };
}

export const GetSystemPayroll = async (call, callback) => {
    try {
        const { year, month, organization_id } = call.request;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        if (!organization_id) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "organization_id is required" });
        }

        const organization = await prisma.organizations.findFirst({ where: { id: organization_id } });
        if (!organization) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Organization not found" });
        }

        const enabledFinance = await checkFinanceEnabled(organization_id);
        if (!enabledFinance) {
            return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Finance is not enabled' });
        }

        const employees = await prisma.organizationEmployees.findMany({
            where: {
                organizationId: organization_id,
                attendance: { some: { date: { gte: startDate, lte: endDate } } },
                salaryStructures: { some: { effectiveFrom: { lte: startDate }, status: 'ACTIVE', isCurrentActive: true } }
            },
            include: {
                attendance: true,
                salaryStructures: true,
                regularisations: { include: { attendance: { where: { date: { gte: startDate, lte: endDate } } } } },
                leaveRequests: { where: { startDate: { gte: startDate, lte: endDate }, endDate: { gte: startDate, lte: endDate } } },
                workrequests: { where: { startDate: { gte: startDate, lte: endDate }, endDate: { gte: startDate, lte: endDate } } },
                MyExpenses: { where: { status: 'APPROVED', createdAt: { gte: startDate, lte: endDate } } }
            }
        });

        const emploees_mapped = employees.map((emp) => ({
            ...emp,
            full_name: emp.fullName,
            employee_code: emp.employeeCode,
            first_name: emp.firstName,
            last_name: emp.lastName,
            date_of_birth: emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
            attendance: getFullMonthAttendance(emp.attendance, year, month),
            salary_structures: emp.salaryStructures,
            my_expenses: emp.MyExpenses,
            regularisation: emp.regularisations,
            leave_requests: emp.leaveRequests,
            workrequests: emp.workrequests
        }));

        return callback(null, { success: true, message: 'Payroll fetched successfully', data: emploees_mapped });

    } catch (e) {
        console.error("Get System Payroll Error:", e);
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const CalculatePayroll = async (call, callback) => {
    try {
        const { organization_id, year, month, employee_id } = call.request;
        const yearNum = parseInt(year);
        const monthNum = parseInt(month);

        if (!organization_id) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "organization_id is required" });
        }

        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0);

        const enabledFinance = await checkFinanceEnabled(organization_id);
        if (!enabledFinance) {
            return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Finance is not enabled' });
        }

        const employeeWhere = {
            organizationId: organization_id,
            salaryStructures: {
                some: {
                    effectiveFrom: { lte: startDate },
                    status: 'ACTIVE',
                    isCurrentActive: true,
                    deletedAt: null
                }
            },
            deletedAt: null
        };

        if (employee_id) employeeWhere.id = employee_id;

        const employees = await prisma.organizationEmployees.findMany({
            where: {
                organizationId: organization_id,
                attendance: { some: { date: { gte: startDate, lte: endDate } } },
                salaryStructures: { some: { effectiveFrom: { lte: startDate }, status: 'ACTIVE', isCurrentActive: true } }
            },
            include: {
                attendance: {
                    where: {
                        date: { gte: startDate, lte: endDate }
                    }
                },
                salaryStructures: true,
                regularisations: { include: { attendance: { where: { date: { gte: startDate, lte: endDate } } } } },
                leaveRequests: { where: { startDate: { gte: startDate, lte: endDate }, endDate: { gte: startDate, lte: endDate } } },
                workrequests: { where: { startDate: { gte: startDate, lte: endDate }, endDate: { gte: startDate, lte: endDate } } },
                MyExpenses: { where: { status: 'APPROVED', createdAt: { gte: startDate, lte: endDate } } }
            }
        });

        console.log('[CalculatePayroll] Found employees:', employees);

        const calculations = [];

        for (const emp of employees) {
            const activeStructure = emp.salaryStructures.find(e => e.isCurrentActive && e.status === 'ACTIVE');
            if (!activeStructure) {
                console.log('[CalculatePayroll] No active structure for employee:', emp.id, emp.fullName);
                continue;
            }

            console.log('Payroll.handler.js @ Line 316:', activeStructure);

            console.log('[CalculatePayroll] Processing:', emp.id, emp.fullName);

            const grossAnnual = Number(activeStructure.grossAnnual) || 0;
            const grossMonthly = grossAnnual / 12;

            const attendanceSummary = calculateAttendanceSummary(emp.attendance || [], startDate, endDate);
            const leaveSummary = calculateLeaveSummary(emp.leaveRequests || [], yearNum, monthNum);
            const expenseSummary = calculateExpenseSummary(emp.MyExpenses || []);

            const totalDaysInMonth = new Date(yearNum, monthNum, 0).getDate();
            const effectivePresentDays = attendanceSummary.present_days + leaveSummary.total_leave_days;
            const absentDays = Math.max(0, totalDaysInMonth - effectivePresentDays);

            let deductionForAbsences = 0;
            if (absentDays > 0 && grossMonthly > 0) {
                const dailyRate = grossMonthly / totalDaysInMonth;
                deductionForAbsences = Math.round(absentDays * dailyRate * 100) / 100;
            }

            let totalEarnings = 0;
            let totalDeductions = 0;
            let totalBenefits = 0;
            const salaryComponents = [];

            if (activeStructure.components?.length > 0) {
                for (const comp of activeStructure.components) {
                    const compDef = comp.component || {};
                    const monthlyAmount = comp.monthlyAmount || 0;
                    const annualAmount = comp.annualAmount || 0;

                    salaryComponents.push({
                        component_key: compDef.key || comp.componentId,
                        component_name: compDef.name || 'Unknown',
                        component_type: compDef.type || 'EARNING',
                        monthly_amount: monthlyAmount,
                        annual_amount: annualAmount,
                        formula: comp.formula || ''
                    });

                    const compType = (compDef.type || 'EARNING').toUpperCase();
                    if (compType === 'EARNING') totalEarnings += monthlyAmount;
                    else if (compType === 'DEDUCTION') totalDeductions += monthlyAmount;
                    else if (compType === 'BENEFIT' || compType === 'EMPLOYER') totalBenefits += monthlyAmount;
                }
            } else if (activeStructure.template?.ranges?.length > 0) {
                const range = activeStructure.template.ranges[0];
                if (range.components) {
                    for (const tc of range.components) {
                        const comp = tc.component || {};
                        const monthlyAmount = (Number(tc.value) || grossMonthly) * (comp.includeInGross ? 1 : 0);

                        salaryComponents.push({
                            component_key: comp.key || tc.componentId,
                            component_name: comp.name || 'Unknown',
                            component_type: comp.type || 'EARNING',
                            monthly_amount: Math.round(monthlyAmount * 100) / 100,
                            annual_amount: Math.round(monthlyAmount * 12 * 100) / 100,
                            formula: tc.formula || comp.defaultFormula || ''
                        });

                        const compType = (comp.type || 'EARNING').toUpperCase();
                        if (compType === 'EARNING') totalEarnings += monthlyAmount;
                        else if (compType === 'DEDUCTION') totalDeductions += monthlyAmount;
                        else if (compType === 'BENEFIT') totalBenefits += monthlyAmount;
                    }
                }
            }

            if (salaryComponents.length === 0 && grossMonthly > 0) {
                totalEarnings = grossMonthly;
                salaryComponents.push({
                    component_key: 'BASIC',
                    component_name: 'Basic Salary',
                    component_type: 'EARNING',
                    monthly_amount: grossMonthly,
                    annual_amount: grossMonthly * 12,
                    formula: 'gross / 12'
                });
            }


            // Calculate pro-rated earnings based on attendance
            const effectiveWorkDays = attendanceSummary.present_days + (attendanceSummary.half_day_count * 0.5);
            const attendanceRatio = effectiveWorkDays / totalDaysInMonth;
            const proRatedEarnings = totalEarnings * attendanceRatio;

            // Total deductions include both predefined deductions and absence deductions
            const totalActualDeductions = totalDeductions + deductionForAbsences;

            const netPay = Math.round((proRatedEarnings + expenseSummary.total_approved) * 100) / 100;
            const ctcMonthly = totalEarnings + totalBenefits; // CTC remains based on full salary

            calculations.push({
                employee_id: emp.id,
                employee_name: emp.fullName || `${emp.firstName} ${emp.lastName}`,
                employee_code: emp.employeeCode || '',
                attendance: attendanceSummary,
                leave: leaveSummary,
                expenses: expenseSummary,
                gross_monthly: Math.round(grossMonthly * 100) / 100,
                total_earnings: Math.round(proRatedEarnings * 100) / 100,
                total_deductions: Math.round(totalActualDeductions * 100) / 100,
                total_benefits: Math.round(totalBenefits * 100) / 100,
                expense_reimbursement: expenseSummary.total_approved,
                net_pay: netPay,
                ctc_monthly: Math.round(ctcMonthly * 100) / 100,
                deduction_for_absences: deductionForAbsences,
                adjustment_for_leaves: 0,
                salary_components: salaryComponents
            });
        }

        console.log('[CalculatePayroll] Total calculations:', calculations.length);
        return callback(null, { success: true, message: 'Payroll calculated successfully', calculations });

    } catch (e) {
        console.error("Calculate Payroll Error:", e);
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};