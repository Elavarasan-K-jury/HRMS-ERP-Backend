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

            // Phase 02: Check no active assignment already exists for this asset
            const activeAssignment = await prisma.assetAssignments.findFirst({
                where: {
                    assetId: data.asset_id,
                    deletedAt: null,
                    status: { in: ['ASSIGNED', 'ASSIGNMENT_PENDING'] },
                },
            });

            if (activeAssignment) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Asset already has an active assignment.',
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

            if (!asset || asset.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found',
                });
            }

            // Phase 02: Asset must be AVAILABLE to assign
            const assetStatus = (asset.status || 'AVAILABLE').toUpperCase();
            if (assetStatus !== 'AVAILABLE') {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot assign asset: current status is ${assetStatus}. Asset must be AVAILABLE.`,
                });
            }

            const normalizedStatus = 'ASSIGNED';

            const mappedData = {
                organizationId: data.organization_id,
                assetId: data.asset_id,
                employeeId: data.employee_id,
                assignedDate: data.assigned_date ? new Date(data.assigned_date) : new Date(),
                returnDate: data.return_date ? new Date(data.return_date) : null,
                conditionAssign: data.condition_assign,
                status: normalizedStatus,
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
                    employee: true,
                }
            });

            // Phase 02: Update asset status to ASSIGNED
            await prisma.assets.update({
                where: { id: data.asset_id },
                data: { status: 'ASSIGNED', updatedAt: new Date() },
            });

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
                    employee: true,
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
                employee_id,
                status: statusFilter,
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
                    { status: { contains: search, mode: "insensitive" } },
                ];
            }

            if (employee_id) {
                where.employeeId = employee_id;
            }
            if (statusFilter) {
                where.status = statusFilter;
            }

            // Fetch assignments
            const assignments = await prisma.assetAssignments.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [prismaSortField]: sort_order },
                include: {
                    organization: true,
                    asset: {
                        include: {
                            assetCategory: true,
                            assetModel: true,
                        }
                    },
                    employee: true,
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

            const existing = await prisma.assetAssignments.findUnique({
                where: { id },
            });

            if (!existing || existing.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset assignment not found',
                });
            }

            await prisma.assetAssignments.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            if (existing.status === 'ASSIGNED' && existing.assetId) {
                await prisma.assets.update({
                    where: { id: existing.assetId },
                    data: { status: 'AVAILABLE', updatedAt: new Date() },
                });
            }

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
    const emp = assetAssignment.employee;
    const ast = assetAssignment.asset;
    const astCat = ast?.assetCategory;
    const astModel = ast?.assetModel;

    return {
        id: assetAssignment.id,
        organization_id: assetAssignment.organizationId,
        asset_id: assetAssignment.assetId,
        employee_id: assetAssignment.employeeId,
        assigned_date: assetAssignment.assignedDate?.toISOString() ?? '',
        return_date: assetAssignment.returnDate?.toISOString() ?? '',
        condition_assign: assetAssignment.conditionAssign
            ? (typeof assetAssignment.conditionAssign === 'string'
                ? assetAssignment.conditionAssign
                : JSON.stringify(assetAssignment.conditionAssign))
            : "",
        status: assetAssignment.status,
        notes: assetAssignment.notes ?? '',
        created_at: assetAssignment.createdAt?.toISOString() ?? '',
        updated_at: assetAssignment.updatedAt?.toISOString() ?? '',
        deleted_at: assetAssignment.deletedAt?.toISOString() ?? '',

        // Employee details (if included)
        employee: emp ? {
            id: emp.id,
            organization_id: emp.organizationId,
            first_name: emp.firstName,
            last_name: emp.lastName,
            full_name: emp.fullName,
            employee_code: emp.employeeCode,
            email: emp.email,
            phone: emp.phone,
            category_id: emp.categoryId,
            designation_id: emp.designationId,
        } : null,

        // Asset details (if included)
        asset: ast ? {
            id: ast.id,
            serial_number: ast.serialNumber,
            asset_tag: ast.assetTag,
            status: ast.status,
            location: ast.location,
            user_name: ast.userName,
            category: astCat ? {
                id: astCat.id,
                name: astCat.name,
                code: astCat.code,
            } : null,
            model: astModel ? {
                id: astModel.id,
                brand: astModel.brand,
                model_name: astModel.modelName,
                code: astModel.code,
            } : null,
        } : null,
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
