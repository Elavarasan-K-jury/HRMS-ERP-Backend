// src/services/salary/checks.js
import { prisma } from '@jury-hrms/db/client.js';

export const checkFinanceEnabled = async (organization_id) => {
    try {
        const organizationIdAvailable = await prisma.organizations.findFirst({
            where: {
                id: organization_id
            }
        })
        if (!organizationIdAvailable) throw new Error('Organization not found.')
        const organizationFinance = await prisma.orgaizationFinance.findFirst({
            where: {
                organizationId: organization_id,
                deletedAt: null
            }
        })
        if (!organizationFinance) throw new Error('Organization finance is not setup yet')
        if (organizationFinance) {
            if (organizationFinance.enablePf) {
                if (!organizationFinance.pfFormula || !organizationFinance.pfRegisteredOrganizationName || !organizationFinance.pfRegistrationNumber) {
                    throw new Error('Organization finance is not setup yet')
                }
            }
            if (organizationFinance.enableEsi) {
                if (!organizationFinance.esiFormula || !organizationFinance.esiRegisteredOrganizationName || !organizationFinance.esiRegistrationNumber) {
                    throw new Error('Organization finance is not setup yet')
                }
            }
            if (organizationFinance.enablePtax) {
                if (!organizationFinance.ptaxFormula) {
                    throw new Error('Organization finance is not setup yet')
                }
            }
        }
        return true
    } catch (error) {
        console.error(`[Check Finance Enabled] Error: ${error}`);
        console.log("[Check Finance Enabled] Error Details: ", error);
        return false
    }
}