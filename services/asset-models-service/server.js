import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ASSET_MOD_SERVICE_PORT || 5064);
const assetModelProto = loadProto('asset_models');

const impl = {
    CreateAssetModel: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.category_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and category_id are required.',
                });
            }

            if (!data.brand || !data.model_name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'brand and model_name are required.',
                });
            }

            const existing = await prisma.assetModels.findFirst({
                where: {
                    organizationId: data.organization_id,
                    categoriesId: data.category_id,
                    brand: data.brand,
                    modelName: data.model_name,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset model with this brand and model name already exists.',
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

            const mappedData = {
                organizationId: data.organization_id,
                categoriesId: data.category_id,
                brand: data.brand,
                modelName: data.model_name,
                code: data.code ?? null,
                description: data.description ?? null,
                specs: data.specs ? JSON.parse(data.specs) : null,
                isActive: data.is_active ?? true,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            const created = await prisma.assetModels.create({
                data: mappedData,
                include: {
                    assetCategories: true,
                    organization: true,
                },
            });

            callback(null, {
                model: mapModel(created),
                success: true,
                message: 'Asset model created successfully',
            });
        } catch (e) {
            console.error('❌ CreateAssetModel Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    GetAssetModel: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset model ID format',
                });
            }

            const model = await prisma.assetModels.findUnique({
                where: { id },
                include: {
                    assetCategories: true,
                    organization: true,
                },
            });
            if (!model || model.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset model not found',
                });
            }


            return callback(null, {
                model: mapModel(model),
                success: true,
                message: "Asset model fetched successfully"
            });

        } catch (e) {
            console.error('❌ GetAssetModel Error:', e);
            return callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },


    ListAssetModels: async (call, callback) => {
        try {
            const { organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            // Mapping API -> Prisma fields
            const sortMap = {
                created_at: "createdAt",
                updated_at: "updatedAt",
                name: "name",
                code: "code",
            };

            const prismaSortField = sortMap[sort_by] || "createdAt";

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
                        { brand: { contains: search, mode: 'insensitive' } },
                        { modelName: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }
            const total = await prisma.assetModels.count({ where });
            const models = await prisma.assetModels.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [prismaSortField]: sort_order },
                include: {
                    assetCategories: true,
                    organization: true,
                },
            });

            callback(null, {
                models: models.map(mapModel),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Asset models fetched successfully"
            })
        } catch (e) {
            console.error('❌ ListAssetModel Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateAssetModel: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.assetModels.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset model not found',
                });
            }

            const mappedData = {
                organizationId: data.organization_id ?? existing.organizationId,
                categoriesId: data.category_id ?? existing.categoriesId,
                brand: data.brand ?? existing.brand,
                modelName: data.model_name ?? existing.modelName,
                code: data.code ?? existing.code,
                description: data.description ?? existing.description,
                specs: data.specs ? JSON.parse(data.specs) : existing.specs,
                isActive: data.is_active ?? existing.isActive,
                updatedAt: new Date(),
            };

            const updated = await prisma.assetModels.update({
                where: { id: data.id },
                data: mappedData,
                include: {
                    assetCategories: true,
                    organization: true,
                },
            });

            callback(null, {
                model: mapModel(updated),
                success: true,
                message: 'Asset model updated successfully',
            });
        } catch (e) {
            console.error('❌ UpdateAssetModel Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteAssetModel: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid model id',
                });
            }

            await prisma.assetModels.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Asset model deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAssetModel Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

};

// -----------------------------
// Mapper Function
// -----------------------------
function mapModel(model) {
    return {
        id: model.id,
        organization_id: model.organizationId,
        category_id: model.categoriesId,
        brand: model.brand,
        model_name: model.modelName,
        code: model.code ?? '',
        description: model.description ?? '',
        specs: model.specs ? JSON.stringify(model.specs) : '',
        is_active: model.isActive,
        created_at: model.createdAt?.toISOString() ?? '',
        updated_at: model.updatedAt?.toISOString() ?? '',
        deleted_at: model.deletedAt?.toISOString() ?? '',
    };
}

// -----------------------------
// Server
// -----------------------------
async function main() {
    await checkDbConnection('asset-models-service');
    const server = new grpc.Server();
    server.addService(assetModelProto.AssetModelService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[asset-models-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-models-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-models-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-models-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[asset-models-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[asset-models-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-models-service] Fatal error:', err);
    process.exit(1);
});
