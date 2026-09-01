import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.BRANCH_SERVICE_PORT || 5065);
const branchProto = loadProto('branch');

function formatDate(date) {
    if (!date) return null;
    return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function mapBranch(b) {
    return {
        id: b.id ?? '',
        organization_id: b.organizationId ?? '',
        name: b.name ?? '',
        code: b.code ?? '',
        description: b.description ?? '',
        is_active: b.isActive ?? true,
        created_at: formatDate(b.createdAt),
        updated_at: formatDate(b.updatedAt),
        deleted_at: formatDate(b.deletedAt),
    };
}

const impl = {
    CreateBranch: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            const org = await prisma.organizations.findFirst({
                where: { id: data.organization_id, deletedAt: null },
            });
            if (!org) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found.',
                });
            }

            const nameExists = await prisma.branches.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: data.name,
                    deletedAt: null,
                },
            });
            if (nameExists) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Branch with this name already exists in the organization.',
                });
            }

            const branch = await prisma.branches.create({
                data: {
                    organizationId: data.organization_id,
                    name: data.name,
                    code: data.code || null,
                    description: data.description || null,
                    deletedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                branch: mapBranch(branch),
                success: true,
                message: 'Branch created successfully.',
            });
        } catch (e) {
            console.error('CreateBranch Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetBranch: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid branch id.',
                });
            }

            const branch = await prisma.branches.findFirst({
                where: { id, deletedAt: null },
            });

            if (!branch) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Branch not found.',
                });
            }

            callback(null, {
                branch: mapBranch(branch),
                success: true,
                message: 'Branch found.',
            });
        } catch (e) {
            console.error('GetBranch Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListBranches: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            const skip = (page - 1) * limit;
            const where = { organizationId: organization_id, deletedAt: null };

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { code: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }

            const orderFieldMap = {
                created_at: 'createdAt',
                name: 'name',
            };
            const orderField = orderFieldMap[sort_by] || 'createdAt';
            const orderBy = { [orderField]: sort_order === 'asc' ? 'asc' : 'desc' };

            const [branches, total] = await Promise.all([
                prisma.branches.findMany({
                    where,
                    orderBy,
                    skip,
                    take: Number(limit),
                }),
                prisma.branches.count({ where }),
            ]);

            callback(null, {
                branches: branches.map(mapBranch),
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / Number(limit)),
                success: true,
                message: 'Branches listed successfully.',
            });
        } catch (e) {
            console.error('ListBranches Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateBranch: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.id || !/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid branch id.',
                });
            }

            const existing = await prisma.branches.findFirst({
                where: { id: data.id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Branch not found.',
                });
            }

            if (data.name && data.name !== existing.name) {
                const nameConflict = await prisma.branches.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                        name: data.name,
                        id: { not: data.id },
                        deletedAt: null,
                    },
                });
                if (nameConflict) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Another branch with this name already exists.',
                    });
                }
            }

            const updated = await prisma.branches.update({
                where: { id: data.id },
data: {
                    name: data.name ?? existing.name,
                    code: data.code !== undefined ? data.code : existing.code,
                    description: data.description !== undefined ? data.description : existing.description,
                    isActive: data.is_active !== undefined ? data.is_active : existing.isActive,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                branch: mapBranch(updated),
                success: true,
                message: 'Branch updated successfully.',
            });
        } catch (e) {
            console.error('UpdateBranch Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteBranch: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid branch id.',
                });
            }

            const existing = await prisma.branches.findFirst({
                where: { id, deletedAt: null },
            });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Branch not found.',
                });
            }

            await prisma.branches.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Branch deleted successfully.',
            });
        } catch (e) {
            console.error('DeleteBranch Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('branch-service');
    const server = new grpc.Server();
    server.addService(branchProto.BranchService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[branch-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[branch-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[branch-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[branch-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[branch-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[branch-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[branch-service] Fatal error:', err);
    process.exit(1);
});
