import { grpc } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";
import { checkFinanceEnabled } from "../helper/checks.js";
import { calculateSalary } from "../helper/calculator.js";

const toIso = (d) => (d ? d.toISOString() : "");

function mapRange(r) {
    return {
        id: r.id,
        template_id: r.templateId,
        gross_low: r.grossLow ?? 0,
        gross_high: r.grossHigh ?? 0,
        has_gross_high: r.grossHigh !== null && r.grossHigh !== undefined,
        ctc_low: r.ctcLow ?? 0,
        ctc_high: r.ctcHigh ?? 0,
        has_ctc_high: r.ctcHigh !== null && r.ctcHigh !== undefined,
        label: r.label ?? "",
        created_at: toIso(r.createdAt),
        updated_at: toIso(r.updatedAt),
    };
}

async function assertFinanceEnabled(organization_id, callback) {
    if (!organization_id) {
        callback({ code: grpc.status.INVALID_ARGUMENT, message: "organization_id is required" });
        return false;
    }
    const enabled = await checkFinanceEnabled(organization_id);
    if (!enabled) {
        callback({ code: grpc.status.PERMISSION_DENIED, message: "Finance is not enabled" });
        return false;
    }
    return true;
}

async function validateNoOverlap(templateId, low, highOrNull, excludeRangeId = null) {
    // overlap rule: new [low, high] must not overlap existing ranges (high null means Infinity)
    const ranges = await prisma.salaryTemplateRange.findMany({
        where: { templateId, deletedAt: null, ...(excludeRangeId && { id: { not: excludeRangeId } }) },
        select: { id: true, grossLow: true, grossHigh: true },
        orderBy: { grossLow: "asc" },
    });

    const newLow = Number(low);
    const newHigh = highOrNull == null ? Infinity : Number(highOrNull);

    for (const r of ranges) {
        const rLow = Number(r.grossLow ?? 0);
        const rHigh = r.grossHigh == null ? Infinity : Number(r.grossHigh);
        const overlaps = !(newHigh < rLow || newLow > rHigh);
        if (overlaps) return { ok: false, conflictId: r.id };
    }
    return { ok: true };
}

export const CreateRange = async (call, callback) => {
    try {
        const { organization_id, template_id, gross_low, gross_high, has_gross_high, label } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!template_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "template_id is required" });

        const high = has_gross_high ? gross_high : null;

        if (high !== null && Number(high) <= Number(gross_low)) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "gross_high must be > gross_low" });
        }

        const overlap = await validateNoOverlap(template_id, gross_low, high);
        if (!overlap.ok) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: `Range overlaps with ${overlap.conflictId}` });
        }

        const r = await prisma.salaryTemplateRange.create({
            data: {
                templateId: template_id,
                grossLow: gross_low,
                grossHigh: high,
                label: label ?? null,
                deletedAt: null,
            },
        });

        return callback(null, { success: true, message: "Range created", range: mapRange(r) });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const UpdateRange = async (call, callback) => {
    try {
        const { organization_id, range_id, gross_low, gross_high, has_gross_high, label } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!range_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "range_id is required" });

        const existing = await prisma.salaryTemplateRange.findFirst({ where: { id: range_id, deletedAt: null } });
        if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: "Range not found" });

        const high = has_gross_high ? gross_high : null;

        if (high !== null && Number(high) <= Number(gross_low)) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "gross_high must be > gross_low" });
        }

        const overlap = await validateNoOverlap(existing.templateId, gross_low, high, range_id);
        if (!overlap.ok) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: `Range overlaps with ${overlap.conflictId}` });
        }

        const r = await prisma.salaryTemplateRange.update({
            where: { id: range_id },
            data: { grossLow: gross_low, grossHigh: high, label: label ?? null },
        });

        return callback(null, { success: true, message: "Range updated", range: mapRange(r) });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const DeleteRange = async (call, callback) => {
    try {
        const { organization_id, range_id } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!range_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "range_id is required" });

        await prisma.salaryTemplateRange.update({
            where: { id: range_id },
            data: { deletedAt: new Date() },
        });

        return callback(null, { success: true, message: "Range deleted" });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const ListRanges = async (call, callback) => {
    try {
        const { organization_id, template_id } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!template_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "template_id is required" });
        console.log('salaryRange.handler.js @ Line 147:', organization_id, template_id);
        const ranges = await prisma.salaryTemplateRange.findMany({
            where: { templateId: template_id, deletedAt: null },
            orderBy: { grossLow: "asc" },
        });

        return callback(null, { success: true, message: "Ranges fetched", ranges: ranges.map(mapRange) });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const SaveRangeComponents = async (call, callback) => {
    try {
        const { organization_id, template_id, range_id, components = [] } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!template_id || !range_id) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "template_id and range_id are required" });
        }

        // hard replace: delete existing for that range
        await prisma.templateComponent.deleteMany({
            where: { templateId: template_id, rangeId: range_id },
        });

        if (components.length) {
            await prisma.templateComponent.createMany({
                data: components.map((c, idx) => ({
                    templateId: template_id,
                    rangeId: range_id,
                    componentId: c.component_id,
                    kind: c.kind || null,
                    formula: c.formula || null,
                    value: c.value ?? null,
                    priority: c.priority ?? idx,
                    minValue: c.min_value ?? null,
                    maxValue: c.max_value ?? null,
                    condition: c.condition || null,
                    deletedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })),
            });
        }

        const saved = await prisma.templateComponent.findMany({
            where: { templateId: template_id, rangeId: range_id, deletedAt: null },
            orderBy: { priority: "asc" },
        });

        return callback(null, {
            success: true,
            message: "Range components saved",
            components: saved.map((x) => ({
                id: x.id,
                template_id: x.templateId,
                range_id: x.rangeId,
                component_id: x.componentId,
                kind: x.kind || "",
                formula: x.formula || "",
                value: x.value ?? 0,
                priority: x.priority ?? 0,
                min_value: x.minValue ?? 0,
                max_value: x.maxValue ?? 0,
                condition: x.condition || "",
            })),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

export const GetRangeComponents = async (call, callback) => {
    try {
        const { organization_id, range_id } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!range_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "range_id is required" });

        const items = await prisma.templateComponent.findMany({
            where: { rangeId: range_id, deletedAt: null },
            orderBy: { priority: "asc" },
        });

        return callback(null, {
            success: true,
            message: "Range components fetched",
            components: items.map((x) => ({
                id: x.id,
                template_id: x.templateId,
                range_id: x.rangeId,
                component_id: x.componentId,
                kind: x.kind || "",
                formula: x.formula || "",
                value: x.value ?? 0,
                priority: x.priority ?? 0,
                min_value: x.minValue ?? 0,
                max_value: x.maxValue ?? 0,
                condition: x.condition || "",
            })),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

function rangeMatches(range, gross) {
    const low = Number(range.grossLow ?? 0);
    const high = range.grossHigh == null ? Infinity : Number(range.grossHigh);
    return gross >= low && gross <= high;
}

export const PreviewSalaryForEmployee = async (call, callback) => {
    try {
        const { organization_id, employee_id, template_id, gross } = call.request;

        if (!(await assertFinanceEnabled(organization_id, callback))) return;
        if (!employee_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "employee_id is required" });
        if (!gross || Number(gross) <= 0) return callback({ code: grpc.status.INVALID_ARGUMENT, message: "gross is required" });

        const emp = await prisma.organizationEmployees.findFirst({
            where: { id: employee_id, organizationId: organization_id, deletedAt: null },
            select: { id: true, designationId: true, departmentId: true },
        });
        if (!emp) return callback({ code: grpc.status.NOT_FOUND, message: "Employee not found" });

        // choose template
        let tpl = null;

        if (template_id) {
            tpl = await prisma.salaryTemplate.findFirst({ where: { id: template_id, organizationId: organization_id, deletedAt: null } });
        } else {
            // example matching logic (you can refine)
            tpl = await prisma.salaryTemplate.findFirst({
                where: {
                    organizationId: organization_id,
                    deletedAt: null,
                    isActive: true,
                    OR: [
                        { departments: { has: emp.departmentId } },
                        { designations: { has: emp.designationId } },
                    ],
                },
                orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
            });
        }

        if (!tpl) return callback({ code: grpc.status.NOT_FOUND, message: "No salary template found" });

        // find range
        const ranges = await prisma.salaryTemplateRange.findMany({
            where: { templateId: tpl.id, deletedAt: null },
            orderBy: { grossLow: "asc" },
        });

        const picked = ranges.find((r) => rangeMatches(r, Number(gross)));
        if (!picked) return callback({ code: grpc.status.NOT_FOUND, message: "No matching range found" });

        // fetch components for range + definitions
        const comps = await prisma.templateComponent.findMany({
            where: { templateId: tpl.id, rangeId: picked.id, deletedAt: null },
            include: { component: true },
            orderBy: { priority: "asc" },
        });

        // normalize for engine
        const engineComponents = comps.map((c) => ({
            componentId: c.componentId,
            componentKey: c.component.key,
            componentName: c.component.name,
            kind: c.kind,
            formula: c.formula,
            value: c.value,
            priority: c.priority,
            minValue: c.minValue,
            maxValue: c.maxValue,
            condition: c.condition,
        }));

        const result = calculateSalary({
            baseInput: { gross: Number(gross) },
            components: engineComponents,
        });

        return callback(null, {
            success: true,
            message: "Salary preview generated",
            template_id: tpl.id,
            range_id: picked.id,
            components: result.components.map((x) => ({
                component_id: x.componentId,
                key: x.componentKey,
                name: x.componentName,
                kind: x.kind || "",
                value: x.value,
                formula: x.formula || "",
                priority: x.priority || 0,
            })),
            totals: {
                total_earnings: result.totals.totalEarnings,
                total_deductions: result.totals.totalDeductions,
                total_employer: result.totals.totalEmployer,
                in_hand_monthly: result.totals.inHandMonthly,
                ctc_monthly: result.totals.ctcMonthly,
            },
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};
