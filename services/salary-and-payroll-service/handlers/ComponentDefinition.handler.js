import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { checkFinanceEnabled } from '../helper/checks.js';

/**
 * ================================================================
 *  FETCH COMPONENT DEFINITIONS (with pagination + search)
 * ================================================================
 */
export const fetchComponentDefinitionsFunc = async (call, callback) => {
    try {
        const {
            page,
            per_page,
            search,
            category = 'recurring',
            sort_by = "displayOrder",
            sort_order = "asc",
            organization_id
        } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }

        const organization = await prisma.organizations.findFirst({
            where: {
                id: organization_id
            }
        })
        if (!organization) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Organization not found",
            });
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)

        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: "Finance is not enabled",
            });
        }

        const categories = [
            { category_name: 'recurring', components_count: 0 },
            { category_name: 'adhoc', components_count: 0 },
            { category_name: 'allowance', components_count: 0 },
            { category_name: 'custom', components_count: 0 },
        ]

        if (!categories.find(e => e.category_name == category)) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Category options are recurring/adhoc/allowance/custom",
            });
        }

        let paginate = {};
        if (page && per_page) {
            paginate = { skip: (page - 1) * per_page, take: per_page };
        }

        let searchWhere = {
            deletedAt: null,
        };
        if (category) searchWhere = { ...searchWhere, category }
        if (search) {
            searchWhere = {
                OR: [
                    { key: { contains: search, mode: 'insensitive' } },
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                    { category: { contains: search, mode: 'insensitive' } },
                ]
            };
        }
        let orderData = {}
        if (sort_by && sort_order) orderData = { [sort_by]: sort_order }

        const data = await prisma.componentDefinition.findMany({
            where: { organizationId: organization_id, ...searchWhere },
            orderBy: orderData,
            ...paginate
        });

        const total = await prisma.componentDefinition.count({
            where: { organizationId: organization_id, ...searchWhere },
        });

        const categoriesMapped = await categories.map(async (e) => {
            const components = await prisma.componentDefinition.count({
                where: {
                    deletedAt: null,
                    isActive: true,
                    category: e.category_name
                }
            })
            return {
                ...e,
                components_count: components
            }
        })

        const categoriesList = await Promise.all(categoriesMapped)

        return callback(null, {
            success: true,
            message: "Component definitions fetched successfully",
            data,
            total,
            page,
            categories: categoriesList,
            limit: per_page,
            total_pages: Math.ceil(total / per_page),
        });

    } catch (e) {
        console.error("Fetch ComponentDefinition Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};



/**
 * ================================================================
 *  CREATE COMPONENT DEFINITION
 * ================================================================
 */
export const createComponentDefinitionFunc = async (call, callback) => {
    try {
        const {
            organization_id,
            key,
            name,
            type,
            category,
            defaultFormula,
            description,
            isTaxable,
            isVariable,
            isStatutory,
            includeInCTC,
            includeInGross,
            displayOrder,
            isActive
        } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }
        const organization = await prisma.organizations.findFirst({
            where: {
                id: organization_id
            }
        })
        if (!organization) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Organization not found",
            });
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)

        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: "Finance is not enabled",
            });
        }

        // Check for duplicate key within organization
        const exists = await prisma.componentDefinition.findFirst({
            where: { key, organizationId: organization_id }
        });

        if (exists) {
            return callback({
                code: grpc.status.ALREADY_EXISTS,
                message: "Component key already exists for this organization",
            });
        }

        const order = await prisma.componentDefinition.count()

        const pushingUp = order > displayOrder // Decreasing the order
        const pushingDown = order < displayOrder // Increasing the order
        let existsInOrder = []

        if (pushingUp) existsInOrder = await prisma.componentDefinition.findMany({
            where: {
                displayOrder: {
                    gte: displayOrder
                },
                deletedAt: null,
                id: {
                    not: exists.id
                }
            }
        })
        if (pushingDown) existsInOrder = await prisma.componentDefinition.findMany({
            where: {
                displayOrder: {
                    lte: displayOrder
                },
                displayOrder: {
                    gt: order
                },
                deletedAt: null,
            }
        })

        const created = await prisma.componentDefinition.create({
            data: {
                organizationId: organization_id,
                key,
                name,
                type,
                category,
                defaultFormula,
                description,
                isTaxable,
                isVariable,
                isStatutory,
                includeInCTC,
                includeInGross,
                displayOrder: displayOrder ?? 999,
                isActive,
                isDefault: false,
                isDeletable: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        });
        if (pushingUp) {
            for (const i of existsInOrder) {
                await prisma.componentDefinition.update({
                    data: { displayOrder: i.displayOrder + 1 },
                    where: { id: i.id }
                })
            }
        }
        if (pushingDown) {
            for (const i of existsInOrder) {
                await prisma.componentDefinition.update({
                    data: { displayOrder: i.displayOrder - 1 },
                    where: { id: i.id }
                })
            }
        }

        return callback(null, {
            success: true,
            message: "Component definition created successfully",
            data: created
        });

    } catch (e) {
        console.error("Create ComponentDefinition Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};



/**
 * ================================================================
 *  UPDATE COMPONENT DEFINITION
 * ================================================================
 */
export const updateComponentDefinitionFunc = async (call, callback) => {
    try {
        const {
            id,
            organization_id,
            key,
            name,
            type,
            category,
            defaultFormula,
            description,
            isTaxable,
            isVariable,
            isStatutory,
            includeInCTC,
            includeInGross,
            displayOrder,
            isActive
        } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "id is required",
            });
        }
        const organization = await prisma.organizations.findFirst({
            where: {
                id: organization_id
            }
        })
        if (!organization) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Organization not found",
            });
        }

        const enabledFinance = await checkFinanceEnabled(organization_id)

        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: "Finance is not enabled",
            });
        }
        const exists = await prisma.componentDefinition.findFirst({
            where: { id, organizationId: organization_id }
        });

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "ComponentDefinition not found",
            });
        }

        // Optional: Prevent key duplication on update
        if (key && key !== exists.key) {
            const duplicate = await prisma.componentDefinition.findFirst({
                where: { key, organizationId: organization_id }
            });
            if (duplicate) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: "Key already exists for this organization",
                });
            }
        }
        const pushingUp = exists.displayOrder > displayOrder // Decreasing the order
        const pushingDown = exists.displayOrder < displayOrder // Increasing the order
        let existsInOrder = []

        if (pushingUp) existsInOrder = await prisma.componentDefinition.findMany({
            where: {
                displayOrder: {
                    gte: displayOrder
                },
                deletedAt: null,
                id: {
                    not: exists.id
                }
            }
        })
        if (pushingDown) existsInOrder = await prisma.componentDefinition.findMany({
            where: {
                displayOrder: {
                    lte: displayOrder
                },
                displayOrder: {
                    gt: exists.displayOrder
                },
                deletedAt: null,
                id: {
                    not: exists.id
                }
            }
        })


        const updated = await prisma.componentDefinition.update({
            where: { id },
            data: {
                key,
                name,
                type,
                category,
                defaultFormula,
                description,
                isTaxable,
                isVariable,
                isStatutory,
                includeInCTC,
                includeInGross,
                displayOrder,
                isActive,
            },
        });


        if (pushingUp) {
            for (const i of existsInOrder) {
                await prisma.componentDefinition.update({
                    data: { displayOrder: i.displayOrder + 1 },
                    where: { id: i.id }
                })
            }
        }
        if (pushingDown) {
            for (const i of existsInOrder) {
                await prisma.componentDefinition.update({
                    data: { displayOrder: i.displayOrder - 1 },
                    where: { id: i.id }
                })
            }
        }

        return callback(null, {
            success: true,
            message: "Component definition updated successfully",
            data: updated,
        });

    } catch (e) {
        console.error("Update ComponentDefinition Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};



/**
 * ================================================================
 *  DELETE COMPONENT DEFINITION
 * ================================================================
 */
export const deleteComponentDefinitionFunc = async (call, callback) => {
    try {
        const { id } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "id is required",
            });
        }

        const exists = await prisma.componentDefinition.findFirst({
            where: { id }
        });

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "Component Definition not found",
            });
        }

        const organization = await prisma.organizations.findFirst({
            where: {
                id: exists.organizationId
            }
        })
        if (!organization) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Organization not found",
            });
        }

        const enabledFinance = await checkFinanceEnabled(exists.organizationId)

        if (!enabledFinance) {
            return callback({
                code: grpc.status.PERMISSION_DENIED,
                message: "Finance is not enabled",
            });
        }

        // 💡 Delete related TemplateComponent / StructureComponent automatically if needed
        // Prisma should handle ON DELETE CASCADE if defined

        await prisma.componentDefinition.update({
            data: {
                deletedAt: new Date()
            },
            where: { id },
        });

        return callback(null, {
            success: true,
            message: "Component definition deleted successfully",
        });

    } catch (e) {
        console.error("Delete ComponentDefinition Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
