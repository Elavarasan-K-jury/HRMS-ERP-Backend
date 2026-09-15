import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.ASSET_REQ_SERVICE_PORT || 5066);
const assetRequestProto = loadProto('asset_request');

const cleanId = (val) =>
    !val || val === '' || val === 'null' ? undefined : val;

const clean = (val) =>
    val === '' || val === undefined ? undefined : val;

const cleanDate = (val) =>
    val && val !== '' ? new Date(val) : undefined;

function mapAssetRequest(r) {
    const ad = r.assignmentDetails ?? {};
    const emp = ad.employee ?? r.employee ?? {};
    const asset = ad.asset ?? {};
    const assetCategory = r.assetCategory ?? asset.assetCategory ?? {};
    const assetModel = r.assetModel ?? asset.assetModel ?? {};
    const specs = assetModel.specs ?? {};

    const toISO = (d) => (d ? new Date(d).toISOString() : "");
    const safe = (v) => (v ?? "");

    return {
        id: r.id,
        organization_id: r.organizationId,
        employee_id: r.employeeId,
        category_id: safe(r.categoryId),
        model_id: safe(r.modelId),
        assignment_id: safe(r.assignmentId),
        approved_by_id: safe(r.approvedById),
        reason: safe(r.reason),
        quantity: r.quantity,
        priority: r.priority,
        status: r.status,
        approved_at: toISO(r.approvedAt),
        rejection_reason: safe(r.rejectionReason),
        created_at: toISO(r.createdAt),
        updated_at: toISO(r.updatedAt),
        deleted_at: toISO(r.deletedAt),

        category: assetCategory.id ? {
            id: assetCategory.id,
            name: assetCategory.name,
            code: assetCategory.code,
        } : null,

        model: assetModel.id ? {
            id: assetModel.id,
            brand: assetModel.brand,
            model_name: assetModel.modelName,
            code: assetModel.code,
        } : null,

        employee: emp.id ? {
            id: emp.id,
            first_name: emp.firstName,
            last_name: emp.lastName,
            full_name: emp.fullName,
            employee_code: emp.employeeCode,
            email: emp.email,
        } : null,

        assignment_details: ad.id ? {
            id: ad.id,
            asset_id: ad.assetId,
            employee_id: ad.employeeId,
            assigned_date: toISO(ad.assignedDate),
            return_date: toISO(ad.returnDate),
            status: safe(ad.status),
            asset: asset.id ? {
                id: asset.id,
                serial_number: asset.serialNumber,
                asset_tag: asset.assetTag,
                status: asset.status,
            } : null,
        } : null,
    };
}


const impl = {
    // -----------------------------
    // Create
    // -----------------------------
    CreateAssetRequest: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            if (!data.employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'employee_id is required.',
                });
            }

            if (!data.category_id && !data.model_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'At least one of category_id or model_id is required.',
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

            const employee = await prisma.organizationEmployees.findUnique({
                where: { id: data.employee_id },
            });
            if (!employee || employee.organizationId !== data.organization_id) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found in this organization.',
                });
            }

            if (data.category_id) {
                const category = await prisma.assetCategories.findUnique({
                    where: { id: data.category_id },
                });
                if (!category || category.organizationId !== data.organization_id) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Asset category not found in this organization.',
                    });
                }
            }

            if (data.model_id) {
                const model = await prisma.assetModels.findUnique({
                    where: { id: data.model_id },
                });
                if (!model || model.organizationId !== data.organization_id) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Asset model not found in this organization.',
                    });
                }
            }

            const mappedData = {
                organizationId: data.organization_id,
                employeeId: data.employee_id,
                categoryId: data.category_id || null,
                modelId: data.model_id || null,
                assignmentId: data.assignment_id || null,
                approvedById: null,
                reason: data.reason || null,
                quantity: data.quantity ?? 1,
                priority: data.priority ?? 'MEDIUM',
                status: 'PENDING',
                approvedAt: null,
                rejectionReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            const created = await prisma.assetRequest.create({
                data: mappedData,
                include: {
                    employee: true,
                    assetCategory: true,
                    assetModel: true,
                },
            });

            callback(null, {
                request: mapAssetRequest(created),
                success: true,
                message: 'Asset request created successfully',
            });
        } catch (e) {
            console.error('CreateAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    // -----------------------------
    // Get By ID
    // -----------------------------
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
                    assetCategory: true,
                    assetModel: true,
                    assignmentDetails: {
                        include: {
                            asset: {
                                include: {
                                    assetCategory: true,
                                    assetModel: true,
                                }
                            },
                        }
                    },
                    approvedBy: true,
                },
            });

            if (!model || model.deletedAt !== null) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found',
                });
            }

            callback(null, {
                request: mapAssetRequest(model),
                success: true,
                message: 'Asset request fetched successfully',
            });
        } catch (e) {
            console.error('❌ GetAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    // -----------------------------
    // List
    // -----------------------------
    ListAssetRequests: async (call, callback) => {
        try {
            const {
                organization_id,
                employee_id,
                status,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            const SORT_MAP = {
                created_at: 'createdAt',
                updated_at: 'updatedAt',
                approved_at: 'approvedAt',
                deleted_at: 'deletedAt',
                priority: 'priority',
                status: 'status',
            };

            const prismaSortBy = SORT_MAP[sort_by] ?? 'createdAt';

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            const where = {
                deletedAt: null,
                organizationId: organization_id,
            };

            if (employee_id) {
                where.employeeId = employee_id;
            }

            if (status) {
                where.status = status;
            }

            if (search) {
                where.OR = [
                    { reason: { contains: search, mode: 'insensitive' } },
                    { rejectionReason: { contains: search, mode: 'insensitive' } },
                    { priority: { contains: search, mode: 'insensitive' } },
                    { status: { contains: search, mode: 'insensitive' } },
                ];
            }

            const assetsRequests = await prisma.assetRequest.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    [prismaSortBy]: sort_order,
                },
                include: {
                    employee: true,
                    assetCategory: true,
                    assetModel: true,
                    assignmentDetails: {
                        include: {
                            asset: {
                                include: {
                                    assetCategory: true,
                                    assetModel: true,
                                }
                            },
                        }
                    },
                    approvedBy: true,
                },
            });

            const count = await prisma.assetRequest.count({ where });

            callback(null, {
                requests: assetsRequests.map(mapAssetRequest),
                total: count,
                page,
                limit,
                total_pages: Math.ceil(count / limit),
                success: true,
                message: 'Asset requests fetched successfully',
            });
        } catch (e) {
            console.error('ListAssetRequests Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    ApproveRejectAssetRequest: async (call, callback) => {
        try {
            const {
                id,
                approved_by,
                rejection_reason,
                approved_at,
                status
            } = call.request;

            if (!id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Asset request ID is required.',
                });
            }

            if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Status must be APPROVED or REJECTED.',
                });
            }

            const existing = await prisma.assetRequest.findFirst({
                where: { id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found.',
                });
            }

            if (existing.status !== 'PENDING') {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot ${status.toLowerCase()} request: current status is ${existing.status}. Only PENDING requests can be processed.`,
                });
            }

            const updateData = {
                status: status,
                updatedAt: new Date(),
            };

            if (status === 'APPROVED') {
                updateData.approvedById = approved_by || null;
                updateData.approvedAt = approved_at ? new Date(approved_at) : new Date();
            } else if (status === 'REJECTED') {
                updateData.rejectionReason = rejection_reason || null;
            }

            const updated = await prisma.assetRequest.update({
                where: { id },
                data: updateData,
                include: {
                    employee: true,
                    assetCategory: true,
                    assetModel: true,
                },
            });

            callback(null, {
                request: mapAssetRequest(updated),
                success: true,
                message: `Asset request ${status.toLowerCase()} successfully`,
            });
        } catch (e) {
            console.error('ApproveRejectAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    // -----------------------------
    // Assign Asset to Approved Request (Phase 06)
    // -----------------------------
    AssignAssetToRequest: async (call, callback) => {
        try {
            const { request_id, asset_id, assigned_date, condition_assign, notes } = call.request;

            if (!request_id || !asset_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'request_id and asset_id are required.',
                });
            }

            const request = await prisma.assetRequest.findUnique({
                where: { id: request_id },
                include: { employee: true, assetCategory: true, assetModel: true },
            });

            if (!request || request.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found.',
                });
            }

            if (request.status !== 'APPROVED') {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot assign asset: request status is ${request.status}. Only APPROVED requests can be assigned.`,
                });
            }

            if (request.assignmentId) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'This request already has an assigned asset.',
                });
            }

            const asset = await prisma.assets.findUnique({
                where: { id: asset_id },
                include: { assetCategory: true, assetModel: true },
            });

            if (!asset || asset.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset not found.',
                });
            }

            if (asset.organizationId !== request.organizationId) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Asset does not belong to the same organization as the request.',
                });
            }

            if ((asset.status || '').toUpperCase() !== 'AVAILABLE') {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot assign asset: current status is ${asset.status}. Asset must be AVAILABLE.`,
                });
            }

            if (request.categoryId && asset.categoriesId !== request.categoryId) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Asset category does not match the requested category.',
                });
            }

            if (request.modelId && asset.modelId !== request.modelId) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Asset model does not match the requested model.',
                });
            }

            const activeAssignment = await prisma.assetAssignments.findFirst({
                where: {
                    assetId: asset_id,
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

            const assignment = await prisma.assetAssignments.create({
                data: {
                    organizationId: request.organizationId,
                    assetId: asset_id,
                    employeeId: request.employeeId,
                    assignedDate: assigned_date ? new Date(assigned_date) : new Date(),
                    conditionAssign: condition_assign ? JSON.parse(condition_assign) : null,
                    status: 'ASSIGNED',
                    notes: notes || `Assigned from request #${request_id.slice(-8)}`,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
                include: {
                    asset: true,
                    employee: true,
                },
            });

            await prisma.assets.update({
                where: { id: asset_id },
                data: { status: 'ASSIGNED', updatedAt: new Date() },
            });

            await prisma.assetRequest.update({
                where: { id: request_id },
                data: { assignmentId: assignment.id, updatedAt: new Date() },
            });

            callback(null, {
                assignment: {
                    id: assignment.id,
                    organization_id: assignment.organizationId,
                    asset_id: assignment.assetId,
                    employee_id: assignment.employeeId,
                    assigned_date: new Date(assignment.assignedDate).toISOString(),
                    status: assignment.status,
                    notes: assignment.notes,
                },
                success: true,
                message: 'Asset assigned to request successfully',
            });
        } catch (e) {
            console.error('AssignAssetToRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    // -----------------------------
    // Update
    // -----------------------------
    UpdateAssetRequest: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset request ID format',
                });
            }

            const existing = await prisma.assetRequest.findFirst({
                where: { id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found',
                });
            }

            if (call.request.status && call.request.status !== existing.status) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Status cannot be changed via update. Use ApproveRejectAssetRequest to change status.',
                });
            }

            const updated = await prisma.assetRequest.update({
                where: { id },
                data: {
                    organizationId: clean(call.request.organization_id),
                    categoriesId: clean(call.request.category_id),
                    modelId: clean(call.request.model_id),
                    employeeId: clean(call.request.employee_id),
                    approvedById: clean(call.request.approved_by),
                    reason: clean(call.request.reason),
                    quantity: call.request.quantity ?? undefined,
                    priority: clean(call.request.priority),
                    status: clean(call.request.status),
                    approvedAt: cleanDate(call.request.approved_at),
                    rejectionReason:
                        call.request.rejection_reason === 'null'
                            ? null
                            : clean(call.request.rejection_reason),
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                request: mapAssetRequest(updated),
                success: true,
                message: 'Asset request updated successfully',
            });
        } catch (e) {
            console.error('❌ UpdateAssetRequest Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    // -----------------------------
    // Delete (soft)
    // -----------------------------
    DeleteAssetRequest: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid asset request ID format',
                });
            }

            const existing = await prisma.assetRequest.findFirst({
                where: { id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Asset request not found',
                });
            }

            if (existing.assignmentId) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: 'Cannot delete request: it has an active assignment. Remove the assignment first.',
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

// -----------------------------
// Server
// -----------------------------
async function main() {
    await checkDbConnection('asset-requests-service');

    const server = new grpc.Server();
    server.addService(assetRequestProto.AssetRequestService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve()),
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
