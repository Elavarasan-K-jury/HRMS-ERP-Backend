import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();


const PORT = Number(process.env.ASSET_ASSIGN_SERVICE_PORT || 5067);
const assetAssignmentProto = loadProto('asset_assignment');

const impl = {
    CreateAssetAssignment: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.asset_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and asset_id are required.',
                });
            }

            const existing = await prisma.assetAssignments.findFirst({
                where: {
                    organizationId: data.organization_id,
                    assetId: data.asset_id,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Asset assignment already exists',
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

            const asset = await prisma.assets.findUnique({
                where: { id: data.asset_id },
            });

            if (!asset) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found',
                });
            }

            // Fix date conversion
            const mappedData = {
                organizationId: data.organization_id,
                assetId: data.asset_id,
                employeeId: data.employee_id,
                assignedDate: data.assigned_date ? new Date(data.assigned_date) : null,
                returnDate: data.return_date ? new Date(data.return_date) : null,
                conditionAssign: data.condition_assign,
                status: data.status,
                notes: data.notes,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };

            const created = await prisma.assetAssignments.create({
                data: mappedData,
                include: {
                    organization: true,
                    asset: true,
                }
            });

            await prisma.assetRequest.create({
                data: {
                    organizationId: data.organization_id,
                    assignmentId: created.id,
                    quantity: 1,
                    priority: "MEDIUM",
                    status: "PENDING",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                }
            })

            callback(null, {
                assetAssignment: mapAssetAssignment(created),
                success: true,
                message: 'Asset assignment created successfully',
            });

        } catch (error) {
            console.error('❌ CreateAssetAssignment Error:', error);
            callback({
                code: grpc.status.INTERNAL,
                message: error.message,
            });
        }
    },


    GetAssetAssignment: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset assignment ID format',
                });
            }

            const assignment = await prisma.assetAssignments.findUnique({
                where: { id },
                include: {
                    organization: true,
                    asset: true,
                },
            });
            if (!assignment || assignment.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset assignment not found',
                });
            }
            callback(null, {
                assetAssignment: mapAssetAssignment(assignment),
                success: true,
                message: "Asset assignment fetched successfully"
            });
        } catch (error) {
            callback({
                code: grpc.status.INTERNAL,
                message: error.message,
            });
            console.error('❌ GetAssetAssignment Error:', error);
        }
    },

    ListAssetAssignment: async (call, callback) => {
        try {
            const {
                organization_id,
                search = "",
                page = 1,
                limit = 10,
                sort_by = "created_at",
                sort_order = "desc"
            } = call.request;

            const skip = (page - 1) * limit;

            // API → Prisma field map
            const sortMap = {
                created_at: "createdAt",
                updated_at: "updatedAt",
                assigned_date: "assignedDate",
                return_date: "returnDate",
                status: "status"
            };

            const prismaSortField = sortMap[sort_by] || "createdAt";

            // WHERE FILTER
            let where = { deletedAt: null };

            if (organization_id) {
                where.organizationId = organization_id;
            }

            if (search) {
                where.OR = [
                    { status: { contains: search, mode: "insensitive" } },
                ];
            }

            // Fetch assignments
            const assignments = await prisma.assetAssignments.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [prismaSortField]: sort_order },
                include: {
                    organization: true,
                    asset: true,
                }
            });

            // Count for pagination
            const total = await prisma.assetAssignments.count({ where });

            callback(null, {
                assignments: assignments.map(mapAssetAssignment),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Asset assignments fetched successfully",
            });

        } catch (error) {
            console.error("❌ ListAssetAssignment Error:", error);
            callback({
                code: grpc.status.INTERNAL,
                message: error.message,
            });
        }
    },

    UpdateAssetAssignment: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.assetAssignments.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset assignment not found',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                assetId: data.asset_id,
                employeeId: data.employee_id,
                assignedDate: new Date(data.assigned_date),
                returnDate: data.return_date ? new Date(data.return_date) : null,
                conditionAssign: data.condition_assign,
                status: data.status,
                notes: data.notes,
            };

            const updated = await prisma.assetAssignments.update({
                where: { id: data.id },
                data: mappedData,
                include: {
                    organization: true,
                    // asset: true,
                }
            });

            callback(null, {
                assetAssignment: mapAssetAssignment(updated),
                success: true,
                message: 'Asset assignment updated successfully',
            });
        } catch (error) {
            callback({
                code: grpc.status.INTERNAL,
                message: error.message,
            });
            console.error('❌ UpdateAssetAssignment Error:', error);
        }
    },

    DeleteAssetAssignment: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset assignment ID format',
                });
            }

            await prisma.assetAssignments.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Asset assignment deleted successfully',
            });
        } catch (e) {
            console.error('❌ DeleteAssetAssignment Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

};

function mapAssetAssignment(assetAssignment) {
    return {
        id: assetAssignment.id,
        organization_id: assetAssignment.organizationId,
        asset_id: assetAssignment.assetId,
        employee_id: assetAssignment.employeeId,
        assigned_date: assetAssignment.assignedDate?.toISOString() ?? '',
        return_date: assetAssignment.returnDate?.toISOString() ?? '',
        condition_assign: assetAssignment.conditionAssign
            ? JSON.stringify(assetAssignment.conditionAssign)
            : "",
        status: assetAssignment.status,
        notes: assetAssignment.notes,
        created_at: assetAssignment.createdAt?.toISOString() ?? '',
        updated_at: assetAssignment.updatedAt?.toISOString() ?? '',
        deleted_at: assetAssignment.deletedAt?.toISOString() ?? '',
    };
}
// -----------------------------
// Server
// -----------------------------
async function main() {
    await checkDbConnection('asset-assignment-service');
    const server = new grpc.Server();
    server.addService(assetAssignmentProto.AssetAssignmentService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[asset-assignment-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-assignment-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-assignment-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-assignment-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[asset-assignment-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[asset-assignment-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-assignment-service] Fatal error:', err);
    process.exit(1);
});
