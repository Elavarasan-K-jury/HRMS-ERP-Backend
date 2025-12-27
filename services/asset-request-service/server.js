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
    const emp = ad.employee ?? {};
    const asset = ad.asset ?? {};
    const assetCategory = asset.assetCategory ?? {};
    const assetModel = asset.assetModel ?? {};
    const specs = assetModel.specs ?? {};

    const toISO = (d) => (d ? new Date(d).toISOString() : "");
    const safe = (v) => (v ?? "");

    return {
        // ===== Request (top-level) =====
        id: r.id,
        organization_id: r.organizationId,
        assignment_id: r.assignmentId,
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

        // ===== Assignment Details =====
        assignment_details: {
            id: ad.id,
            organization_id: ad.organizationId,
            asset_id: ad.assetId,
            employee_id: ad.employeeId,
            assigned_date: toISO(ad.assignedDate),
            return_date: toISO(ad.returnDate),
            condition_assign: safe(ad.conditionAssign),
            status: safe(ad.status),
            notes: safe(ad.notes),
            created_at: toISO(ad.createdAt),
            updated_at: toISO(ad.updatedAt),
            deleted_at: toISO(ad.deletedAt),

            // ===== Employee =====
            employee: {
                id: emp.id,
                organization_id: emp.organizationId,
                category_id: emp.categoryId,
                designation_id: emp.designationId,
                first_name: emp.firstName,
                last_name: emp.lastName,
                full_name: emp.fullName,
                employee_code: emp.employeeCode,
                access_token: safe(emp.accessToken),
                refresh_token: safe(emp.refreshToken),
                email: emp.email,
                phone: emp.phone,
                alt_phone: emp.altPhone,
                gender: emp.gender,
                date_of_birth: toISO(emp.dateOfBirth),
                created_at: toISO(emp.createdAt),
                updated_at: toISO(emp.updatedAt),
                deleted_at: toISO(emp.deletedAt),
            },

            // ===== Asset =====
            asset: {
                id: asset.id,
                organization_id: asset.organizationId,
                categories_id: asset.categoriesId,
                model_id: asset.modelId,
                serial_number: asset.serialNumber,
                asset_tag: asset.assetTag,
                user_name: asset.userName,
                password: asset.password,
                purchase_date: toISO(asset.purchaseDate),
                warranty_expire: toISO(asset.warrantyExpire),
                status: asset.status,
                location: asset.location,
                created_at: toISO(asset.createdAt),
                updated_at: toISO(asset.updatedAt),
                deleted_at: toISO(asset.deletedAt),

                // Asset Category
                asset_category: {
                    id: assetCategory.id,
                    organization_id: assetCategory.organizationId,
                    name: assetCategory.name,
                    code: assetCategory.code,
                    description: safe(assetCategory.description),
                    is_active: !!assetCategory.isActive,
                    created_at: toISO(assetCategory.createdAt),
                    updated_at: toISO(assetCategory.updatedAt),
                    deleted_at: toISO(assetCategory.deletedAt),
                },

                // Asset Model
                asset_model: {
                    id: assetModel.id,
                    organization_id: assetModel.organizationId,
                    categories_id: assetModel.categoriesId,
                    brand: assetModel.brand,
                    model_name: assetModel.modelName,
                    code: assetModel.code,
                    description: safe(assetModel.description),
                    specs: {
                        cpu: safe(specs.CPU),
                        gpu: safe(specs.GPU),
                        ram: safe(specs.RAM),
                        storage: safe(specs.Storage),
                    },
                    is_active: !!assetModel.isActive,
                    created_at: toISO(assetModel.createdAt),
                    updated_at: toISO(assetModel.updatedAt),
                    deleted_at: toISO(assetModel.deletedAt),
                },

                // Conditions arrays (keep as-is)
                asset_condition: Array.isArray(asset.assetcondition) ? asset.assetcondition : [],
            },

            // Assignment condition array (keep as-is)
            assignment_condition: Array.isArray(ad.assetcondition) ? ad.assetcondition : [],
        },

        // ===== Approved By (if you later populate) =====
        approved_by: r.approvedBy ?? null,

        // ===== Optional: raw copy (if you want literally everything unchanged) =====
        raw: r,
    };
}


const impl = {
    // -----------------------------
    // Create
    // -----------------------------
    CreateAssetRequest: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.category_id || !data.model_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, category_id and model_id are required.',
                });
            }

            if (!data.employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'employee_id is required.',
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

                // relations
                employee: {
                    connect: { id: data.employee_id },
                },
                approvedBy: cleanId(data.approved_by)
                    ? { connect: { id: cleanId(data.approved_by) } }
                    : undefined,

                reason: data.reason,
                quantity: data.quantity ?? 1,
                priority: data.priority ?? 'Medium',
                status: data.status ?? 'Pending',

                approvedAt: data.approved_at && data.approved_at !== ''
                    ? new Date(data.approved_at)
                    : null,

                rejectionReason:
                    data.rejection_reason === 'null'
                        ? null
                        : data.rejection_reason || null,

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

            callback(null, {
                request: mapAssetRequest(created),
                success: true,
                message: 'Asset request created successfully',
            });
        } catch (e) {
            console.error('❌ CreateAssetRequest Error:', e);
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
                    assignmentDetails: {
                        include: {
                            asset: {
                                include: {
                                    assetCategory: true,
                                    assetModel: true,
                                    assetcondition: true
                                }
                            },
                            assetcondition: true,
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

            const where = {
                deletedAt: null,
            };

            if (organization_id) {
                where.organizationId = organization_id;
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
                    assignmentDetails: {
                        include: {
                            employee: true,
                            asset: {
                                include: {
                                    assetCategory: true,
                                    assetModel: true,
                                    assetcondition: true
                                }
                            },
                            assetcondition: true,
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
            console.error('❌ ListAssetRequests Error:', e);
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
                    approvedById: clean(approved_by),
                    status: clean(status),
                    approvedAt: cleanDate(approved_at),
                    rejectionReason:
                        rejection_reason === 'null'
                            ? null
                            : clean(rejection_reason),
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                success: true,
                message: `Asset request ${status} successfully`,
            });
        } catch (e) {
            console.error('❌ approveRejectAssetRequest Error:', e);
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
