import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.LEGAL_ENTITY_SERVICE_PORT || 5070);
const legalEntityProto = loadProto('legal_entity');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

function isValidId(id) {
    return Boolean(id && OBJECT_ID.test(id));
}

function formatDateTime(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

// Local (not UTC) YYYY-MM-DD so `<input type="date">` prefills correctly.
function toDateString(date) {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseDateInput(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function mapSignatory(s) {
    return {
        id: s.id ?? '',
        legal_entity_id: s.legalEntityId ?? '',
        full_name: s.fullName ?? '',
        email: s.email ?? '',
        designation: s.designation ?? '',
        father_name: s.fatherName ?? '',
        address1: s.address1 ?? '',
        address2: s.address2 ?? '',
        city: s.city ?? '',
        state: s.state ?? '',
        zip: s.zip ?? '',
        country: s.country ?? '',
        created_at: formatDateTime(s.createdAt),
        updated_at: formatDateTime(s.updatedAt),
        deleted_at: formatDateTime(s.deletedAt),
    };
}

function mapBankDetail(b) {
    return {
        id: b.id ?? '',
        legal_entity_id: b.legalEntityId ?? '',
        bank_name: b.bankName ?? '',
        account_number: b.accountNumber ?? '',
        ifsc_code: b.ifscCode ?? '',
        branch: b.branch ?? '',
        establishment_id: b.establishmentId ?? '',
        created_at: formatDateTime(b.createdAt),
        updated_at: formatDateTime(b.updatedAt),
        deleted_at: formatDateTime(b.deletedAt),
    };
}

function mapLegalEntity(e) {
    return {
        id: e.id ?? '',
        organization_id: e.organizationId ?? '',
        name: e.name ?? '',
        legal_name: e.legalName ?? '',
        country: e.country ?? '',
        cin: e.cin ?? '',
        incorporation_date: toDateString(e.incorporationDate),
        business_type: e.businessType ?? '',
        sector: e.sector ?? '',
        nature_of_business: e.natureOfBusiness ?? '',
        address1: e.address1 ?? '',
        address2: e.address2 ?? '',
        city: e.city ?? '',
        state: e.state ?? '',
        zip: e.zip ?? '',
        currency: e.currency ?? '',
        financial_year: e.financialYear ?? '',
        logo: e.logo ?? '',
        logo_file_id: e.logoFileId ?? '',
        is_main: e.isMain ?? true,
        is_active: e.isActive ?? true,
        created_at: formatDateTime(e.createdAt),
        updated_at: formatDateTime(e.updatedAt),
        deleted_at: formatDateTime(e.deletedAt),
        signatories: Array.isArray(e.signatories) ? e.signatories.map(mapSignatory) : [],
        banks: Array.isArray(e.banks) ? e.banks.map(mapBankDetail) : [],
    };
}

const entityInclude = {
    signatories: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
    banks: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
};

const impl = {
    /* ================================================================== */
    /* Legal Entity CRUD                                                   */
    /* ================================================================== */

    CreateLegalEntity: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            const org = await prisma.organizations.findFirst({
                where: { id: data.organization_id, deletedAt: null },
            });
            if (!org) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found.',
                });
            }

            const legalEntity = await prisma.legalEntities.create({
                data: {
                    organizationId: data.organization_id,
                    name: data.name,
                    legalName: data.legal_name || null,
                    country: data.country || null,
                    cin: data.cin || null,
                    incorporationDate: parseDateInput(data.incorporation_date),
                    businessType: data.business_type || null,
                    sector: data.sector || null,
                    natureOfBusiness: data.nature_of_business || null,
                    address1: data.address1 || null,
                    address2: data.address2 || null,
                    city: data.city || null,
                    state: data.state || null,
                    zip: data.zip || null,
                    currency: data.currency || null,
                    financialYear: data.financial_year || null,
                    logo: data.logo || null,
                    logoFileId: data.logo_file_id || null,
                    isMain: true,
                    isActive: true,
                    deletedAt: null,
                },
                include: entityInclude,
            });

            callback(null, {
                legal_entity: mapLegalEntity(legalEntity),
                success: true,
                message: 'Legal entity created successfully.',
            });
        } catch (e) {
            console.error('CreateLegalEntity Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetLegalEntity: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!isValidId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const legalEntity = await prisma.legalEntities.findFirst({
                where: { id, deletedAt: null },
                include: entityInclude,
            });
            if (!legalEntity) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Legal entity not found.',
                });
            }

            callback(null, {
                legal_entity: mapLegalEntity(legalEntity),
                success: true,
                message: 'Legal entity found.',
            });
        } catch (e) {
            console.error('GetLegalEntity Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListLegalEntities: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            const skip = (page - 1) * limit;
            const where = { organizationId: organization_id, deletedAt: null };

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { legalName: { contains: search, mode: 'insensitive' } },
                    { cin: { contains: search, mode: 'insensitive' } },
                ];
            }

            const orderFieldMap = {
                created_at: 'createdAt',
                updated_at: 'updatedAt',
                name: 'name',
            };
            const orderField = orderFieldMap[sort_by] || 'createdAt';
            const orderBy = { [orderField]: sort_order === 'asc' ? 'asc' : 'desc' };

            const [legalEntities, total] = await Promise.all([
                prisma.legalEntities.findMany({
                    where,
                    include: entityInclude,
                    orderBy,
                    skip,
                    take: Number(limit),
                }),
                prisma.legalEntities.count({ where }),
            ]);

            callback(null, {
                legal_entities: legalEntities.map(mapLegalEntity),
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / Number(limit)),
                success: true,
                message: 'Legal entities listed successfully.',
            });
        } catch (e) {
            console.error('ListLegalEntities Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateLegalEntity: async (call, callback) => {
        try {
            const data = call.request;
            if (!isValidId(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const existing = await prisma.legalEntities.findFirst({
                where: { id: data.id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Legal entity not found.',
                });
            }

            const updated = await prisma.legalEntities.update({
                where: { id: data.id },
                data: {
                    name: data.name != null ? data.name : existing.name,
                    legalName: data.legal_name != null ? (data.legal_name || null) : existing.legalName,
                    country: data.country != null ? (data.country || null) : existing.country,
                    cin: data.cin != null ? (data.cin || null) : existing.cin,
                    incorporationDate: data.incorporation_date != null
                        ? parseDateInput(data.incorporation_date)
                        : existing.incorporationDate,
                    businessType: data.business_type != null ? (data.business_type || null) : existing.businessType,
                    sector: data.sector != null ? (data.sector || null) : existing.sector,
                    natureOfBusiness: data.nature_of_business != null ? (data.nature_of_business || null) : existing.natureOfBusiness,
                    address1: data.address1 != null ? (data.address1 || null) : existing.address1,
                    address2: data.address2 != null ? (data.address2 || null) : existing.address2,
                    city: data.city != null ? (data.city || null) : existing.city,
                    state: data.state != null ? (data.state || null) : existing.state,
                    zip: data.zip != null ? (data.zip || null) : existing.zip,
                    currency: data.currency != null ? (data.currency || null) : existing.currency,
                    financialYear: data.financial_year != null ? (data.financial_year || null) : existing.financialYear,
                    logo: data.logo != null ? (data.logo || null) : existing.logo,
                    logoFileId: data.logo_file_id != null ? (data.logo_file_id || null) : existing.logoFileId,
                    isMain: data.is_main != null ? data.is_main : existing.isMain,
                    isActive: data.is_active != null ? data.is_active : existing.isActive,
                    updatedAt: new Date(),
                },
                include: entityInclude,
            });

            callback(null, {
                legal_entity: mapLegalEntity(updated),
                success: true,
                message: 'Legal entity updated successfully.',
            });
        } catch (e) {
            console.error('UpdateLegalEntity Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteLegalEntity: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!isValidId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const existing = await prisma.legalEntities.findFirst({
                where: { id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Legal entity not found.',
                });
            }

            await prisma.legalEntities.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Legal entity deleted successfully.',
            });
        } catch (e) {
            console.error('DeleteLegalEntity Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ================================================================== */
    /* Signatories                                                         */
    /* ================================================================== */

    CreateSignatory: async (call, callback) => {
        try {
            const data = call.request;
            if (!isValidId(data.legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const legalEntity = await prisma.legalEntities.findFirst({
                where: { id: data.legal_entity_id, deletedAt: null },
            });
            if (!legalEntity) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Legal entity not found.',
                });
            }

            const signatory = await prisma.legalEntitySignatories.create({
                data: {
                    legalEntityId: data.legal_entity_id,
                    fullName: data.full_name,
                    fatherName: data.father_name || null,
                    designation: data.designation || null,
                    email: data.email || null,
                    address1: data.address1 || null,
                    address2: data.address2 || null,
                    city: data.city || null,
                    state: data.state || null,
                    zip: data.zip || null,
                    country: data.country || null,
                    deletedAt: null,
                },
            });

            callback(null, {
                signatory: mapSignatory(signatory),
                success: true,
                message: 'Signatory added successfully.',
            });
        } catch (e) {
            console.error('CreateSignatory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListSignatories: async (call, callback) => {
        try {
            const { legal_entity_id } = call.request;
            if (!isValidId(legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const signatories = await prisma.legalEntitySignatories.findMany({
                where: { legalEntityId: legal_entity_id, deletedAt: null },
                orderBy: { createdAt: 'asc' },
            });

            callback(null, {
                signatories: signatories.map(mapSignatory),
                success: true,
                message: 'Signatories listed successfully.',
            });
        } catch (e) {
            console.error('ListSignatories Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateSignatory: async (call, callback) => {
        try {
            const data = call.request;
            if (!isValidId(data.id) || !isValidId(data.legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid signatory or legal entity id.',
                });
            }

            const existing = await prisma.legalEntitySignatories.findFirst({
                where: { id: data.id, legalEntityId: data.legal_entity_id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Signatory not found.',
                });
            }

            const updated = await prisma.legalEntitySignatories.update({
                where: { id: data.id },
                data: {
                    fullName: data.full_name != null ? data.full_name : existing.fullName,
                    fatherName: data.father_name != null ? (data.father_name || null) : existing.fatherName,
                    designation: data.designation != null ? (data.designation || null) : existing.designation,
                    email: data.email != null ? (data.email || null) : existing.email,
                    address1: data.address1 != null ? (data.address1 || null) : existing.address1,
                    address2: data.address2 != null ? (data.address2 || null) : existing.address2,
                    city: data.city != null ? (data.city || null) : existing.city,
                    state: data.state != null ? (data.state || null) : existing.state,
                    zip: data.zip != null ? (data.zip || null) : existing.zip,
                    country: data.country != null ? (data.country || null) : existing.country,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                signatory: mapSignatory(updated),
                success: true,
                message: 'Signatory updated successfully.',
            });
        } catch (e) {
            console.error('UpdateSignatory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteSignatory: async (call, callback) => {
        try {
            const { id, legal_entity_id } = call.request;
            if (!isValidId(id) || !isValidId(legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid signatory or legal entity id.',
                });
            }

            const existing = await prisma.legalEntitySignatories.findFirst({
                where: { id, legalEntityId: legal_entity_id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Signatory not found.',
                });
            }

            await prisma.legalEntitySignatories.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Signatory deleted successfully.',
            });
        } catch (e) {
            console.error('DeleteSignatory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ================================================================== */
    /* Bank Details                                                        */
    /* ================================================================== */

    CreateBankDetail: async (call, callback) => {
        try {
            const data = call.request;
            if (!isValidId(data.legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const legalEntity = await prisma.legalEntities.findFirst({
                where: { id: data.legal_entity_id, deletedAt: null },
            });
            if (!legalEntity) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Legal entity not found.',
                });
            }

            const bankDetail = await prisma.legalEntityBanks.create({
                data: {
                    legalEntityId: data.legal_entity_id,
                    bankName: data.bank_name,
                    accountNumber: data.account_number,
                    ifscCode: data.ifsc_code || null,
                    branch: data.branch || null,
                    establishmentId: data.establishment_id || null,
                    deletedAt: null,
                },
            });

            callback(null, {
                bank_detail: mapBankDetail(bankDetail),
                success: true,
                message: 'Bank detail added successfully.',
            });
        } catch (e) {
            console.error('CreateBankDetail Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListBankDetails: async (call, callback) => {
        try {
            const { legal_entity_id } = call.request;
            if (!isValidId(legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid legal entity id.',
                });
            }

            const bankDetails = await prisma.legalEntityBanks.findMany({
                where: { legalEntityId: legal_entity_id, deletedAt: null },
                orderBy: { createdAt: 'asc' },
            });

            callback(null, {
                bank_details: bankDetails.map(mapBankDetail),
                success: true,
                message: 'Bank details listed successfully.',
            });
        } catch (e) {
            console.error('ListBankDetails Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateBankDetail: async (call, callback) => {
        try {
            const data = call.request;
            if (!isValidId(data.id) || !isValidId(data.legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid bank detail or legal entity id.',
                });
            }

            const existing = await prisma.legalEntityBanks.findFirst({
                where: { id: data.id, legalEntityId: data.legal_entity_id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Bank detail not found.',
                });
            }

            const updated = await prisma.legalEntityBanks.update({
                where: { id: data.id },
                data: {
                    bankName: data.bank_name != null ? data.bank_name : existing.bankName,
                    accountNumber: data.account_number != null ? data.account_number : existing.accountNumber,
                    ifscCode: data.ifsc_code != null ? (data.ifsc_code || null) : existing.ifscCode,
                    branch: data.branch != null ? (data.branch || null) : existing.branch,
                    establishmentId: data.establishment_id != null ? (data.establishment_id || null) : existing.establishmentId,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                bank_detail: mapBankDetail(updated),
                success: true,
                message: 'Bank detail updated successfully.',
            });
        } catch (e) {
            console.error('UpdateBankDetail Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteBankDetail: async (call, callback) => {
        try {
            const { id, legal_entity_id } = call.request;
            if (!isValidId(id) || !isValidId(legal_entity_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid bank detail or legal entity id.',
                });
            }

            const existing = await prisma.legalEntityBanks.findFirst({
                where: { id, legalEntityId: legal_entity_id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Bank detail not found.',
                });
            }

            await prisma.legalEntityBanks.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Bank detail deleted successfully.',
            });
        } catch (e) {
            console.error('DeleteBankDetail Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('legal-entity-service');
    const server = new grpc.Server();
    server.addService(legalEntityProto.LegalEntityService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[legal-entity-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[legal-entity-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[legal-entity-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[legal-entity-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[legal-entity-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[legal-entity-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[legal-entity-service] Fatal error:', err);
    process.exit(1);
});