import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { checkFinanceEnabled } from '../helper/checks.js';

async function validateOrganization(organization_id) {
    if (!organization_id) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: "organization_id is required",
        }
    }

    const organization = await prisma.organizations.findFirst({
        where: { id: organization_id }
    })

    if (!organization) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: "Organization not found",
        }
    }

    return organization
}

async function enabledForTheFirstTime(organization_id) {
    const createdDefaultComponent = await prisma.componentDefinition.findFirst({
        where: {
            deletedAt: null,
            isDefault: true,
            isDeletable: false
        }
    })
    if (createdDefaultComponent) return
    await prisma.componentDefinition.create({
        data: {
            organizationId: organization_id,
            key: 'other_allowance',
            name: 'Other Allowance',
            type: 'earning',
            category: 'recurring',
            defaultFormula: null,
            description: 'Automatically assign with remaining amount and its a default component.',
            isTaxable: true,
            isVariable: true,
            isStatutory: true,
            includeInCTC: true,
            includeInGross: true,
            displayOrder: 1,
            isActive: true,
            isDefault: true,
            isDeletable: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null
        },
    });
}

export const checkIfFinanceEnabledOrNot = async (call, callback) => {
    try {
        const {
            organization_id,
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

        return callback(null, {
            success: true,
            message: `Finance is ${enabledFinance ? "" : "not "}enabled.`,
            enabledFinance
        });

    } catch (e) {
        console.error("List SalaryTemplate Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

export const enableAndSavePfDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            pf_formula,
            pf_registration_number,
            pf_registered_organization_name,
        } = call.request

        await validateOrganization(organization_id)

        if (!pf_formula || !pf_registration_number || !pf_registered_organization_name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "PF details are incomplete",
            })
        }

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enablePf: true,
                pfFormula: pf_formula,
                pfRegistrationNumber: pf_registration_number,
                pfRegisteredOrganizationName: pf_registered_organization_name,
                updatedAt: new Date(),
                deletedAt: null
            },
            create: {
                organizationId: organization_id,
                enablePf: true,
                pfFormula: pf_formula,
                pfRegistrationNumber: pf_registration_number,
                pfRegisteredOrganizationName: pf_registered_organization_name,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: "PF enabled and details saved successfully",
        })
    } catch (e) {
        console.error("Enable PF Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

export const enableDisablePfDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            activity
        } = call.request

        await validateOrganization(organization_id)

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enablePf: activity,
            },
            create: {
                organizationId: organization_id,
                enablePf: activity,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: `PF ${activity ? "enabled" : "disabled"} successfully`,
        })
    } catch (e) {
        console.error("Enable PF Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

export const enableAndSaveEsiDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            esi_formula,
            esi_registration_number,
            esi_registered_organization_name,
        } = call.request

        await validateOrganization(organization_id)

        if (!esi_formula || !esi_registration_number || !esi_registered_organization_name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "ESI details are incomplete",
            })
        }

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enableEsi: true,
                esiFormula: esi_formula,
                esiRegistrationNumber: esi_registration_number,
                esiRegisteredOrganizationName: esi_registered_organization_name,
                updatedAt: new Date(),
                deletedAt: null
            },
            create: {
                organizationId: organization_id,
                enableEsi: true,
                esiFormula: esi_formula,
                esiRegistrationNumber: esi_registration_number,
                esiRegisteredOrganizationName: esi_registered_organization_name,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: "ESI enabled and details saved successfully",
        })
    } catch (e) {
        console.error("Enable ESI Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}
export const enableDisableEsiDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            activity
        } = call.request

        await validateOrganization(organization_id)

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enableEsi: activity,
            },
            create: {
                organizationId: organization_id,
                enableEsi: activity,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: `ESI ${activity ? "enabled" : "disabled"} successfully`,
        })
    } catch (e) {
        console.error("Enable ESI Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}
export const enableAndSavePtaxDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            ptax_formula,
            ptax_registration_number,
            ptax_registered_organization_name,
        } = call.request

        await validateOrganization(organization_id)

        if (!ptax_formula || !ptax_registration_number || !ptax_registered_organization_name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "PTAX details are incomplete",
            })
        }

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enablePtax: true,
                ptaxFormula: ptax_formula,
                ptaxRegistrationNumber: ptax_registration_number,
                ptaxRegisteredOrganizationName: ptax_registered_organization_name,
                updatedAt: new Date(),
                deletedAt: null
            },
            create: {
                organizationId: organization_id,
                enablePtax: true,
                ptaxFormula: ptax_formula,
                ptaxRegistrationNumber: ptax_registration_number,
                ptaxRegisteredOrganizationName: ptax_registered_organization_name,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: "PTAX enabled and details saved successfully",
        })
    } catch (e) {
        console.error("Enable PTAX Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}
export const enableDisablePtaxDetails = async (call, callback) => {
    try {
        const {
            organization_id,
            activity
        } = call.request

        await validateOrganization(organization_id)

        await prisma.orgaizationFinance.upsert({
            where: { organizationId: organization_id },
            update: {
                enablePtax: activity,
            },
            create: {
                organizationId: organization_id,
                enablePtax: activity,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            },
        })

        await enabledForTheFirstTime(organization_id)

        return callback(null, {
            success: true,
            message: `PTAX ${activity ? "enabled" : "disabled"} successfully`,
        })
    } catch (e) {
        console.error("Enable PTAX Error:", e)
        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        })
    }
}

export const getOrganizationFinanceDetails = async (call, callback) => {
    try {
        const { organization_id } = call.request;

        if (!organization_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "organization_id is required",
            });
        }

        const organization = await prisma.organizations.findFirst({
            where: { id: organization_id },
        });

        if (!organization) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: "Organization not found",
            });
        }

        const finance = await prisma.orgaizationFinance.findFirst({
            where: {
                organizationId: organization_id,
                deletedAt: null,
            },
        });

        // 🔹 If finance is not configured yet
        if (!finance) {
            return callback(null, {
                success: true,
                message: "Finance configuration not found",
                financeEnabled: false,
                finance: null,
            });
        }

        return callback(null, {
            success: true,
            message: "Finance configuration fetched successfully",
            financeEnabled: finance.enablePf || finance.enableEsi || finance.enablePtax,
            finance: {
                enable_pf: finance.enablePf ?? false,
                enable_esi: finance.enableEsi ?? false,
                enable_ptax: finance.enablePtax ?? false,
                pf_formula: finance.pfFormula ?? "",
                pf_registration_number: finance.pfRegistrationNumber ?? "",
                pf_registered_organization_name: finance.pfRegisteredOrganizationName ?? "",
                esi_formula: finance.esiFormula ?? "",
                esi_registration_number: finance.esiRegistrationNumber ?? "",
                esi_registered_organization_name: finance.esiRegisteredOrganizationName ?? "",
                ptax_formula: finance.ptaxFormula ?? "",
                ptax_registration_number: finance.ptaxRegistrationNumber ?? "",
                ptax_registered_organization_name: finance.ptaxRegisteredOrganizationName ?? "",
            },
        });
    } catch (e) {
        console.error("Get Finance Details Error:", e);
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};
