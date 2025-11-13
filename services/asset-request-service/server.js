import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.ASSET_REQ_SERVICE_PORT || 50065);
const assetRequestProto = loadProto('asset_request');

const impl = {
    CreateAssetRequest: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.category_id || !data.model_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, category_id and model_id are required.',
                });
            }

            const existing = await prisma.assetRequest.findFirst({
                where: {
                    organizationId: data.organization_id,
                    categoriesId: data.category_id,
                    modelId: data.model_id,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset request already exists',
                });
            }


            const organization = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            });
            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const category = await prisma.assetCategories.findUnique({
                where: { id: data.category_id },
            });
            if (!category) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset category not found',
                });
            }

            const model = await prisma.assetModels.findUnique({
                where: { id: data.model_id },
            });
            if (!model) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset model not found',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                categoriesId: data.category_id,
                modelId: data.model_id,

                employee: {
                    connect: { id: data.employee_id }
                },

                approvedBy: data.approved_by
                    ? { connect: { id: data.approved_by } }
                    : undefined,

                reason: data.reason,
                quantity: data.quantity ?? 1,
                priority: data.priority ?? "Medium",
                status: data.status ?? "Pending",

                approvedAt: data.approved_at
                    ? new Date(data.approved_at).toISOString()
                    : null,

                rejectionReason: data.rejection_reason || null,

                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            const created = await prisma.assetRequest.create({
                data: mappedData,
                include: {
                    employee: true,
                    approvedBy: true,
                },
            });

            callback(null, { request: mapAssetRequest(created) });

        } catch (e) {
            console.error('❌ CreateAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },


    GetAssetRequest: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset request ID format',
                });
            }

            const model = await prisma.assetRequest.findUnique({
                where: { id },
                include: {
                    employee: true,
                    approvedBy: true,
                },
            });
            if (!model || model.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found',
                });
            }

            callback(null, { request: mapAssetRequest(model) });
        } catch (e) {
            console.error('❌ GetAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    ListAssetRequests: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = "",
                sort_by = "created_at",
                sort_order = "desc",
            } = call.request;

            const skip = (page - 1) * limit;

            // MAP snake_case API fields → Prisma camelCase
            const SORT_MAP = {
                created_at: "createdAt",
                updated_at: "updatedAt",
                approved_at: "approvedAt",
                deleted_at: "deletedAt",
                priority: "priority",
                status: "status",
            };

            const prismaSortBy = SORT_MAP[sort_by] ?? "createdAt";

            // WHERE conditions
            let where = {
                deletedAt: null,
            };

            if (organization_id) {
                where.organizationId = organization_id;
            }

            if (search) {
                where.OR = [
                    { reason: { contains: search, mode: "insensitive" } },
                    { rejectionReason: { contains: search, mode: "insensitive" } },
                    { priority: { contains: search, mode: "insensitive" } },
                    { status: { contains: search, mode: "insensitive" } },
                ];
            }

            const models = await prisma.assetRequest.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    [prismaSortBy]: sort_order,
                },
                include: {
                    employee: true,
                    approvedBy: true,
                },
            });

            const count = await prisma.assetRequest.count({ where });

            callback(null, {
                requests: models.map(mapAssetRequest),
                total: count,
                page,
                limit,
            });

        } catch (e) {
            console.error("❌ ListAssetRequests Error:", e);
            callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    UpdateAssetRequest: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset request ID format',
                });
            }

            const clean = (val) =>
                val === "" || val === undefined ? undefined : val;

            const cleanDate = (val) =>
                val && val !== "" ? new Date(val) : undefined; // keep undefined to skip update

            // Check if asset request exists
            const existing = await prisma.assetRequest.findFirst({
                where: { id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found',
                });
            }

            const updated = await prisma.assetRequest.update({
                where: { id },
                data: {
                    organizationId: clean(call.request.organization_id),
                    categoriesId: clean(call.request.category_id),
                    modelId: clean(call.request.model_id),

                    // 🔹 Update employeeId only if provided
                    employeeId: clean(call.request.employee_id),

                    // 🔹 Update approvedById only if provided
                    approvedById: clean(call.request.approved_by),

                    reason: clean(call.request.reason),
                    quantity: call.request.quantity ?? undefined,
                    priority: clean(call.request.priority),
                    status: clean(call.request.status),

                    approvedAt: cleanDate(call.request.approved_at),

                    rejectionReason:
                        call.request.rejection_reason === "null"
                            ? null
                            : clean(call.request.rejection_reason),

                    updatedAt: new Date(),
                },
            });

            callback(null, { request: mapAssetRequest(updated) });

        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },


    DeleteAssetRequest: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset request ID format',
                });
            }

            await prisma.assetRequest.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Asset request deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },


};

function mapAssetRequest(r) {
    return {
        id: r.id,
        organization_id: r.organizationId,
        category_id: r.categoriesId,
        model_id: r.modelId,
        employee_id: r.employeeId,
        approved_by: r.approvedById ?? "",
        reason: r.reason,
        quantity: r.quantity,
        priority: r.priority,
        status: r.status,
        approved_at: r.approvedAt?.toISOString() ?? "",
        rejection_reason: r.rejectionReason ?? "",
        created_at: r.createdAt?.toISOString() ?? "",
        updated_at: r.updatedAt?.toISOString() ?? "",
        deleted_at: r.deletedAt?.toISOString() ?? "",

    };
}

// -----------------------------
// Server
// -----------------------------
async function main() {
    const server = new grpc.Server();
    server.addService(assetRequestProto.AssetRequestService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[asset-requests-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-requests-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-requests-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-requests-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[asset-requests-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[asset-requests-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-requests-service] Fatal error:', err);
    process.exit(1);
});
