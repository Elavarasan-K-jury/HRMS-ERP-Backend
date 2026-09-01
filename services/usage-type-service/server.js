import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.USAGE_TYPE_SERVICE_PORT || 5065);
const usageTypeProto = loadProto('usage_type');

function mapUsageType(u = {}) {
    return {
        id: u.id ?? '',
        organization_id: u.organizationId ?? '',
        name: u.name ?? '',
        description: u.description ?? '',
        is_active: u.isActive ?? true,
        created_at: u.createdAt ? u.createdAt.toISOString() : '',
        updated_at: u.updatedAt ? u.updatedAt.toISOString() : '',
    };
}

const impl = {
    CreateUsageType: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id || !data.name?.trim()) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id and name are required.' });
            }
            const name = data.name.trim();
            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Type Name is required.' });

            const allForDup = await prisma.usageType.findMany({ where: { organizationId: data.organization_id } });
            const existing = allForDup.find(u => !u.deletedAt && u.name.toLowerCase() === name.toLowerCase());
            if (existing) {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Usage Type '${name}' already exists.` });
            }

            const ut = await prisma.usageType.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, { usage_type: mapUsageType(ut), message: 'Usage type created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                const dupName = call.request?.name?.trim() || 'this name';
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Usage Type '${dupName}' already exists.` });
            }
            console.error('CreateUsageType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetUsageType: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage type id' });
            const ut = await prisma.usageType.findFirst({ where: { id, deletedAt: null } });
            if (!ut) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found' });
            callback(null, { usage_type: mapUsageType(ut), message: 'Usage type found', success: true });
        } catch (e) {
            console.error('GetUsageType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListUsageTypes: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc', is_active_only = false } = call.request;
            const skip = (page - 1) * limit;
            let where = {};
            if (organization_id) where.organizationId = organization_id;
            where.deletedAt = null;
            if (is_active_only) where.isActive = true;
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', created_at: 'createdAt', updated_at: 'updatedAt' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.usageType.count({ where });
            const usageTypes = await prisma.usageType.findMany({ where, orderBy: { [sortField]: order }, skip, take: limit });

            callback(null, {
                usage_types: usageTypes.map(mapUsageType),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Usage types found successfully',
            });
        } catch (e) {
            console.error('ListUsageTypes Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateUsageType: async (call, callback) => {
        try {
            const data = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage type id' });
            const existing = await prisma.usageType.findFirst({ where: { id: data.id, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found' });

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Type Name is required.' });

            const allForConflict = await prisma.usageType.findMany({ where: { organizationId: data.organization_id || existing.organizationId } });
            const conflict = allForConflict.find(u => !u.deletedAt && String(u.id) !== String(data.id) && u.name.toLowerCase() === name.toLowerCase());
            if (conflict) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Usage Type '${name}' already exists.` });

            const updated = await prisma.usageType.update({
                where: { id: data.id },
                data: { name, description, isActive, updatedAt: new Date(), organizationId: data.organization_id || existing.organizationId },
            });
            callback(null, { usage_type: mapUsageType(updated), message: 'Usage type updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                const dupName = call.request?.name?.trim() || data.name?.trim() || 'this name';
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Usage Type '${dupName}' already exists.` });
            }
            console.error('UpdateUsageType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteUsageType: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage type id' });
            const ut = await prisma.usageType.findFirst({ where: { id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!ut) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found' });

            const refCount = await prisma.expenseCategory.count({ where: { usageTypeId: id, deletedAt: null } });
            if (refCount > 0) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Cannot delete usage type. ${refCount} expense category(ies) are still referencing it. Deactivate it or reassign categories first.` });
            }

            await prisma.usageType.update({ where: { id }, data: { deletedAt: new Date(), updatedAt: new Date(), name: `${ut.name}__deleted__${Date.now()}` } });
            callback(null, { success: true, message: 'Usage type deleted successfully' });
        } catch (e) {
            console.error('DeleteUsageType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateUsageTypeStatus: async (call, callback) => {
        try {
            const { id, organization_id, is_active } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage type id' });
            const ut = await prisma.usageType.findFirst({ where: { id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!ut) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found' });
            const updated = await prisma.usageType.update({ where: { id }, data: { isActive: Boolean(is_active), updatedAt: new Date() } });
            callback(null, { usage_type: mapUsageType(updated), message: is_active ? 'Usage type activated' : 'Usage type deactivated', success: true });
        } catch (e) {
            console.error('UpdateUsageTypeStatus Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('usage-type-service');
    const server = new grpc.Server();
    server.addService(usageTypeProto.UsageTypeService.service, impl);
    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    console.log(`[usage-type-service] gRPC running on :${PORT}`);
    const shutdown = async (signal) => {
        console.log(`\n[usage-type-service] Received ${signal}, shutting down...`);
        try { server.tryShutdown(() => console.log('[usage-type-service] gRPC stopped.')); await prisma.$disconnect(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('[usage-type-service] Fatal error:', err); process.exit(1); });
