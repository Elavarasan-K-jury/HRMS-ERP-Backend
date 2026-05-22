// salary-and-payroll-service/handlers/SalaryAssignment.handler.js

import { grpc } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";
import {
    calculateSalaryStructure,
    calculateSalaryStructureDryRun,
    bulkRecalculateStructures,
} from "../helper/salaryCalculationEngine.js";

/* ============================================================
   🔐 COMMON HELPERS
============================================================ */

async function assertFinanceEnabledByEmployee(employeeId, callback) {
    const emp = await prisma.organizationEmployees.findUnique({
        where: { id: employeeId },
        select: { organizationId: true },
    });

    if (!emp) {
        callback({ code: grpc.status.NOT_FOUND, message: "Employee not found" });
        return null;
    }

    const finance = await prisma.orgaizationFinance.findFirst({
        where: { organizationId: emp.organizationId, deletedAt: null },
        select: { id: true },
    });

    if (!finance) {
        callback({
            code: grpc.status.PERMISSION_DENIED,
            message: "Finance is not enabled for this organization",
        });
        return null;
    }

    return emp.organizationId;
}

function matchesAnyRange(ranges, gross) {
    return ranges.some(r => {
        const low = Number(r.grossLow ?? 0);
        const high = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        return gross >= low && gross <= high;
    });
}

/* ============================================================
   1️⃣ ASSIGN SALARY (FIRST TIME)
============================================================ */

export const assignSalaryToEmployeeFunc = async (call, callback) => {
    try {
        const {
            employeeId,
            templateId,
            grossAnnual,
            effectiveFrom,
            status = "ACTIVE",
            isCurrentActive,
            deductFromInHand = true,
        } = call.request;

        if (!employeeId || !templateId || !grossAnnual) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId, templateId & grossAnnual are required",
            });
        }

        const organizationId = await assertFinanceEnabledByEmployee(employeeId, callback);
        if (!organizationId) return;

        const template = await prisma.salaryTemplate.findUnique({
            where: { id: templateId },
        });
        if (!template) {
            return callback({ code: grpc.status.NOT_FOUND, message: "Template not found" });
        }

        const ranges = await prisma.salaryTemplateRange.findMany({
            where: { templateId, deletedAt: null },
        });

        if (!matchesAnyRange(ranges, Number(grossAnnual))) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Gross does not match any salary range in the template",
            });
        }

        const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date();
        const makeActive =
            typeof isCurrentActive === "boolean"
                ? isCurrentActive
                : effectiveDate <= new Date();

        let previous = null;

        if (makeActive) {
            previous = await prisma.salaryRevision.findFirst({
                where: {
                    employeeId,
                    structure: {
                        isCurrentActive: true,
                    },
                },
                orderBy: { effectiveDate: "desc" },
            });

            console.log('SalaryAssignment.handler.js @ Line 113:', previous);

            await prisma.salaryStructure.updateMany({
                where: {
                    employeeId,
                    isCurrentActive: true,
                },
                data: {
                    isCurrentActive: false,
                    status: "SUPERSEDED",
                    effectiveTo: effectiveDate,
                },
            });
        }

        console.log('SalaryAssignment.handler.js @ Line 128:', previous);


        const structure = await prisma.salaryStructure.create({
            data: {
                employeeId,
                templateId,
                grossAnnual: Number(grossAnnual),
                effectiveFrom: effectiveDate,
                status,
                isCurrentActive: makeActive,
                deductFromInHand,
            },
        });

        const computed = await calculateSalaryStructure(structure.id, true);

        let revisionType = "INITIAL_ASSIGNMENT";
        let reason = "Initial salary assignment";
        if (previous) {
            if (previous.newGross < grossAnnual) {
                revisionType = "PROMOTION";
                reason = "Promotion salary revision";
            } else if (previous.newGross > grossAnnual) {
                revisionType = "DEMOTION";
                reason = "Demotion salary revision";
            } else {
                revisionType = "REVISION";
                reason = "Salary revision";
            }
        }

        console.log('SalaryAssignment.handler.js @ Line 157:', computed);

        await prisma.salaryRevision.create({
            data: {
                revisionType,
                revisionDate: new Date(),
                effectiveDate,
                previousGross: Number(previous?.grossAnnual || 0),
                newGross: Number(computed.grossAnnual),
                changeAmount: Number(computed.grossAnnual) - Number(previous?.grossAnnual || 0),
                changePercent:
                    previous?.grossAnnual
                        ? ((computed.grossAnnual - previous.grossAnnual) / previous.grossAnnual) * 100
                        : null,
                structureId: structure.id,
                employeeId,
                reason,
                oldStructureId: previous?.id || null,
            },
        });

        return callback(null, {
            success: true,
            message: "Salary assigned successfully",
            structure: computed,
        });

    } catch (err) {
        console.error("❌ assignSalaryToEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   2️⃣ UPDATE SALARY
============================================================ */

export const updateEmployeeSalaryFunc = async (call, callback) => {
    try {
        const {
            structureId,
            newGrossAnnual,
            newTemplateId,
            revisionType,
            reason,
            effectiveDate,
            componentOverrides = [],
        } = call.request;

        if (!structureId || newGrossAnnual == null) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId & newGrossAnnual are required",
            });
        }

        const structure = await prisma.salaryStructure.findUnique({
            where: { id: structureId },
        });
        if (!structure) {
            return callback({ code: grpc.status.NOT_FOUND, message: "Structure not found" });
        }

        await assertFinanceEnabledByEmployee(structure.employeeId, callback);

        const nextGross = Number(newGrossAnnual);
        const oldGross = Number(structure.grossAnnual);

        if (nextGross === oldGross) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "No salary change detected",
            });
        }

        if (newTemplateId && newTemplateId !== structure.templateId) {
            const ranges = await prisma.salaryTemplateRange.findMany({
                where: { templateId: newTemplateId, deletedAt: null },
            });

            if (!matchesAnyRange(ranges, nextGross)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Gross does not match new template ranges",
                });
            }
        }

        const effDate = effectiveDate ? new Date(effectiveDate) : new Date();

        await prisma.salaryRevision.create({
            data: {
                revisionType: revisionType || (nextGross > oldGross ? "INCREMENT" : "REVISION"),
                revisionDate: new Date(),
                effectiveDate: effDate,
                previousGross: oldGross,
                newGross: nextGross,
                changeAmount: nextGross - oldGross,
                changePercent: oldGross ? ((nextGross - oldGross) / oldGross) * 100 : null,
                employeeId: structure.employeeId,
                structureId,
                reason: reason || "",
                oldStructureId: structureId,
            },
        });

        await prisma.salaryStructure.update({
            where: { id: structureId },
            data: {
                grossAnnual: nextGross,
                templateId: newTemplateId || structure.templateId,
                updatedAt: new Date(),
            },
        });

        if (componentOverrides.length) {
            for (const o of componentOverrides) {
                await prisma.structureComponent.updateMany({
                    where: {
                        structureId,
                        componentId: o.componentId,
                        deletedAt: null,
                    },
                    data: {
                        ...(o.value !== undefined && { value: Number(o.value) }),
                        ...(o.formula !== undefined && { formula: o.formula }),
                        isOverridden: true,
                        overrideNote: o.overrideNote || "Manual override",
                    },
                });
            }
        }

        const computed = await calculateSalaryStructure(structureId);

        return callback(null, {
            success: true,
            message: "Salary updated successfully",
            structure: computed,
        });

    } catch (err) {
        console.error("❌ updateEmployeeSalary FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   3️⃣ APPLY TEMPLATE
============================================================ */

export const applyTemplateToStructureFunc = async (call, callback) => {
    try {
        const { structureId, templateId } = call.request;

        const structure = await prisma.salaryStructure.findUnique({
            where: { id: structureId },
        });
        if (!structure) {
            return callback({ code: grpc.status.NOT_FOUND, message: "Structure not found" });
        }

        const ranges = await prisma.salaryTemplateRange.findMany({
            where: { templateId, deletedAt: null },
        });

        if (!matchesAnyRange(ranges, Number(structure.grossAnnual))) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Current gross does not match new template ranges",
            });
        }

        await prisma.salaryStructure.update({
            where: { id: structureId },
            data: { templateId },
        });

        const computed = await calculateSalaryStructure(structureId);

        return callback(null, {
            success: true,
            message: "Template applied successfully",
            structure: computed,
        });

    } catch (err) {
        console.error("❌ applyTemplateToStructure FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   4️⃣ RE-CALCULATE
============================================================ */

export const recalculateStructureFunc = async (call, callback) => {
    try {
        const { structureId } = call.request;
        const computed = await calculateSalaryStructure(structureId);
        return callback(null, { success: true, structure: computed });
    } catch (err) {
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   5️⃣ PREVIEW (DRY RUN)
============================================================ */

export const previewTemplateCalculationFunc = async (call, callback) => {
    try {
        const { templateId, grossAnnual } = call.request;
        const computed = await calculateSalaryStructureDryRun(templateId, Number(grossAnnual));

        console.log('SalaryAssignment.handler.js @ Line 369:', computed);
        return callback(null, { success: true, structure: { ...computed, ...computed.totals }, });
    } catch (err) {
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   6️⃣ BULK RECALC
============================================================ */

export const bulkRecalculateFunc = async (call, callback) => {
    const { results, errors } = await bulkRecalculateStructures(call.request.employeeIds);
    return callback(null, {
        success: true,
        results,
        errors,
        successCount: results.length,
        errorCount: errors.length,
    });
};

/* ============================================================
   5️⃣ GET CURRENT ACTIVE STRUCTURE
============================================================ */
export const getCurrentStructureForEmployeeFunc = async (call, callback) => {
    try {
        const { employeeId } = call.request;

        if (!employeeId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId is required",
            });
        }

        const structure = await prisma.salaryStructure.findFirst({
            where: {
                employeeId,
                deletedAt: null,
                isCurrentActive: true,
                status: "ACTIVE",
            },
            orderBy: { effectiveFrom: "desc" },
        });

        if (!structure) {
            return callback(null, {
                success: true,
                message: "No active salary structure found",
                structure: null,
            });
        }

        const computed = await calculateSalaryStructure(structure.id);

        return callback(null, {
            success: true,
            message: "Employee salary structure fetched successfully",
            structure: computed,
        });
    } catch (err) {
        console.error("❌ getCurrentStructureForEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   6️⃣ GET STRUCTURE BY ID (EMPLOYEE VIEW)
============================================================ */
export const getStructureByForEmployeeFunc = async (call, callback) => {
    try {
        const { employeeId, structureId } = call.request;

        console.log('SalaryAssignment.handler.js @ Line 443:', employeeId, structureId);

        if (!employeeId || !structureId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId & structureId are required",
            });
        }

        const structure = await prisma.salaryStructure.findFirst({
            where: {
                id: structureId,
                employeeId,
                // deletedAt: null,
            },
        });

        if (!structure) {
            return callback(null, {
                success: true,
                message: "No structure found",
                structure: null,
            });
        }

        console.log('SalaryAssignment.handler.js @ Line 466:', structure);

        const computed = await calculateSalaryStructure(structure.id);

        return callback(null, {
            success: true,
            message: "Employee salary structure fetched successfully",
            structure: computed,
        });
    } catch (err) {
        console.error("❌ getStructureByForEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   7️⃣ SALARY REVISION HISTORY
============================================================ */
export const getSalaryRevisionHistoryFunc = async (call, callback) => {
    try {
        const { employeeId, limit = 10 } = call.request;

        if (!employeeId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId is required",
            });
        }

        const revisions = await prisma.salaryRevision.findMany({
            where: { employeeId },
            orderBy: { revisionDate: "desc" },
            take: Number(limit),
            include: {
                structure: {
                    select: {
                        id: true,
                        grossAnnual: true,
                        effectiveFrom: true,
                        effectiveTo: true,
                        status: true,
                        isCurrentActive: true,
                    },
                },
            },
        });

        return callback(null, {
            success: true,
            message: `Found ${revisions.length} revision records`,
            revisions: revisions.map(r => ({
                id: r.id,
                revisionType: r.revisionType,
                revisionDate: r.revisionDate?.toISOString(),
                effectiveDate: r.effectiveDate?.toISOString(),
                previousGross: r.previousGross,
                newGross: r.newGross,
                changeAmount: r.changeAmount,
                changePercent: r.changePercent,
                reason: r.reason || "",
                approvedBy: r.approvedBy || "",
                approvalDate: r.approvalDate?.toISOString() || "",
                structure: r.structure,
            })),
        });
    } catch (err) {
        console.error("❌ getSalaryRevisionHistory FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/* ============================================================
   8️⃣ OVERRIDE COMPONENT
============================================================ */
export const overrideComponentFunc = async (call, callback) => {
    try {
        const { structureId, componentId, value, formula, overrideNote } = call.request;

        if (!structureId || !componentId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId & componentId are required",
            });
        }

        await prisma.structureComponent.updateMany({
            where: {
                structureId,
                componentId,
                deletedAt: null,
            },
            data: {
                ...(value !== undefined && { value: Number(value) }),
                ...(formula !== undefined && { formula }),
                isOverridden: true,
                overrideNote: overrideNote || "Manual override",
                updatedAt: new Date(),
            },
        });

        const computed = await calculateSalaryStructure(structureId);

        return callback(null, {
            success: true,
            message: "Component overridden successfully",
            structure: computed,
        });
    } catch (err) {
        console.error("❌ overrideComponent FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

