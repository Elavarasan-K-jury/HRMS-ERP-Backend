import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();


const PORT = Number(process.env.ASSET_CAT_SERVICE_PORT || 5063);
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

            const existingName = await prisma.assetCategories.findFirst({
                where: {
                    organizationId: organization_id,
                    name,
                    deletedAt: null,
                },
            });

            if (existingName) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset category name already exists within this organization',
                });
            }

            if (code) {
                const existingCode = await prisma.assetCategories.findFirst({
                    where: {
                        organizationId: organization_id,
                        code,
                        deletedAt: null,
                    },
                });

                if (existingCode) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset category code already exists within this organization',
                    });
                }
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
                message: 'Asset category created successfully',
                success: true,
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

            callback(null, {
                category: mapCategory(category),
                success: true,
                message: "Asset category fetched successfully"
            });
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
            const {
                organization_id,
                page,
                limit,
                search = "",
                sort_by = "created_at",
                sort_order = "desc"
            } = call.request;
            let skip = {}

            if (page && limit) {
                skip = {
                    skip: (page - 1) * limit,
                    take: limit,
                }
            }

            // Mapping API -> Prisma fields
            const sortMap = {
                created_at: "createdAt",
                updated_at: "updatedAt",
                name: "name",
                code: "code",
            };

            const prismaSortField = sortMap[sort_by] || "createdAt";

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

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { description: { contains: search, mode: "insensitive" } },
                ];
            }

            const total = await prisma.assetCategories.count({ where });

            const categories = await prisma.assetCategories.findMany({
                where,
                orderBy: { [prismaSortField]: sort_order },
                ...skip
            });

            callback(null, {
                categories: categories.map(mapCategory),
                total,
                page: page || 1,
                limit: limit || total,
                total_pages: limit ? Math.ceil(total / limit) : 1,
                success: true,
                message: "Asset categories fetched successfully",
            });

        } catch (e) {
            console.error("❌ ListAssetCategories Error:", e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },


    UpdateAssetCategory: async (call, callback) => {
        try {
            const { id, name, code, description, is_active } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const category = await prisma.assetCategories.findUnique({ where: { id } });
            if (!category || category.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found',
                });
            }

            // Check code uniqueness within same org if code is being changed
            if (code && code !== category.code) {
                const existingCode = await prisma.assetCategories.findFirst({
                    where: {
                        organizationId: category.organizationId,
                        code,
                        deletedAt: null,
                        id: { not: id },
                    },
                });
                if (existingCode) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Asset category code already exists within this organization',
                    });
                }
            }

            const updated = await prisma.assetCategories.update({
                where: { id },
                data: {
                    ...(name !== undefined && { name }),
                    ...(code !== undefined && { code }),
                    ...(description !== undefined && { description }),
                    ...(is_active !== undefined && { isActive: is_active }),
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                category: mapCategory(updated),
                success: true,
                message: "Asset category updated successfully"
            });
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

            const category = await prisma.assetCategories.findUnique({
                where: { id },
                include: {
                    assetModels: {
                        where: { deletedAt: null },
                        select: { id: true },
                    },
                },
            });

            if (!category || category.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found',
                });
            }

            if (category.assetModels && category.assetModels.length > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot delete category: has active models. Remove all models first.',
                });
            }

            // Check for active assets referencing this category
            const assetCount = await prisma.assets.count({
                where: { categoriesId: id, deletedAt: null },
            });
            if (assetCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot delete category: has active assets. Remove all assets first.',
                });
            }

            await prisma.assetCategories.update({
                where: { id },
                data: { deletedAt: new Date() },
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
    await checkDbConnection('asset-category-service');
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
