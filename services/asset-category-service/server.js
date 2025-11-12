import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.ASSET_CAT_SERVICE_PORT || 50063);
const assetCategoryProto = loadProto('asset_categories');

const impl = {
    CreateAssetCategory: async (call, callback) => {
        try {
            const { organization_id, name, code, description, is_active } = call.request;

            if (!organization_id || !name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required',
                });
            }

            const existing = await prisma.assetCategories.findFirst({
                where: {
                    organizationId: organization_id,
                    name,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset category already exists',
                });
            }

            const organization = await prisma.organizations.findUnique({
                where: { id: organization_id },
            });

            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const category = await prisma.assetCategories.create({
                data: {
                    organizationId: organization_id,
                    name,
                    code: code ?? null,
                    description: description ?? null,
                    isActive: is_active ?? true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                category: mapCategory(category),
            });
        } catch (e) {
            console.error('❌ CreateAssetCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    GetAssetCategory: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const category = await prisma.assetCategories.findUnique({
                where: { id },
            });

            if (!category || category.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found',
                });
            }

            callback(null, { category: mapCategory(category) });
        } catch (e) {
            console.error('❌ GetAssetCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListAssetCategories: async (call, callback) => {
        try {
            const { organization_id } = call.request;

            const categories = await prisma.assetCategories.findMany({
                where: {
                    organizationId: organization_id,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
            });

            callback(null, {
                categories: categories.map(mapCategory),
            });
        } catch (e) {
            console.error('❌ ListAssetCategories Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateAssetCategory: async (call, callback) => {
        try {
            const { id, organization_id, name, code, description, is_active } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const organization = await prisma.organizations.findUnique({
                where: { id: organization_id },
            });
            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const updated = await prisma.assetCategories.update({
                where: { id },
                data: {
                    organizationId: organization_id,
                    name,
                    code: code ?? null,
                    description: description ?? null,
                    isActive: is_active,
                    updatedAt: new Date(),
                },
            });

            callback(null, { category: mapCategory(updated) });
        } catch (e) {
            console.error('❌ UpdateAssetCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteAssetCategory: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            await prisma.assetCategories.update({
                where: { id },
                data: { deletedAt: new Date()},
            });

            callback(null, {
                success: true,
                message: 'Asset category deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAssetCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

// -----------------------------
// Mapper
// -----------------------------
function mapCategory(category) {
    return {
        id: category.id,
        organization_id: category.organizationId,
        name: category.name,
        code: category.code ?? '',
        description: category.description ?? '',
        is_active: category.isActive,
        created_at: category.createdAt?.toISOString() ?? '',
        updated_at: category.updatedAt?.toISOString() ?? '',
        deleted_at: category.deletedAt?.toISOString() ?? '',
    };
}

// -----------------------------
// Server
// -----------------------------
async function main() {
    const server = new grpc.Server();
    server.addService(assetCategoryProto.AssetCategoryService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[asset-category-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-category-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-category-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-category-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[asset-category-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[asset-category-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-category-service] Fatal error:', err);
    process.exit(1);
});
