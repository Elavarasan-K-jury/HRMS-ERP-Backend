import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ASSETS_SERVICE_PORT || 5065);
const assetsProto = loadProto('assets');

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

            const existing = await prisma.assets.findFirst({
                where: {
                    OR: [
                        { serialNumber: data.serial_number },
                        {
                            AND: [
                                { organizationId: data.organization_id },
                                { assetTag: data.asset_tag }
                            ]
                        }
                    ],
                    deletedAt: null,
                },
            });


            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset already exists',
                });
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

            const category = await prisma.assetCategories.findUnique({
                where: { id: data.category_id },
            });

            if (!category) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found.',
                });
            }

            const model = await prisma.assetModels.findUnique({
                where: { id: data.model_id },
            });

            if (!model) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset model not found.',
                });
            }
            const mappedData = {
                organizationId: data.organization_id,
                categoriesId: data.category_id,
                modelId: data.model_id,
                serialNumber: data.serial_number,
                assetTag: data.asset_tag,
                userName: data.user_name,
                password: data.password,
                purchaseDate: new Date(data.purchase_date),
                warrantyExpire: new Date(data.warranty_expire),
                location: data.location,
                status: data.status,
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


            let where = {
                deletedAt: null,
            };
            if (organization_id) {
                where = {
                    ...where,
                    organizationId: organization_id,
                };
            }
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

            const mappedData = {
                organizationId: data.organization_id ?? existing.organizationId,
                categoriesId: data.category_id ?? existing.categoriesId,
                modelId: data.model_id ?? existing.modelId,
                serialNumber: data.serial_number ?? existing.serialNumber,
                assetTag: data.asset_tag ?? existing.assetTag,
                userName: data.user_name ?? existing.userName,
                password: data.password ?? existing.password,
                purchaseDate: data.purchase_date ?? existing.purchaseDate,
                warrantyExpire: data.warranty_expire ?? existing.warrantyExpire,
                location: data.location ?? existing.location,
                status: data.status ?? existing.status,
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

        status: asset.status ?? "Available",
        location: asset.location ?? "",
        category_id: asset.category_id,
        model_id: asset.model_id,
        /* --------------------------------------------------
           CREDENTIALS (ONLY IF REQUIRED)
           ⚠️ Consider removing password from list APIs
        -------------------------------------------------- */
        credentials: {
            user_name: asset.userName ?? "",
            password: asset.password ?? "",
        },

        purchase_date: asset.purchaseDate?.toISOString() ?? null,
        warranty_expire: asset.warrantyExpire?.toISOString() ?? null,
        created_at: asset.createdAt?.toISOString() ?? null,
        updated_at: asset.updatedAt?.toISOString() ?? null,
        deleted_at: asset.deletedAt?.toISOString() ?? null,

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
            assigned_at: a.createdAt?.toISOString() ?? null,
            returned_at: a.returnedAt?.toISOString?.() ?? null,
            status: a.status ?? null,
        })) ?? [],

        /* --------------------------------------------------
           CONDITIONS / HISTORY
        -------------------------------------------------- */
        conditions: asset.assetcondition?.map(c => ({
            id: c.id,
            condition: c.condition ?? null,
            notes: c.notes ?? null,
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
