import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ASSETS_SERVICE_PORT || 5065);
const assetsProto = loadProto('assets');

// -------------------------------------------------------
// Phase 02: Authoritative Asset Lifecycle
// -------------------------------------------------------
const VALID_ASSET_STATUSES = [
    'AVAILABLE', 'ASSIGNED', 'IN_REPAIR',
    'DAMAGED', 'LOST', 'RETIRED', 'DISPOSED',
];

const INITIAL_ASSET_STATUSES = ['AVAILABLE', 'IN_REPAIR', 'RETIRED'];

// Allowed transitions: from → [to, ...]
const ASSET_STATUS_TRANSITIONS = {
    AVAILABLE: ['ASSIGNED', 'IN_REPAIR', 'RETIRED'],
    ASSIGNED: ['AVAILABLE', 'IN_REPAIR', 'DAMAGED', 'LOST'],
    IN_REPAIR: ['AVAILABLE', 'ASSIGNED', 'RETIRED'],
    DAMAGED: ['IN_REPAIR', 'RETIRED'],
    LOST: ['RETIRED'],
    RETIRED: ['DISPOSED'],
    DISPOSED: [],
};

function normalizeAssetStatus(status) {
    if (!status) return 'AVAILABLE';
    const upper = status.toUpperCase();
    if (upper === 'AVAILABLE' || upper === 'ACTIVE') return 'AVAILABLE';
    return upper;
}

function isValidAssetStatusTransition(from, to) {
    const allowed = ASSET_STATUS_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
}

const impl = {
    CreateAsset: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.category_id || !data.model_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, category_id and model_id are required.',
                });
            }

            // Validate category belongs to the same organization
            const category = await prisma.assetCategories.findUnique({
                where: { id: data.category_id },
            });
            if (!category || category.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found.',
                });
            }
            if (category.organizationId !== data.organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Category does not belong to the specified organization.',
                });
            }

            // Validate model belongs to the same category and organization
            const model = await prisma.assetModels.findUnique({
                where: { id: data.model_id },
            });
            if (!model || model.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset model not found.',
                });
            }
            if (model.organizationId !== data.organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Model does not belong to the specified organization.',
                });
            }
            if (model.categoriesId !== data.category_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Model does not belong to the specified category.',
                });
            }

            // Check duplicate serial_number within organization (if provided)
            if (data.serial_number) {
                const existingSerial = await prisma.assets.findFirst({
                    where: {
                        organizationId: data.organization_id,
                        serialNumber: data.serial_number,
                        deletedAt: null,
                    },
                });
                if (existingSerial) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset with this serial number already exists in this organization.',
                    });
                }
            }

            // Check duplicate asset_tag within organization (if provided)
            const effectiveAssetTag = data.generated_asset_id || data.asset_tag;
            if (effectiveAssetTag) {
                const existingTag = await prisma.assets.findFirst({
                    where: {
                        organizationId: data.organization_id,
                        assetTag: effectiveAssetTag,
                        deletedAt: null,
                    },
                });
                if (existingTag) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset with this asset tag already exists in this organization.',
                    });
                }
            }

            // Date validation
            if (!data.purchase_date) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'purchase_date is required.',
                });
            }
            const purchaseDate = new Date(data.purchase_date);
            if (isNaN(purchaseDate.getTime())) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid purchase_date format.',
                });
            }

            let warrantyExpire = null;
            if (data.warranty_expire) {
                warrantyExpire = new Date(data.warranty_expire);
                if (isNaN(warrantyExpire.getTime())) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Invalid warranty_expire format.',
                    });
                }
                if (warrantyExpire < purchaseDate) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'warranty_expire cannot be before purchase_date.',
                    });
                }
            }

            const organization = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            });

            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found.',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                categoriesId: data.category_id,
                modelId: data.model_id,
                serialNumber: data.serial_number,
                assetTag: data.generated_asset_id || data.asset_tag,
                userName: data.user_name,
                password: data.password,
                purchaseDate,
                warrantyExpire,
                location: data.location,
                status: normalizeAssetStatus(data.status),
                customAttributeValues: data.custom_attribute_values ? (() => { try { return JSON.parse(data.custom_attribute_values); } catch { return null; } })() : null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };

            const created = await prisma.assets.create({
                data: mappedData,
                include: {
                    assetModel: true,
                    organization: true,
                },
            });
            callback(null, {
                asset: mapAsset(created),
                success: true,
                message: "Asset created successfully"
            });
        } catch (e) {
            console.error('❌ CreateAsset Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            })
        }
    },

    GetAsset: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset ID format',
                });
            }

            const asset = await prisma.assets.findUnique({
                where: { id },
                include: {
                    assetModel: true,
                    organization: true,
                },
            });
            if (!asset || asset.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found',
                });
            }

            callback(null, {
                asset: mapAsset(asset),
                success: true,
                message: "Asset fetched successfully"
            });
        } catch (e) {
            console.error('❌ GetAsset Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListAssets: async (call, callback) => {
        try {
            const {
                organization_id,
                category_id,
                model_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            // Phase 00: organization_id is required for data isolation
            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            let where = {
                deletedAt: null,
                organizationId: organization_id,
            };
            if (category_id) {
                where = {
                    ...where,
                    categoriesId: category_id,
                };
            }
            if (model_id) {
                where = {
                    ...where,
                    modelId: model_id,
                };
            }
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { userName: { contains: search, mode: 'insensitive' } },
                        { serialNumber: { contains: search, mode: 'insensitive' } },
                        { assetTag: { contains: search, mode: 'insensitive' } },
                        {
                            assetCategory: {
                                name: { contains: search, mode: 'insensitive' }
                            }
                        },
                        {
                            assetModel: {
                                modelName: { contains: search, mode: 'insensitive' }
                            }
                        },
                    ],
                };
            }

            const validSortFields = {
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };
            const orderBy = sort_by && sort_order ? {
                [validSortFields[sort_by]]: sort_order,
            } : {}

            let paginate = {}
            if (page && limit) {
                const skip = (page - 1) * limit;
                paginate = {
                    skip,
                    take: limit
                }
            }

            const assets = await prisma.assets.findMany({
                where,
                orderBy,
                ...paginate,
                include: {
                    assetcondition: true,
                    assetAssignment: true,
                    assetCategory: true,
                    assetModel: true,
                    organization: true,
                },
            });

            const total = await prisma.assets.count({
                where,
            });

            callback(null, {
                assets: assets.map(mapAsset),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Asset list fetched successfully"
            });
        } catch (e) {
            console.error('❌ ListAssets Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateAsset: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.assets.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found',
                });
            }

            // Validate category belongs to the same organization if changed
            if (data.category_id && data.category_id !== existing.categoriesId) {
                const category = await prisma.assetCategories.findUnique({
                    where: { id: data.category_id },
                });
                if (!category || category.deletedAt) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Asset category not found.',
                    });
                }
                if (category.organizationId !== existing.organizationId) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Category does not belong to the asset\'s organization.',
                    });
                }
            }

            // Validate model belongs to the same category and organization if changed
            if (data.model_id && data.model_id !== existing.modelId) {
                const model = await prisma.assetModels.findUnique({
                    where: { id: data.model_id },
                });
                if (!model || model.deletedAt) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Asset model not found.',
                    });
                }
                if (model.organizationId !== existing.organizationId) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Model does not belong to the asset\'s organization.',
                    });
                }
                const categoryId = data.category_id ?? existing.categoriesId;
                if (model.categoriesId !== categoryId) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Model does not belong to the specified category.',
                    });
                }
            }

            // Check duplicate serial_number within organization (if changed)
            if (data.serial_number && data.serial_number !== existing.serialNumber) {
                const dup = await prisma.assets.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                        serialNumber: data.serial_number,
                        deletedAt: null,
                        id: { not: data.id },
                    },
                });
                if (dup) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset with this serial number already exists in this organization.',
                    });
                }
            }

            // Check duplicate asset_tag within organization (if changed)
            if (data.asset_tag && data.asset_tag !== existing.assetTag) {
                const dup = await prisma.assets.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                assetTag: effectiveAssetTag,
                        deletedAt: null,
                        id: { not: data.id },
                    },
                });
                if (dup) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset with this asset tag already exists in this organization.',
                    });
                }
            }

            // Phase 02: Validate status transition
            if (data.status) {
                const newStatus = normalizeAssetStatus(data.status);
                const currentStatus = normalizeAssetStatus(existing.status);
                if (newStatus !== currentStatus) {
                    if (!VALID_ASSET_STATUSES.includes(newStatus)) {
                        return callback({
                            code: grpc.status.INVALID_ARGUMENT,
                            message: `Invalid asset status: ${newStatus}. Valid statuses: ${VALID_ASSET_STATUSES.join(', ')}`,
                        });
                    }
                    if (!isValidAssetStatusTransition(currentStatus, newStatus)) {
                        return callback({
                            code: grpc.status.FAILED_PRECONDITION,
                            message: `Cannot transition asset from ${currentStatus} to ${newStatus}.`,
                        });
                    }
                }
            }

            const mappedData = {
                organizationId: existing.organizationId,
                categoriesId: data.category_id ?? existing.categoriesId,
                modelId: data.model_id ?? existing.modelId,
                serialNumber: data.serial_number ?? existing.serialNumber,
                assetTag: data.asset_tag ?? existing.assetTag,
                userName: data.user_name ?? existing.userName,
                password: data.password !== undefined ? data.password : existing.password,
                purchaseDate: data.purchase_date ? new Date(data.purchase_date) : existing.purchaseDate,
                warrantyExpire: data.warranty_expire ? new Date(data.warranty_expire) : existing.warrantyExpire,
                location: data.location ?? existing.location,
                status: data.status ? normalizeAssetStatus(data.status) : existing.status,
                updatedAt: new Date(),
            };

            const updated = await prisma.assets.update({
                where: { id: data.id },
                data: mappedData,
                include: {
                    assetModel: true,
                    organization: true,
                },
            });
            callback(null, {
                asset: mapAsset(updated),
                success: true,
                message: "Asset updated successfully"
            });
        } catch (e) {
            console.error('❌ UpdateAsset Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteAsset: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset ID format',
                });
            }

            const asset = await prisma.assets.findUnique({
                where: { id },
                include: {
                    assetAssignment: {
                        where: { deletedAt: null, status: 'Active' },
                        select: { id: true },
                    },
                },
            });

            if (!asset || asset.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found',
                });
            }

            if (asset.assetAssignment && asset.assetAssignment.length > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot delete asset: has active assignments. Return/unassign all assets first.',
                });
            }

            await prisma.assets.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Asset deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAsset Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

};

function mapAsset(asset) {
    return {
        /* --------------------------------------------------
           CORE IDENTIFIERS
        -------------------------------------------------- */
        id: asset.id,
        organization_id: asset.organizationId,

        serial_number: asset.serialNumber,
        asset_tag: asset.assetTag,

        status: normalizeAssetStatus(asset.status),
        location: asset.location ?? "",
        category_id: asset.categoriesId ?? asset.assetCategory?.id ?? null,
        model_id: asset.modelId ?? asset.assetModel?.id ?? null,
        /* --------------------------------------------------
           CREDENTIALS — Phase 00: password stripped from all
           responses. Only user_name is exposed for display.
           Password should only be retrieved via an explicit,
           authorized credential-retrieval endpoint if needed.
        -------------------------------------------------- */
        credentials: {
            user_name: asset.userName ?? "",
        },

        purchase_date: asset.purchaseDate?.toISOString() ?? null,
        warranty_expire: asset.warrantyExpire?.toISOString() ?? null,
        created_at: asset.createdAt?.toISOString() ?? null,
        updated_at: asset.updatedAt?.toISOString() ?? null,
        deleted_at: asset.deletedAt?.toISOString() ?? null,
        custom_attribute_values: asset.customAttributeValues ? JSON.stringify(asset.customAttributeValues) : '',

        /* --------------------------------------------------
           CATEGORY
        -------------------------------------------------- */
        category: asset.assetCategory
            ? {
                id: asset.assetCategory.id,
                name: asset.assetCategory.name,
                code: asset.assetCategory.code,
                description: asset.assetCategory.description,
                is_active: asset.assetCategory.isActive,
            }
            : null,

        /* --------------------------------------------------
           MODEL
        -------------------------------------------------- */
        model: asset.assetModel
            ? {
                id: asset.assetModel.id,
                brand: asset.assetModel.brand,
                model_name: asset.assetModel.modelName,
                code: asset.assetModel.code,
                description: asset.assetModel.description,
                specs: asset.assetModel.specs,
                is_active: asset.assetModel.isActive,
            }
            : null,

        /* --------------------------------------------------
           ORGANIZATION (MINIMAL, SAFE)
        -------------------------------------------------- */
        organization: asset.organization
            ? {
                id: asset.organization.id,
                name: asset.organization.name,
                domain: asset.organization.domain,
                industry: asset.organization.industry,
            }
            : null,

        /* --------------------------------------------------
           ASSIGNMENTS
        -------------------------------------------------- */
        assignments: asset.assetAssignment?.map(a => ({
            id: a.id,
            employee_id: a.employeeId ?? null,
            assigned_at: a.assignedDate?.toISOString() ?? null,
            returned_at: a.returnDate?.toISOString?.() ?? null,
            status: a.status ?? null,
        })) ?? [],

        /* --------------------------------------------------
           CONDITIONS / HISTORY
        -------------------------------------------------- */
        conditions: asset.assetcondition?.map(c => ({
            id: c.id,
            description: c.description ?? null,
            action_taken: c.actionTaken ?? null,
            ratings: c.ratings ?? null,
            status: c.status ?? null,
            recorded_at: c.createdAt?.toISOString() ?? null,
        })) ?? [],

        /* --------------------------------------------------
           META
        -------------------------------------------------- */
        meta: {
            has_assignments: asset.assetAssignment?.length > 0,
            is_deleted: !!asset.deletedAt,
        },
    };
}


// -----------------------------
// Server
// -----------------------------
async function main() {
    await checkDbConnection('assets-service');
    const server = new grpc.Server();
    server.addService(assetsProto.AssetService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[assets-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[assets-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[assets-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[assets-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[assets-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[assets-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[assets-service] Fatal error:', err);
    process.exit(1);
});
