// src/services/salary/salaryCalculationEngine.js
import { PrismaClient } from "@prisma/client";
import { create, all } from "mathjs";

const prisma = new PrismaClient();

// ============================================================
// MATHJS SAFE SANDBOX
// ============================================================
const math = create(all, {});
math.import(
    {
        import: () => { throw new Error("import() disabled"); },
        createUnit: () => { throw new Error("createUnit() disabled"); },
        evaluate: () => { throw new Error("evaluate() disabled"); }
    },
    { override: true }
);

// ============================================================
// SAFE NUMBER HANDLER
// ============================================================
function toSafeNumber(val) {
    try {
        if (val === null || val === undefined) return 0;
        if (typeof val === "number") return val;
        if (typeof val === "bigint") return Number(val);
        if (typeof val === "string") return Number(val);
        if (typeof val === "object" && val.toNumber) return val.toNumber();
        return Number(val);
    } catch {
        return 0;
    }
}

// ============================================================
// SAFE DATE FORMATTER
// ============================================================
function safeDate(date) {
    try {
        if (!date) return "";
        return date instanceof Date ? date.toISOString() : "";
    } catch {
        return "";
    }
}

// ============================================================
// SAFE FORMULA EVALUATION
// ============================================================
function evaluateFormula(formula, context) {
    try {
        if (!formula || !formula.trim()) return 0;

        const node = math.parse(formula);
        return toSafeNumber(node.evaluate(context));
    } catch (err) {
        console.error("❌ Formula Error:", { formula, context, err });
        return 0;
    }
}

// ============================================================
// MAIN ENGINE - FIXED VERSION
// ============================================================
export async function calculateSalaryStructure(structureId) {
    try {
        console.log("🚀 Starting calculation for structure:", structureId);

        // 1️⃣ FETCH STRUCTURE WITH PROPER INCLUDES
        const structure = await prisma.salaryStructure.findUnique({
            where: { id: structureId.toString() },
            include: {
                template: {
                    include: {
                        components: {
                            include: {
                                component: true
                            },
                            orderBy: { priority: 'asc' }
                        }
                    }
                },
                components: {
                    include: { component: true }
                }
            }
        });

        if (!structure) {
            throw new Error(`SalaryStructure with id ${structureId} not found`);
        }

        console.log("📊 Found structure with template:", structure.templateId);
        console.log("📦 Template has components:", structure.template?.components?.length || 0);

        // 2️⃣ VALIDATION - Template must exist and have components
        if (!structure.template) {
            throw new Error("Salary template not found for this structure");
        }

        // 🔥 FILTER OUT SOFT-DELETED & INACTIVE COMPONENTS (can't do in Prisma query)
        const templateComponents = (structure.template.components || [])
            .filter(tc => !tc.deletedAt && tc.component && tc.component.isActive && !tc.component.deletedAt);

        if (templateComponents.length === 0) {
            console.warn("⚠️ Template has no active components defined");
        }

        const existingComponents = (structure.components || [])
            .filter(sc => !sc.deletedAt);

        // 3️⃣ INITIAL EVALUATION CONTEXT
        const context = {
            gross: toSafeNumber(structure.grossAnnual),
            grossAnnual: toSafeNumber(structure.grossAnnual),
            ctc: toSafeNumber(structure.grossAnnual)
        };

        console.log("💰 Starting context:", context);

        const processedComponentIds = new Set();
        const resultRows = [];

        let totalEarnings = 0;
        let totalDeductions = 0;
        let totalBenefits = 0;

        // ============================================================
        // PROCESS COMPONENT FUNCTION
        // ============================================================
        const processComponent = (componentDef, templateComp = null, existingSC = null) => {
            // Validate component definition
            if (!componentDef) {
                console.warn("⚠️ Skipping: No component definition");
                return;
            }

            if (!componentDef.isActive) {
                console.log(`⏭️ Skipping inactive component: ${componentDef.name}`);
                return;
            }

            const componentId = componentDef.id.toString();

            // Check if already processed
            if (processedComponentIds.has(componentId)) {
                console.log(`⏭️ Already processed: ${componentDef.name}`);
                return;
            }

            console.log(`\n🔧 Processing: ${componentDef.name} (${componentDef.key})`);

            // 🔥 CHECK CONDITION (if defined in template)
            if (templateComp?.condition) {
                const conditionMet = !!evaluateFormula(templateComp.condition, context);
                console.log(`  📝 Condition check: "${templateComp.condition}" = ${conditionMet}`);
                if (!conditionMet) {
                    console.log(`  ⏭️ Skipping: Condition not met`);
                    return;
                }
            }

            // 🔥 DETERMINE OVERRIDE STATUS
            const isOverridden = existingSC?.isOverridden ?? false;
            const overrideNote = existingSC?.overrideNote ?? "";

            // 🔥 PRIORITY: existingStructureComponent value > templateComponent value > formula
            let finalValue = null;
            let finalFormula = null;
            let calculationSource = "default";

            // First, check for fixed value (highest priority)
            // 1️⃣ Highest priority — Structure override value
            if (existingSC?.value !== null && existingSC?.value !== undefined) {
                finalValue = toSafeNumber(existingSC.value);
                calculationSource = "structure_value";
            }

            // 2️⃣ Template fixed value — ONLY when non-zero
            else if (templateComp?.value !== null &&
                templateComp?.value !== undefined &&
                templateComp.value !== 0) {

                finalValue = toSafeNumber(templateComp.value);
                calculationSource = "template_value";
            }

            // 3️⃣ No fixed value → use formula always
            else {
                finalFormula = existingSC?.formula ||
                    templateComp?.formula ||
                    componentDef.defaultFormula ||
                    null;

                if (finalFormula) {
                    finalValue = evaluateFormula(finalFormula, context);
                    calculationSource = "formula";
                } else {
                    finalValue = 0;
                    calculationSource = "zero_default";
                }
            }


            console.log(`  💡 Calculation source: ${calculationSource}`);
            console.log(`  🔢 Raw value: ${finalValue}`);

            // 🔥 APPLY MIN/MAX CONSTRAINTS (from template)
            if (templateComp) {
                if (templateComp.minValue !== null && finalValue < templateComp.minValue) {
                    console.log(`  ⬆️ Applied min value: ${templateComp.minValue}`);
                    finalValue = templateComp.minValue;
                }
                if (templateComp.maxValue !== null && finalValue > templateComp.maxValue) {
                    console.log(`  ⬇️ Applied max value: ${templateComp.maxValue}`);
                    finalValue = templateComp.maxValue;
                }
            }

            const annual = toSafeNumber(finalValue);
            const monthly = toSafeNumber((annual / 12).toFixed(2));

            console.log(`  💵 Final amounts - Annual: ${annual}, Monthly: ${monthly}`);

            // 🔥 UPDATE CONTEXT for dependent calculations
            if (componentDef.key) {
                context[componentDef.key] = annual;
                console.log(`  📌 Set context[${componentDef.key}] = ${annual}`);
            }

            // 🔥 CATEGORIZE INTO BUCKETS
            const componentType = (componentDef.type || "").toLowerCase();
            switch (componentType) {
                case "earning":
                    totalEarnings += annual;
                    console.log(`  ✅ Added to earnings: ${annual}`);
                    break;
                case "deduction":
                    totalDeductions += annual;
                    console.log(`  ➖ Added to deductions: ${annual}`);
                    break;
                case "benefit":
                case "reimbursement":
                    totalBenefits += annual;
                    console.log(`  🎁 Added to benefits: ${annual}`);
                    break;
                default:
                    console.log(`  ⚠️ Unknown type: ${componentType}`);
            }

            // 🔥 BUILD COMPONENT RECORD
            resultRows.push({
                structureId: structure.id.toString(),
                componentId: componentId,
                formula: finalFormula || "",
                value: (calculationSource.includes("value")) ? finalValue : null,
                annualAmount: annual,
                monthlyAmount: monthly,
                isOverridden,
                overrideNote
            });

            processedComponentIds.add(componentId);
            console.log(`  ✅ Component processed successfully`);
        };

        // ============================================================
        // PROCESS TEMPLATE COMPONENTS IN PRIORITY ORDER
        // ============================================================
        console.log("\n📋 Processing template components...");

        for (const tc of templateComponents) {
            const componentDef = tc.component;

            if (!componentDef) {
                console.warn(`⚠️ Template component ${tc.id} has no component definition`);
                continue;
            }

            // Find existing structure component for this component
            const existingSC = existingComponents.find(
                (sc) => sc.componentId.toString() === tc.componentId.toString()
            );

            processComponent(componentDef, tc, existingSC);
        }

        // ============================================================
        // PROCESS STRUCTURE-ONLY COMPONENTS (manually added)
        // ============================================================
        console.log("\n📋 Checking for structure-only components...");

        for (const sc of existingComponents) {
            const componentId = sc.componentId.toString();

            if (processedComponentIds.has(componentId)) {
                console.log(`⏭️ Already processed: ${componentId}`);
                continue;
            }

            console.log(`🔧 Processing structure-only component: ${componentId}`);
            processComponent(sc.component, null, sc);
        }

        console.log("\n📊 CALCULATION SUMMARY:");
        console.log(`  Components processed: ${resultRows.length}`);
        console.log(`  Total Earnings: ${totalEarnings}`);
        console.log(`  Total Deductions: ${totalDeductions}`);
        console.log(`  Total Benefits: ${totalBenefits}`);

        // ============================================================
        // WRITE TO DATABASE
        // ============================================================
        console.log("\n💾 Writing to database...");

        // Delete existing components
        const deletedCount = await prisma.structureComponent.deleteMany({
            where: { structureId: structure.id.toString() }
        });
        console.log(`  🗑️ Deleted ${deletedCount.count} existing components`);

        // Create new components
        if (resultRows.length > 0) {
            const created = await prisma.structureComponent.createMany({
                data: resultRows
            });
            console.log(`  ✅ Created ${created.count} new components`);
        } else {
            console.warn("  ⚠️ No components to create!");
        }

        // ============================================================
        // COMPUTE FINAL TOTALS
        // ============================================================
        const inHandAnnual = toSafeNumber(totalEarnings - totalDeductions);
        const inHandMonthly = toSafeNumber((inHandAnnual / 12).toFixed(2));

        console.log(`  💰 In-Hand Annual: ${inHandAnnual}`);
        console.log(`  💵 In-Hand Monthly: ${inHandMonthly}`);

        // ============================================================
        // UPDATE STRUCTURE WITH TOTALS
        // ============================================================
        const updated = await prisma.salaryStructure.update({
            where: { id: structure.id.toString() },
            data: {
                totalEarnings,
                totalDeductions,
                totalBenefits,
                inHandAnnual,
                inHandMonthly
            },
            include: {
                components: {
                    include: {
                        component: true
                    }
                },
                template: {
                    include: {
                        components: {
                            include: {
                                component: true
                            }
                        }
                    }
                }
            }
        });

        console.log("✅ Structure updated successfully\n");

        // ============================================================
        // FORMAT FINAL OUTPUT
        // ============================================================
        return {
            id: updated.id.toString(),
            employeeId: updated.employeeId.toString(),
            templateId: updated.templateId?.toString() || "",
            grossAnnual: toSafeNumber(updated.grossAnnual),

            totalEarnings,
            totalDeductions,
            totalBenefits,
            inHandAnnual,
            inHandMonthly,

            status: updated.status,
            effectiveFrom: safeDate(updated.effectiveFrom),
            effectiveTo: safeDate(updated.effectiveTo),

            deductFromInHand: updated.deductFromInHand,
            isCurrentActive: updated.isCurrentActive,

            components: updated.components.map((sc) => ({
                id: sc.id.toString(),
                componentId: sc.componentId.toString(),
                componentKey: sc.component?.key || "",
                componentName: sc.component?.name || "",
                componentType: sc.component?.type.toUpperCase() || "",
                formula: sc.formula || "",
                value: toSafeNumber(sc.value),
                annualAmount: toSafeNumber(sc.annualAmount),
                monthlyAmount: toSafeNumber(sc.monthlyAmount),
                isOverridden: sc.isOverridden,
                overrideNote: sc.overrideNote || ""
            }))
        };

    } catch (err) {
        console.error("❌ calculateSalaryStructure FAILED:", err);
        console.error("Stack trace:", err.stack);
        throw new Error(`Salary calculation failed: ${err.message}`);
    }
}

// ============================================================
// 🔥 BONUS: BULK RECALCULATION FOR MULTIPLE EMPLOYEES
// ============================================================
export async function bulkRecalculateStructures(employeeIds) {
    const results = [];
    const errors = [];

    for (const empId of employeeIds) {
        try {
            const structure = await prisma.salaryStructure.findFirst({
                where: {
                    employeeId: empId.toString(),
                    isCurrentActive: true,
                    status: "ACTIVE"
                }
            });

            if (structure) {
                const computed = await calculateSalaryStructure(structure.id.toString());
                results.push({
                    employeeId: empId.toString(),
                    structureId: structure.id.toString(),
                    success: true
                });
            } else {
                errors.push({
                    employeeId: empId.toString(),
                    error: "No active salary structure found"
                });
            }
        } catch (err) {
            errors.push({
                employeeId: empId.toString(),
                error: err.message
            });
        }
    }

    return { results, errors };
}

/**
 * ============================================================
 * 🔥 NEW — DRY RUN CALCULATION (NO DB WRITE)
 * ============================================================
 * @param {string} templateId
 * @param {number} grossAnnual
 * @returns {object} computed salary structure summary
 * ============================================================
 */
export async function calculateSalaryStructureDryRun(templateId, grossAnnual) {
    console.log("🟡 DRY RUN: Starting calculation for template:", templateId);

    if (!templateId || !grossAnnual) {
        throw new Error("templateId & grossAnnual are required");
    }

    // 1️⃣ Load template + components
    const template = await prisma.salaryTemplate.findUnique({
        where: { id: templateId.toString() },
        include: {
            components: {
                include: { component: true },
                orderBy: { priority: "asc" }
            }
        }
    });

    if (!template) throw new Error("Template not found");

    // Filter active components
    const templateComponents = (template.components || [])
        .filter(tc => tc.component && tc.component.isActive);

    // 2️⃣ Base context
    const context = {
        gross: toSafeNumber(grossAnnual),
        grossAnnual: toSafeNumber(grossAnnual),
        ctc: toSafeNumber(grossAnnual)
    };

    console.log("💰 DRY RUN context:", context);

    let totalEarnings = 0;
    let totalDeductions = 0;
    let totalBenefits = 0;

    const resultRows = [];
    const processedComponentIds = new Set();

    // ============================================================
    // INTERNAL PROCESSOR (same as main engine, but no DB writes)
    // ============================================================
    const processComponent = (componentDef, templateComp = null) => {
        if (!componentDef || !componentDef.isActive) return;

        const componentId = componentDef.id.toString();
        if (processedComponentIds.has(componentId)) return;

        console.log(`\n🔧 DRY RUN Processing: ${componentDef.name} (${componentDef.key})`);

        // 1️⃣ Condition check
        if (templateComp?.condition) {
            const conditionMet = !!evaluateFormula(templateComp.condition, context);
            console.log(`  📝 Condition: "${templateComp.condition}" = ${conditionMet}`);
            if (!conditionMet) return;
        }

        let finalValue = null;
        let finalFormula = null;
        let calculationSource = "default";

        // 2️⃣ Template fixed value (only if non-zero)
        if (templateComp?.value !== undefined &&
            templateComp.value !== null &&
            templateComp.value !== 0) {

            finalValue = toSafeNumber(templateComp.value);
            calculationSource = "template_value";
        }
        // 3️⃣ Formula calculation
        else {
            finalFormula =
                templateComp?.formula ||
                componentDef.defaultFormula ||
                null;

            if (finalFormula) {
                finalValue = evaluateFormula(finalFormula, context);
                calculationSource = "formula";
            } else {
                finalValue = 0;
                calculationSource = "zero_default";
            }
        }

        console.log(`  🔢 RAW VALUE = ${finalValue}`);

        // 🔥 Apply MIN / MAX — treat 0 as "no limit"
        if (templateComp) {
            if (templateComp.minValue > 0 && finalValue < templateComp.minValue) {
                finalValue = templateComp.minValue;
                console.log(`  ⬆️ Applied MIN: ${finalValue}`);
            }
            if (templateComp.maxValue > 0 && finalValue > templateComp.maxValue) {
                finalValue = templateComp.maxValue;
                console.log(`  ⬇️ Applied MAX: ${finalValue}`);
            }
        }

        const annual = toSafeNumber(finalValue);
        const monthly = toSafeNumber((annual / 12).toFixed(2));

        console.log(`  💵 Annual = ${annual}, Monthly = ${monthly}`);

        // 4️⃣ Update context
        if (componentDef.key) {
            context[componentDef.key] = annual;
        }

        // 5️⃣ Add totals
        const type = (componentDef.type || "").toLowerCase();
        if (type === "earning") totalEarnings += annual;
        else if (type === "deduction") totalDeductions += annual;
        else if (type === "benefit" || type === "reimbursement") totalBenefits += annual;

        // 6️⃣ Push result row
        resultRows.push({
            id: "preview",
            componentId: componentId,
            componentKey: componentDef.key,
            componentName: componentDef.name,
            componentType: componentDef.type?.toUpperCase() || "",
            formula: finalFormula || "",
            value: calculationSource.includes("value") ? finalValue : null,
            annualAmount: annual,
            monthlyAmount: monthly,
            isOverridden: false,
            overrideNote: ""
        });

        processedComponentIds.add(componentId);
    };

    // ============================================================
    // PROCESS TEMPLATE COMPONENTS
    // ============================================================
    for (const tc of templateComponents) {
        processComponent(tc.component, tc);
    }

    // ============================================================
    // FINAL TOTALS
    // ============================================================
    const inHandAnnual = totalEarnings - totalDeductions;
    const inHandMonthly = toSafeNumber((inHandAnnual / 12).toFixed(2));

    // ============================================================
    // RETURN DRY STRUCTURE
    // ============================================================
    const result = {
        grossAnnual: toSafeNumber(grossAnnual),
        totalEarnings,
        totalDeductions,
        totalBenefits,
        inHandAnnual,
        inHandMonthly,
        components: resultRows
    };

    console.log("\n🟡 DRY RUN RESULT:", result);
    return result;
}