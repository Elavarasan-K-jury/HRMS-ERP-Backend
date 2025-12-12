// salary-and-payroll-service/handlers/SalaryTemplate.handler.js

import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

/**
 * ================================================================
 *  FEATURE: LIST SALARY TEMPLATES (summary)
 * ================================================================
 */
export const listSalaryTemplatesFunc = async (call, callback) => {
    try {
        const {
            page = 1,
            per_page,
            search,
            sort_by = "createdAt",
            sort_order = "desc",
            organization_id,
        } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }


        let paginate = {};
        if (page && per_page) {
            paginate = { skip: (page - 1) * per_page, take: per_page };
        }

        let searchWhere = { deletedAt: null };

        if (search) {
            searchWhere = {
                AND: [
                    { deletedAt: null },
                    {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' } },
                            { description: { contains: search, mode: 'insensitive' } },
                            { departments: { has: search } },
                            { designations: { has: search } },
                        ]
                    }
                ]
            };
        }

        const data = await prisma.salaryTemplate.findMany({
            where: {
                organizationId: organization_id,
                ...searchWhere,
            },
            include: {
                components: {
                    where: { deletedAt: null },
                    include: {
                        component: true
                    },
                },
            },
            orderBy: { [sort_by]: sort_order },
            ...paginate,
        });

        const total = await prisma.salaryTemplate.count({
            where: {
                organizationId: organization_id,
                ...searchWhere,
            },
        });

        // enrich with component count
        const mapped = data.map(async (t) => ({
            ...t,
            departments: (await prisma.organizationDepartments.findMany({
                where: {
                    id: {
                        in: t.departments
                    }
                },
                select: {
                    name: true
                }
            })).map(e => e.name),
            designations: (await prisma.organizationDesignations.findMany({
                where: {
                    id: {
                        in: t.designations
                    }
                },
                select: {
                    name: true
                }
            })).map(e => e.name),
            componentCount: t.components?.length || 0,
        }));

        return callback(null, {
            success: true,
            message: "Salary templates fetched successfully",
            data: await Promise.all(mapped),
            total,
            page,
            limit: per_page,
            total_pages: per_page ? Math.ceil(total / per_page) : 1,
        });

    } catch (e) {
        console.error("List SalaryTemplate Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
/**
 * ================================================================
 *  FEATURE: GET TEMPLATE BUILDER DATA
 * ================================================================
 * - Template (if id provided)
 * - TemplateComponents with ComponentDefinition details
 * - Available ComponentDefinition list for this org
 * ================================================================
 */
export const getSalaryTemplateBuilderDataFunc = async (call, callback) => {
    try {
        const { template_id, organization_id } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }

        const template = await prisma.salaryTemplate.findFirst({
            where: template_id ? {
                id: template_id,
                organizationId: organization_id,
                deletedAt: null,
            } : {
                organizationId: organization_id,
                deletedAt: null,
            },
            include: {
                components: {
                    include: {
                        component: true, // ComponentDefinition
                    },
                    orderBy: { priority: 'asc' },
                },
            },
        });

        if (template_id && !template) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Salary Template not found",
            });
        }

        // All active component definitions for this org
        const availableComponents = await prisma.componentDefinition.findMany({
            where: {
                organizationId: organization_id,
                deletedAt: null,
                isActive: true,
            },
            orderBy: { displayOrder: 'asc' },
        });

        return callback(null, {
            success: true,
            message: "Template builder data fetched",
            template: {
                ...template,
                departments: (await prisma.organizationDepartments.findMany({
                    where: {
                        id: {
                            in: template.departments
                        }
                    }
                })).map(e => e.name),
                designations: (await prisma.organizationDesignations.findMany({
                    where: {
                        id: {
                            in: template.designations
                        }
                    }
                })).map(e => e.name)
            },
            availableComponents,
        });

    } catch (e) {
        console.error("Get SalaryTemplate Builder Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
/**
 * ================================================================
 *  FEATURE: UPSERT SALARY TEMPLATE (with nested TemplateComponents)
 * ================================================================
 */
export const upsertSalaryTemplateFunc = async (call, callback) => {
    try {
        const {
            template_id,
            organization_id,
            name,
            description,
            departments,
            designations,
            isDefault,
            isActive,
            components = [],
        } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }

        if (!name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "name is required",
            });
        }

        const isUpdate = !!template_id;

        // Validate name uniqueness inside org (excluding current template on update)
        const existingByName = await prisma.salaryTemplate.findFirst({
            where: {
                name,
                organizationId: organization_id,
                deletedAt: null,
                ...(isUpdate && { id: { not: template_id } }),
            },
        });

        if (existingByName) {
            return callback({
                code: grpc.status.ALREADY_EXISTS,
                message: "A template with this name already exists",
            });
        }

        let resultTemplate = null;

        if (!isUpdate) {
            // ---------------- CREATE ----------------
            resultTemplate = await prisma.salaryTemplate.create({
                data: {
                    organizationId: organization_id,
                    name,
                    description,
                    departments: departments || [],
                    designations: designations || [],
                    isDefault: isDefault ?? false,
                    isActive: isActive ?? true,
                },
            });
        } else {
            // ---------------- UPDATE ----------------
            const existing = await prisma.salaryTemplate.findFirst({
                where: { id: template_id, organizationId: organization_id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "SalaryTemplate not found",
                });
            }

            resultTemplate = await prisma.salaryTemplate.update({
                where: { id: template_id },
                data: {
                    name,
                    description,
                    departments: departments || [],
                    designations: designations || [],
                    isDefault,
                    isActive,
                    updatedAt: new Date()
                },
            });
        }

        const finalTemplateId = resultTemplate.id;

        // 🔁 Replace all TemplateComponents for this template_id
        await prisma.templateComponent.deleteMany({
            where: { templateId: finalTemplateId },
        });

        if (Array.isArray(components) && components.length > 0) {
            const toCreate = components.map((c, index) => ({
                templateId: finalTemplateId,
                componentId: c.componentId,
                formula: c.formula || null,
                value: c.value ?? null,
                priority: c.priority ?? index, // fallback to index if not provided
                minValue: c.minValue ?? null,
                maxValue: c.maxValue ?? null,
                condition: c.condition ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            }));

            await prisma.templateComponent.createMany({
                data: toCreate,
            });
        }

        // return with components
        const fullTemplate = await prisma.salaryTemplate.findFirst({
            where: { id: finalTemplateId },
            include: {
                components: {
                    include: { component: true },
                    orderBy: { priority: 'asc' },
                },
            },
        });

        return callback(null, {
            success: true,
            message: isUpdate
                ? "Salary template updated successfully"
                : "Salary template created successfully",
            data: fullTemplate,
        });

    } catch (e) {
        console.error("Upsert SalaryTemplate Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
/**
 * ================================================================
 *  FEATURE: DELETE SALARY TEMPLATE (soft delete)
 * ================================================================
 */
export const deleteSalaryTemplateFunc = async (call, callback) => {
    try {
        const { id, organization_id } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "id is required",
            });
        }

        const exists = await prisma.salaryTemplate.findFirst({
            where: { id, organizationId: organization_id, deletedAt: null },
        });

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "SalaryTemplate not found",
            });
        }

        await prisma.salaryTemplate.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        return callback(null, {
            success: true,
            message: "Salary template deleted successfully",
        });

    } catch (e) {
        console.error("Delete SalaryTemplate Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
