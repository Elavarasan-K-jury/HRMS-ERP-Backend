import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ASSET_CON_SERVICE_PORT || 5068);
const assetConditionProto = loadProto('asset_condition');

const impl = {
    CreateAssetCondition: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.assignment_id || !data.employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, assignment_id and employee_id are required.',
                });
            }

            const existing = await prisma.assetCondition.findFirst({
                where: {
                    organizationId: data.organization_id,
                    assignmentId: data.assignment_id,
                    employeeId: data.employee_id,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset condition already exists',
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

            const mappedData = {
                organizationId: data.organization_id,
                assignmentId: data.assignment_id,
                employeeId: data.employee_id,
                acknowledgedById: data.acknowledged_by,
                reportDate: new Date(data.report_date),
                description: data.description,
                ratings: data.ratings,
                images: data.images,
                actionTaken: data.action_taken,
                acknowledgedDate: data.acknowledged_date ? new Date(data.acknowledged_date) : null,
                status: data.status,
            };

            const created = await prisma.assetCondition.create({
                data: mappedData,
                include: {

                    acknowledgedBy: true,
                },
            });

            return callback(null, {
                condition: mapAssetCondition(created),
                success: true,
                message: 'Asset condition created successfully',
            });
        } catch (error) {
            return callback({
                code: grpc.status.INTERNAL,
                message: error.message,
            });
        }
    },

    GetAssetCondition: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset condition ID format',
                });
            }

            const condition = await prisma.assetCondition.findUnique({
                where: { id },
                include: {
                    acknowledgedBy: true,
                },
            });
            if (!condition || condition.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset condition not found',
                });
            }
            callback(null, {
                condition: mapAssetCondition(condition),
                success: true,
                message: "Asset condition fetched successfully"
            });
        } catch (e) {
            console.error('❌ GetAssetCondition Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListAssetConditions: async (call, callback) => {
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
                acknowledged_at: "acknowledgedAt",
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
                where = {
                    organizationId: organization_id,
                };
            }
            if (search) {
                where = {
                    OR: [
                        {
                            description: {
                                contains: search,
                                mode: "insensitive",
                            },
                        },
                    ],
                };
            }

            const conditions = await prisma.assetCondition.findMany({
                where,
                include: {
                    acknowledgedBy: true,
                },
                orderBy: {
                    [prismaSortBy]: sort_order,
                },
                skip,
                take: limit,
            });

            const total = await prisma.assetCondition.count({ where });

            callback(null, {
                conditions: conditions.map(mapAssetCondition),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Asset conditions fetched successfully",
            });
        } catch (e) {
            console.error('❌ ListAssetConditions Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateAssetCondition: async (call, callback) => {
        try {
            const data = call.request;

            const id = data.id;
            const existing = await prisma.assetCondition.findUnique({
                where: { id: data.id },
            });

            if (!existing || existing.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset condition not found or has been deleted',
                });
            }
            const mappedData = {
                organizationId: call.request.organization_id ?? existing.organizationId,
                assignmentId: call.request.assignment_id ?? existing.assignmentId,
                employeeId: call.request.employee_id ?? existing.employeeId,
                acknowledgedById: call.request.acknowledged_by ?? existing.acknowledgedById,
                reportDate: call.request.report_date ? new Date(call.request.report_date) : existing.reportDate,
                description: call.request.description ?? existing.description,
                ratings: call.request.ratings ?? existing.ratings,
                images: call.request.images ?? existing.images,
                actionTaken: call.request.action_taken ?? existing.actionTaken,
                acknowledgedDate: call.request.acknowledged_date ? new Date(call.request.acknowledged_date) : existing.acknowledgedDate,
                status: call.request.status ?? existing.status,
                updatedAt: new Date(),
            };

            const updated = await prisma.assetCondition.update({
                where: { id },
                data: mappedData,
                include: {
                    acknowledgedBy: true,
                },
            });
            callback(null, {
                condition: mapAssetCondition(updated),
                success: true,
                message: 'Asset condition updated successfully',
            });
        } catch (e) {
            console.error('❌ UpdateAssetCondition Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteAssetCondition: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset condition ID format',
                });
            }

            await prisma.assetCondition.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Asset condition deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAssetCondition Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

function mapAssetCondition(assetCondition) {
    return {
        id: assetCondition.id,
        organization_id: assetCondition.organizationId,
        assignment_id: assetCondition.assignmentId,
        employee_id: assetCondition.employeeId,
        acknowledged_by: assetCondition.acknowledgedById || null,
        report_date: assetCondition.reportDate?.toISOString(),
        description: assetCondition.description,
        ratings: assetCondition.ratings,
        images: assetCondition.images ? JSON.stringify(assetCondition.images) : null,
        action_taken: assetCondition.actionTaken,
        acknowledged_date: assetCondition.acknowledgedDate?.toISOString() || null,
        status: assetCondition.status,
        created_at: assetCondition.createdAt.toISOString(),
        updated_at: assetCondition.updatedAt.toISOString(),
        deleted_at: assetCondition.deletedAt?.toISOString() || null,
    };
}
async function main() {
    await checkDbConnection('asset-condition-service');
    const server = new grpc.Server();
    server.addService(assetConditionProto.AssetConditionService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[asset-condition-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-condition-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-condition-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-condition-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[asset-condition-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[asset-condition-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-condition-service] Fatal error:', err);
    process.exit(1);
});
