import { prisma } from "@jury-hrms/db/client.js";
import { calculateSalary } from "./calculator.js";

/* ============================================================
   UTILS
============================================================ */
function pickRange(ranges, gross) {
    const g = Number(gross);
    return ranges.find(r => {
        const low = Number(r.grossLow ?? 0);
        const high = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        return g >= low && g <= high;
    });
}

/* ============================================================
   LOAD FINANCE FLAGS
============================================================ */
async function loadFinanceConfig(organizationId) {
    const finance = await prisma.orgaizationFinance.findFirst({
        where: { organizationId, deletedAt: null },
    });

    return {
        enablePf: finance?.enablePf ?? false,
        enableEsi: finance?.enableEsi ?? false,
        enablePtax: finance?.enablePtax ?? false,
        pfFormula: finance?.pfFormula,
        esiFormula: finance?.esiFormula,
        ptaxFormula: finance?.ptaxFormula,
    };
}

/* ============================================================
   NORMALIZE TEMPLATE COMPONENTS
============================================================ */
function normalizeTemplateComponents(components) {
    return components.map(tc => ({
        componentId: tc.componentId,
        componentKey: tc.component.key,
        componentName: tc.component.name,
        kind: tc.component.type,
        priority: tc.priority,
        value: tc.value,
        formula: tc.formula || tc.component.defaultFormula,
        minValue: tc.minValue,
        maxValue: tc.maxValue,
        condition: tc.condition,
    }));
}

/* ============================================================
   1️⃣ CALCULATE SALARY STRUCTURE (DB WRITE)
============================================================ */
export async function calculateSalaryStructure(structureId) {

    const structure = await prisma.salaryStructure.findUnique({
        where: { id: structureId },
        include: {
            employee: true,
            template: true,
        },
    });

    // console.log('salaryCalculationEngine.js @ Line 65:', structure);

    if (!structure) throw new Error("Salary structure not found");

    const grossAnnual = Number(structure.grossAnnual);
    const grossMonthly = grossAnnual / 12;

    /* ---------------- PICK RANGE ---------------- */
    const ranges = await prisma.salaryTemplateRange.findMany({
        where: {
            templateId: structure.templateId,
            deletedAt: null,
        },
        orderBy: { grossLow: "asc" },
    });

    const range = pickRange(ranges, grossAnnual);
    if (!range) throw new Error("No matching salary range found");

    /* ---------------- LOAD RANGE COMPONENTS ---------------- */
    const templateComponents = await prisma.templateComponent.findMany({
        where: {
            templateId: structure.templateId,
            rangeId: range.id,
            deletedAt: null,
        },
        include: { component: true },
        orderBy: { priority: "asc" },
    });

    /* ---------------- LOAD FINANCE CONFIG ---------------- */
    const finance = await loadFinanceConfig(structure.employee.organizationId);

    /* ---------------- SPLIT COMPONENTS ---------------- */
    const earnings = templateComponents.filter(c => c.kind?.toUpperCase() === "EARNING" || c.component?.type?.toUpperCase() === "EARNING");
    const employeeDeductions = templateComponents.filter(c => c.kind?.toUpperCase() === "EMPLOYEE" || c.component?.type?.toUpperCase() === "EMPLOYEE");
    const employerContribs = templateComponents.filter(c => c.kind?.toUpperCase() === "EMPLOYER" || c.component?.type?.toUpperCase() === "EMPLOYER");

    /* ---------------- CALCULATE GROSS (100%) ---------------- */
    const earningResult = calculateSalary({
        baseInput: { gross: grossMonthly },
        components: normalizeTemplateComponents(earnings),
    });

    // console.log('salaryCalculationEngine.js @ Line 113:', earningResult);


    const grossComputed = earningResult.totals.totalEarnings;

    /* ---------------- APPLY FINANCE (OUTSIDE GROSS) ---------------- */
    const deductionResult = finance.enablePf || finance.enableEsi || finance.enablePtax
        ? calculateSalary({
            baseInput: { gross: grossComputed },
            components: normalizeTemplateComponents(employeeDeductions),
        })
        : { components: [], totals: { totalDeductions: 0 } };

    const employerResult = finance.enablePf || finance.enableEsi
        ? calculateSalary({
            baseInput: { gross: grossComputed },
            components: normalizeTemplateComponents(employerContribs),
        })
        : { components: [], totals: { totalEmployer: 0 } };


    /* ---------------- FINAL TOTALS ---------------- */
    const totalEarnings = earningResult.totals.totalEarnings || 0;
    const totalDeductions = deductionResult.totals.totalDeductions || 0;
    const totalEmployer = employerResult.totals.totalEmployer || 0;

    const inHandMonthly = totalEarnings - totalDeductions;
    const ctcMonthly = totalEarnings + totalEmployer;

    /* ---------------- PERSIST STRUCTURE COMPONENTS ---------------- */
    await prisma.structureComponent.deleteMany({
        where: { structureId },
    });

    const allComponents = [
        ...earningResult.components,
        ...deductionResult.components,
        ...employerResult.components,
    ];

    // console.log('salaryCalculationEngine.js @ Line 145:', allComponents);

    // await prisma.structureComponent.createMany({
    //     data: allComponents.map(c => ({
    //         structureId,
    //         componentId: c.componentId,
    //         value: c.value,
    //         formula: c.formula || null,
    //         annualAmount: c.annualAmount,
    //         monthlyAmount: c.monthlyAmount,
    //         isOverridden: false,
    //     })),
    // });

    /* ---------------- UPDATE STRUCTURE TOTALS ---------------- */
    // await prisma.salaryStructure.update({
    //     where: { id: structureId },
    //     data: {
    //         totalEarnings,
    //         totalDeductions,
    //         totalBenefits: totalEmployer,
    //         inHandAnnual: inHandMonthly * 12,
    //         inHandMonthly,
    //         updatedAt: new Date(),
    //     },
    // });

    return {
        ...structure,
        structureId,
        templateId: structure.templateId,
        rangeId: range.id,
        grossAnnual,
        grossMonthly,
        totals: {
            totalEarnings,
            totalDeductions,
            totalEmployer,
            inHandMonthly,
            ctcMonthly,
        },
        components: allComponents,
    };
}

/* ============================================================
   2️⃣ DRY RUN (PREVIEW)
============================================================ */
export async function calculateSalaryStructureDryRun(templateId, grossAnnual) {
    const ranges = await prisma.salaryTemplateRange.findMany({
        where: { templateId, deletedAt: null },
        orderBy: { grossLow: "asc" },
    });

    const range = pickRange(ranges, grossAnnual);
    if (!range) throw new Error("No matching range");

    const components = await prisma.templateComponent.findMany({
        where: {
            templateId,
            rangeId: range.id,
            deletedAt: null,
        },
        include: { component: true },
        orderBy: { priority: "asc" },
    });


    return await calculateSalary({
        baseInput: { gross: grossAnnual / 12 },
        components: normalizeTemplateComponents(components),
    });
}

/* ============================================================
   3️⃣ BULK RECALCULATE
============================================================ */
export async function bulkRecalculateStructures(employeeIds) {
    const results = [];
    const errors = [];

    for (const employeeId of employeeIds) {
        try {
            const structure = await prisma.salaryStructure.findFirst({
                where: {
                    employeeId,
                    isCurrentActive: true,
                    deletedAt: null,
                },
            });

            if (!structure) throw new Error("No active structure");

            await calculateSalaryStructure(structure.id);
            results.push({ employeeId, structureId: structure.id });

        } catch (e) {
            errors.push({ employeeId, error: e.message });
        }
    }

    return { results, errors };
}
