import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.ASSETS_SERVICE_PORT || 50065);
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
                purchaseDate: data.purchase_date,
                warrantyExpire: data.warranty_expire,
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
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            let where = {
                deletedAt: null,
            };
            if (organization_id) {
                where = {
                    organizationId: organization_id,
                };
            }
            if (search) {
                where = {
                    OR: [
                        { serialNumber: { contains: search, mode: 'insensitive' } },
                        { assetTag: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                created_at: 'createdAt',
                updated_at: 'updatedAt',
                deleted_at: 'deletedAt',
            };
            const orderBy = {
                [validSortFields[sort_by]]: sort_order,
            };

            const assets = await prisma.assets.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: {
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
        id: asset.id,
        organization_id: asset.organizationId,
        category_id: asset.categoriesId,
        model_id: asset.modelId,
        serial_number: asset.serialNumber,
        asset_tag: asset.assetTag,
        user_name: asset.userName ?? '',
        password: asset.password ?? '',
        purchase_date: asset.purchaseDate?.toISOString() ?? '',
        warranty_expire: asset.warrantyExpire?.toISOString() ?? '',
        status: asset.status ?? 'Available',
        location: asset.location ? JSON.stringify(asset.location) : '',
        created_at: asset.createdAt?.toISOString() ?? '',
        updated_at: asset.updatedAt?.toISOString() ?? '',
        deleted_at: asset.deletedAt?.toISOString() ?? '',
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
