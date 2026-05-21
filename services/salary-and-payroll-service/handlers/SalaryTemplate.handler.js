// salary-and-payroll-service/handlers/SalaryTemplate.handler.js

import { grpc } from '@jury-hrms/proto'
import { prisma } from '@jury-hrms/db/client.js'
import { checkFinanceEnabled } from '../helper/checks.js'

/**
 * ================================================================
 *  FEATURE: LIST SALARY TEMPLATES (METADATA ONLY)
 * ================================================================
 */
export const listSalaryTemplatesFunc = async (call, callback) => {
    try {
        const {
            page = 1,
            per_page,
            search,
            sort_by = 'createdAt',
            sort_order = 'desc',
            organization_id,
        } = call.request

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id is required',
            })
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)
        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: 'Finance is not enabled',
            })
        }

        const skip = page && per_page ? (page - 1) * per_page : undefined
        const take = page && per_page ? per_page : undefined

        const where = {
            organizationId: organization_id,
            deletedAt: null,
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                    { departments: { has: search } },
                    { designations: { has: search } },
                ],
            }),
        }

        const templates = await prisma.salaryTemplate.findMany({
            where,
            skip,
            take,
            orderBy: { [sort_by]: sort_order },
        })

        const total = await prisma.salaryTemplate.count({ where })

        // Resolve department & designation names
        const mapped = await Promise.all(
            templates.map(async (t) => ({
                ...t,
                departments: await prisma.organizationDepartments
                    .findMany({
                        where: { id: { in: t.departments } },
                        select: { name: true },
                    })
                    .then((r) => r.map((d) => d.name)),
                ranges: await prisma.salaryTemplateRange.findMany({
                    where: {
                        templateId: t.id,
                        deletedAt: null,
                        components: {
                            some: {
                                deletedAt: null,
                                component: {
                                    deletedAt: null
                                }
                            }
                        }
                    },
                    include: {
                        components: {
                            where: {
                                deletedAt: null,
                                component: {
                                    deletedAt: null
                                }
                            },
                            include: {
                                component: true
                            }
                        }
                    }
                }),
                designations: await prisma.organizationDesignations
                    .findMany({
                        where: { id: { in: t.designations } },
                        select: { name: true },
                    })
                    .then((r) => r.map((d) => d.name)),
            }))
        )

        return callback(null, {
            success: true,
            message: 'Salary templates fetched successfully',
            data: mapped,
            total,
            page,
            limit: per_page,
            total_pages: per_page ? Math.ceil(total / per_page) : 1,
        })
    } catch (e) {
        console.error('List SalaryTemplate Error:', e)
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

/**
 * ================================================================
 *  FEATURE: GET SALARY TEMPLATE (METADATA ONLY)
 * ================================================================
 */
export const getSalaryTemplateFunc = async (call, callback) => {
    try {
        const { template_id, organization_id } = call.request

        if (!organization_id || !template_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id and template_id are required',
            })
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)
        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: 'Finance is not enabled',
            })
        }

        const template = await prisma.salaryTemplate.findFirst({
            where: {
                id: template_id,
                organizationId: organization_id,
                deletedAt: null,
            },
        })

        if (!template) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Salary template not found',
            })
        }

        return callback(null, {
            success: true,
            message: 'Salary template fetched successfully',
            data: template,
        })
    } catch (e) {
        console.error('Get SalaryTemplate Error:', e)
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

/**
 * ================================================================
 *  FEATURE: CREATE / UPDATE SALARY TEMPLATE (NO COMPONENTS)
 * ================================================================
 */
export const upsertSalaryTemplateFunc = async (call, callback) => {
    try {
        const {
            template_id,
            organization_id,
            name,
            description,
            departments = [],
            designations = [],
            isDefault = false,
            isActive = true,
        } = call.request

        if (!organization_id || !name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id and name are required',
            })
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)
        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: 'Finance is not enabled',
            })
        }

        const isUpdate = Boolean(template_id)

        // Name uniqueness per org
        const existing = await prisma.salaryTemplate.findFirst({
            where: {
                name,
                organizationId: organization_id,
                deletedAt: null,
                ...(isUpdate && { id: { not: template_id } }),
            },
        })

        if (existing) {
            return callback({
                code: grpc.status.ALREADY_EXISTS,
                message: 'A salary template with this name already exists',
            })
        }

        const template = isUpdate
            ? await prisma.salaryTemplate.update({
                where: { id: template_id },
                data: {
                    name,
                    description,
                    departments,
                    designations,
                    isDefault,
                    isActive,
                    updatedAt: new Date(),
                },
            })
            : await prisma.salaryTemplate.create({
                data: {
                    organizationId: organization_id,
                    name,
                    description,
                    departments,
                    designations,
                    isDefault,
                    isActive,
                },
            })

        return callback(null, {
            success: true,
            message: isUpdate
                ? 'Salary template updated successfully'
                : 'Salary template created successfully',
            data: template,
        })
    } catch (e) {
        console.error('Upsert SalaryTemplate Error:', e)
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

/**
 * ================================================================
 *  FEATURE: DELETE SALARY TEMPLATE (SOFT DELETE)
 * ================================================================
 */
export const deleteSalaryTemplateFunc = async (call, callback) => {
    try {
        const { id, organization_id } = call.request

        if (!organization_id || !id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'organization_id and id are required',
            })
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)
        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: 'Finance is not enabled',
            })
        }

        const exists = await prisma.salaryTemplate.findFirst({
            where: { id, organizationId: organization_id, deletedAt: null },
        })

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Salary template not found',
            })
        }

        await prisma.salaryTemplate.update({
            where: { id },
            data: { deletedAt: new Date() },
        })

        return callback(null, {
            success: true,
            message: 'Salary template deleted successfully',
        })
    } catch (e) {
        console.error('Delete SalaryTemplate Error:', e)
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}


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
            kind: c.component.type,
            formula: c.formula,
            value: c.value,
            priority: c.priority,
            minValue: c.minValue,
            maxValue: c.maxValue,
            condition: c.condition,
        }));

        console.log('SalaryTemplate.handler.js @ Line 405:', {
            template_id: tpl.id,
            range_id: picked.id,
            components: engineComponents,
        });

        const result = await calculateSalary({
            baseInput: { gross: Number(gross) },
            components: engineComponents,
        });

        console.log('SalaryTemplate.handler.js @ Line 405:', result);

        return callback(null, {
            success: true,
            message: "Salary preview generated",
            template_id: tpl.id,
            range_id: picked.id,
            components: result.components.map((x) => ({
                component_id: x.componentId,
                key: x.componentKey,
                name: x.componentName,
                componentType: x.kind || "",
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
