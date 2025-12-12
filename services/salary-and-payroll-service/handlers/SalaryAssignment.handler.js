import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { calculateSalaryStructure, calculateSalaryStructureDryRun } from "../helper/salaryCalculationEngine.js";

/**
 * ================================================================
 * 1️⃣ ASSIGN SALARY TO EMPLOYEE (FIRST TIME)
 * ================================================================
 */
export const assignSalaryToEmployeeFunc = async (call, callback) => {
    try {
        const {
            employeeId,
            templateId,
            grossAnnual,
            effectiveFrom,
            status,
            isCurrentActive,
            deductFromInHand
        } = call.request;

        if (!employeeId || !templateId || !grossAnnual) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId, templateId & grossAnnual are required"
            });
        }

        // Validate template exists
        const template = await prisma.salaryTemplate.findUnique({
            where: { id: templateId.toString() },
            include: {
                components: {
                    include: { component: true }
                }
            }
        });

        if (!template) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Salary Template not found"
            });
        }

        // Validate employee exists
        const employee = await prisma.organizationEmployees.findUnique({
            where: { id: employeeId.toString() }
        });

        if (!employee) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Employee not found"
            });
        }

        const effectiveFromDate =
            effectiveFrom && !isNaN(new Date(effectiveFrom))
                ? new Date(effectiveFrom)
                : new Date();

        const finalStatus = status || "ACTIVE";
        const finalIsCurrentActive =
            typeof isCurrentActive === "boolean"
                ? isCurrentActive
                : effectiveFromDate <= new Date(new Date().toLocaleDateString());
        const finalDeductFromInHand =
            typeof deductFromInHand === "boolean" ? deductFromInHand : true;

        // 🔥 If setting as current active, deactivate previous structures
        if (finalIsCurrentActive) {
            await prisma.salaryStructure.updateMany({
                where: {
                    employeeId: employeeId.toString(),
                    isCurrentActive: true
                },
                data: {
                    isCurrentActive: false,
                    status: "SUPERSEDED",
                    effectiveTo: effectiveFromDate
                }
            });
        }
        const alreadyAssignedSalary = await prisma.salaryStructure.findFirst({
            where: {
                employeeId: employeeId.toString(),
                deletedAt: null
            },
            orderBy: { createdAt: "desc" }
        })

        // Create the salary structure
        const structure = await prisma.salaryStructure.create({
            data: {
                employeeId: employeeId.toString(),
                templateId: templateId.toString(),
                grossAnnual,
                effectiveFrom: effectiveFromDate,
                status: finalStatus,
                isCurrentActive: finalIsCurrentActive,
                deductFromInHand: finalDeductFromInHand,
                deletedAt: null
            }
        });

        // 🚀 Calculate and populate components automatically
        const computed = await calculateSalaryStructure(structure.id.toString());
        console.log('SalaryAssignment.handler.js @ Line 108:', {
            employeeId: employeeId,
            deletedAt: null
        });
        console.log('SalaryAssignment.handler.js @ Line 108:', alreadyAssignedSalary);
        let revisionReason = 'Initial salary assignment'
        let revisionType = 'INITIAL_ASSIGNMENT'
        if (alreadyAssignedSalary) {
            if (alreadyAssignedSalary.grossAnnual > grossAnnual) {
                revisionType = 'DEMOTION'
                revisionReason = 'Demotion salary revision'
            } else if (alreadyAssignedSalary.grossAnnual < grossAnnual) {
                revisionType = 'PROMOTION'
                revisionReason = 'Promotion salary revision'
            } else {
                revisionType = 'REVISION'
                revisionReason = 'Revision'
            }
        }
        // 📝 Create initial revision record
        await prisma.salaryRevision.create({
            data: {
                revisionType: revisionType,
                revisionDate: new Date(),
                effectiveDate: effectiveFromDate,
                previousGross: 0,
                newGross: grossAnnual,
                changeAmount: grossAnnual,
                changePercent: null,
                structureId: structure.id,
                reason: revisionReason,
                employeeId: employeeId.toString(),
                oldStructureId: alreadyAssignedSalary?.structureId
            }
        });

        return callback(null, {
            success: true,
            message: "Salary assigned successfully with all components",
            structure: computed
        });

    } catch (err) {
        console.error("❌ assignSalaryToEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 2️⃣ UPDATE EMPLOYEE SALARY + REVISION ENTRY
 * ================================================================
 */
export const updateEmployeeSalaryFunc = async (call, callback) => {
    try {
        const {
            structureId,
            newGrossAnnual,
            newTemplateId,
            revisionType,
            reason,
            effectiveDate,
            approvedBy,
            approvalDate,
            status,
            isCurrentActive,
            deductFromInHand,
            componentOverrides // 🔥 NEW: Allow component-level overrides
        } = call.request;

        if (!structureId || !newGrossAnnual) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId & newGrossAnnual are required"
            });
        }

        const structure = await prisma.salaryStructure.findUnique({
            where: { id: structureId.toString() },
            include: {
                components: {
                    include: { component: true }
                }
            }
        });

        if (!structure) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Salary Structure not found"
            });
        }

        const oldGross = Number(structure.grossAnnual) || 0;
        const effectiveDateValue = effectiveDate ? new Date(effectiveDate) : new Date();

        // 🔥 If changing to a new template, validate it
        if (newTemplateId && newTemplateId !== structure.templateId) {
            const template = await prisma.salaryTemplate.findUnique({
                where: { id: newTemplateId.toString() }
            });

            if (!template) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "New template not found"
                });
            }
        }

        // 📝 Create revision entry FIRST
        const revision = await prisma.salaryRevision.create({
            data: {
                revisionType: revisionType || "INCREMENT",
                revisionDate: new Date(),
                effectiveDate: effectiveDateValue,
                previousGross: oldGross,
                newGross: newGrossAnnual,
                changeAmount: newGrossAnnual - oldGross,
                changePercent:
                    oldGross > 0
                        ? ((newGrossAnnual - oldGross) / oldGross) * 100
                        : null,
                reason: reason || "",
                approvedBy: approvedBy || "",
                salaryStructureId: structure.id,
                approvalDate: approvalDate ? new Date(approvalDate) : null,
                employeeId: structure.employeeId.toString(),
                oldStructureId: structure.id.toString()
            }
        });

        // 🚀 Update the salary structure
        const updatedStructure = await prisma.salaryStructure.update({
            where: { id: structure.id.toString() },
            data: {
                grossAnnual: newGrossAnnual,
                templateId: newTemplateId ? newTemplateId.toString() : structure.templateId,
                status: status || structure.status,
                isCurrentActive:
                    typeof isCurrentActive === "boolean"
                        ? isCurrentActive
                        : structure.isCurrentActive,
                deductFromInHand:
                    typeof deductFromInHand === "boolean"
                        ? deductFromInHand
                        : structure.deductFromInHand
            }
        });

        // 🎯 Apply component overrides if provided
        if (componentOverrides && Array.isArray(componentOverrides)) {
            for (const override of componentOverrides) {
                const { componentId, value, formula, isOverridden, overrideNote } = override;

                await prisma.structureComponent.updateMany({
                    where: {
                        structureId: structure.id.toString(),
                        componentId: componentId.toString()
                    },
                    data: {
                        ...(value !== undefined && { value }),
                        ...(formula !== undefined && { formula }),
                        ...(isOverridden !== undefined && { isOverridden }),
                        ...(overrideNote !== undefined && { overrideNote })
                    }
                });
            }
        }

        // 🔥 Recalculate all components with new gross
        const computed = await calculateSalaryStructure(updatedStructure.id.toString());

        return callback(null, {
            success: true,
            message: "Salary updated successfully with revision tracking",
            structure: computed,
            revision: {
                id: revision.id.toString(),
                changeAmount: revision.changeAmount,
                changePercent: revision.changePercent
            }
        });

    } catch (err) {
        console.error("❌ updateEmployeeSalary FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 3️⃣ APPLY TEMPLATE TO STRUCTURE
 * ================================================================
 */
export const applyTemplateToStructureFunc = async (call, callback) => {
    try {
        const { structureId, templateId } = call.request;

        if (!structureId || !templateId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId & templateId are required"
            });
        }

        const structure = await prisma.salaryStructure.findUnique({
            where: { id: structureId.toString() }
        });

        if (!structure) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Salary Structure not found"
            });
        }

        const template = await prisma.salaryTemplate.findUnique({
            where: { id: templateId.toString() },
            include: {
                components: {
                    include: { component: true }
                }
            }
        });

        if (!template) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Template not found"
            });
        }

        // Update template reference
        await prisma.salaryStructure.update({
            where: { id: structureId.toString() },
            data: {
                templateId: templateId.toString()
            }
        });

        // 🔥 Recalculate will auto-populate components from new template
        const computed = await calculateSalaryStructure(structureId.toString());

        return callback(null, {
            success: true,
            message: `Template applied successfully. ${computed.components.length} components configured.`,
            structure: computed
        });

    } catch (err) {
        console.error("❌ applyTemplateToStructure FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 4️⃣ RE-CALCULATE STRUCTURE
 * ================================================================
 */
export const recalculateStructureFunc = async (call, callback) => {
    try {
        const { structureId } = call.request;

        if (!structureId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId is required"
            });
        }

        const computed = await calculateSalaryStructure(structureId.toString());

        return callback(null, {
            success: true,
            message: "Structure recalculated successfully",
            structure: computed
        });

    } catch (err) {
        console.error("❌ recalculateStructure FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 5️⃣ GET CURRENT ACTIVE STRUCTURE
 * ================================================================
 */
export const getCurrentStructureForEmployeeFunc = async (call, callback) => {
    try {
        const { employeeId } = call.request;

        if (!employeeId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId is required"
            });
        }

        const structure = await prisma.salaryStructure.findFirst({
            where: {
                employeeId: employeeId.toString(),
                isCurrentActive: true,
                status: "ACTIVE"
            },
            orderBy: { effectiveFrom: "desc" }
        });

        if (!structure) {
            return callback(null, {
                success: true,
                message: "No active salary structure found",
                structure: null
            });
        }

        const computed = await calculateSalaryStructure(structure.id.toString());

        return callback(null, {
            success: true,
            message: "Employee salary structure fetched successfully",
            structure: computed
        });

    } catch (err) {
        console.error("❌ getCurrentStructureForEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

/**
 * ================================================================
 * 5️⃣ GET STRUCTURE BY ID
 * ================================================================
 */
export const getStructureByForEmployeeFunc = async (call, callback) => {
    try {
        const { employeeId, structureId } = call.request;

        if (!employeeId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId is required"
            });
        }

        const structure = await prisma.salaryStructure.findFirst({
            where: {
                id: structureId,
            },
            orderBy: { effectiveFrom: "desc" }
        });

        if (!structure) {
            return callback(null, {
                success: true,
                message: "No structure found",
                structure: null
            });
        }

        const computed = await calculateSalaryStructure(structure.id.toString());

        return callback(null, {
            success: true,
            message: "Employee salary structure fetched successfully",
            structure: computed
        });

    } catch (err) {
        console.error("❌ getCurrentStructureForEmployee FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 6️⃣ GET SALARY REVISION HISTORY
 * ================================================================
 */
export const getSalaryRevisionHistoryFunc = async (call, callback) => {
    try {
        const { employeeId, limit = 10 } = call.request;

        if (!employeeId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeId is required"
            });
        }

        const revisions = await prisma.salaryRevision.findMany({
            where: {
                employeeId: employeeId.toString()
            },
            orderBy: { revisionDate: 'desc' },
            take: limit,
            include: {
                structure: {
                    select: {
                        id: true,
                        grossAnnual: true,
                        effectiveFrom: true,
                        effectiveTo: true,
                        status: true,
                        isCurrentActive: true,
                    }
                },
                oldStructure: true
            }
        });

        return callback(null, {
            success: true,
            message: `Found ${revisions.length} revision records`,
            revisions: revisions.map(r => ({
                id: r.id.toString(),
                revisionType: r.revisionType,
                revisionDate: r.revisionDate.toISOString(),
                effectiveDate: r.effectiveDate.toISOString(),
                previousGross: r.previousGross,
                newGross: r.newGross,
                changeAmount: r.changeAmount,
                changePercent: r.changePercent,
                reason: r.reason || "",
                approvedBy: r.approvedBy || "",
                approvalDate: r.approvalDate?.toISOString() || "",
                structure: r.structure,
            }))
        });

    } catch (err) {
        console.error("❌ getSalaryRevisionHistory FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 7️⃣ OVERRIDE SPECIFIC COMPONENT
 * ================================================================
 */
export const overrideComponentFunc = async (call, callback) => {
    try {
        const {
            structureId,
            componentId,
            value,
            formula,
            overrideNote
        } = call.request;

        if (!structureId || !componentId) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "structureId & componentId are required"
            });
        }

        // Find or create the component
        let structureComponent = await prisma.structureComponent.findFirst({
            where: {
                structureId: structureId.toString(),
                componentId: componentId.toString()
            }
        });

        if (!structureComponent) {
            // Component doesn't exist yet, create it
            const component = await prisma.componentDefinition.findUnique({
                where: { id: componentId.toString() }
            });

            if (!component) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Component definition not found"
                });
            }

            structureComponent = await prisma.structureComponent.create({
                data: {
                    structureId: structureId.toString(),
                    componentId: componentId.toString(),
                    value,
                    formula,
                    annualAmount: value || 0,
                    monthlyAmount: value ? (value / 12) : 0,
                    isOverridden: true,
                    overrideNote: overrideNote || "Manual override"
                }
            });
        } else {
            // Update existing component
            await prisma.structureComponent.update({
                where: { id: structureComponent.id.toString() },
                data: {
                    value,
                    formula,
                    isOverridden: true,
                    overrideNote: overrideNote || "Manual override"
                }
            });
        }

        // Recalculate to update totals
        const computed = await calculateSalaryStructure(structureId.toString());

        return callback(null, {
            success: true,
            message: "Component overridden successfully",
            structure: computed
        });

    } catch (err) {
        console.error("❌ overrideComponent FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};

export const bulkRecalculateFunc = async (call, callback) => {
    try {
        const { employeeIds } = call.request;

        if (!employeeIds || employeeIds.length === 0) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "employeeIds array is required"
            });
        }

        const { results, errors } = await bulkRecalculateStructures(employeeIds);

        return callback(null, {
            success: true,
            message: `Processed ${results.length + errors.length} employees`,
            results: [
                ...results.map(r => ({
                    employeeId: r.employeeId,
                    structureId: r.structureId,
                    success: true,
                    error: ""
                })),
                ...errors.map(e => ({
                    employeeId: e.employeeId,
                    structureId: "",
                    success: false,
                    error: e.error
                }))
            ],
            successCount: results.length,
            errorCount: errors.length
        });

    } catch (err) {
        console.error("❌ bulkRecalculate FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};


/**
 * ================================================================
 * 🔥 PREVIEW TEMPLATE CALCULATION (NO DB WRITE)
 * ================================================================
 */
export const previewTemplateCalculationFunc = async (call, callback) => {
    try {
        const { templateId, grossAnnual } = call.request;

        if (!templateId || !grossAnnual) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "templateId & grossAnnual are required"
            });
        }

        // 🔥 Run DRY-RUN calculation (NO DB interactions)
        const computed = await calculateSalaryStructureDryRun(templateId, grossAnnual);

        return callback(null, {
            success: true,
            message: "Preview calculation completed using template",
            structure: computed
        });

    } catch (err) {
        console.error("❌ previewTemplateCalculation FAILED:", err);
        return callback({ code: grpc.status.INTERNAL, message: err.message });
    }
};
