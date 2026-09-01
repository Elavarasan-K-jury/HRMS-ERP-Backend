import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.EXPENSE_CATEGORY_SERVICE_PORT || 5066);
const expenseCategoryProto = loadProto('expense_category');

function mapExpenseCategory(c = {}) {
    return {
        id: c.id ?? '',
        organization_id: c.organizationId ?? '',
        name: c.name ?? '',
        expense_code: c.expenseCode ?? '',
        icon: c.icon ?? '',
        description: c.description ?? '',
        usage_type_id: c.usageTypeId ?? '',
        usage_type_name: c.usageType?.name ?? c.usage_type_name ?? '',
        is_active: c.isActive ?? true,
        created_at: c.createdAt ? c.createdAt.toISOString() : '',
        updated_at: c.updatedAt ? c.updatedAt.toISOString() : '',
    };
}

const impl = {
    CreateExpenseCategory: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id || !data.name?.trim() || !data.expense_code?.trim() || !data.usage_type_id) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id, name, expense_code and usage_type_id are required.' });
            }
            const name = data.name.trim();
            const expenseCode = data.expense_code.trim();
            const usageTypeId = data.usage_type_id;

            if (!/^[0-9a-fA-F]{24}$/.test(usageTypeId)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage_type_id.' });
            }

            // Validate usageType exists, belongs to same org, is active
            const usageType = await prisma.usageType.findFirst({ where: { id: usageTypeId, deletedAt: null } });
            if (!usageType) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found.' });
            if (usageType.organizationId !== data.organization_id) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Usage type does not belong to this organization.' });
            }
            if (!usageType.isActive) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Cannot use an inactive usage type for a new category.' });
            }

            // Duplicate checks
            const existingName = await prisma.expenseCategory.findFirst({
                where: { organizationId: data.organization_id, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
            });
            if (existingName) return callback({ code: grpc.status.ALREADY_EXISTS, message: 'An expense category with this name already exists in the organization.' });

            const existingCode = await prisma.expenseCategory.findFirst({
                where: { organizationId: data.organization_id, expenseCode: { equals: expenseCode, mode: 'insensitive' }, deletedAt: null },
            });
            if (existingCode) return callback({ code: grpc.status.ALREADY_EXISTS, message: 'An expense category with this expense code already exists in the organization.' });

            const cat = await prisma.expenseCategory.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    expenseCode,
                    icon: data.icon?.trim() || null,
                    description: data.description?.trim() || null,
                    usageTypeId,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
                include: { usageType: true },
            });

            callback(null, { expense_category: mapExpenseCategory(cat), message: 'Expense category created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                const req = call.request || {};
                const target = e.meta?.target || [];
                if (String(target).includes('expense_code')) {
                    return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense category with expense code '${req.expense_code?.trim() || 'this code'}' already exists.` });
                }
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense category '${req.name?.trim() || 'this name'}' already exists.` });
            }
            console.error('CreateExpenseCategory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetExpenseCategory: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense category id' });
            const cat = await prisma.expenseCategory.findFirst({ where: { id, deletedAt: null }, include: { usageType: true } });
            if (!cat) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense category not found' });
            callback(null, { expense_category: mapExpenseCategory(cat), message: 'Expense category found', success: true });
        } catch (e) {
            console.error('GetExpenseCategory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListExpenseCategories: async (call, callback) => {
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
                    { expenseCode: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', expense_code: 'expenseCode', created_at: 'createdAt', updated_at: 'updatedAt' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.expenseCategory.count({ where });
            const cats = await prisma.expenseCategory.findMany({ where, include: { usageType: true }, orderBy: { [sortField]: order }, skip, take: limit });

            callback(null, {
                expense_categories: cats.map(mapExpenseCategory),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Expense categories found successfully',
            });
        } catch (e) {
            console.error('ListExpenseCategories Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateExpenseCategory: async (call, callback) => {
        try {
            const data = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense category id' });
            const existing = await prisma.expenseCategory.findFirst({ where: { id: data.id, deletedAt: null }, include: { usageType: true } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense category not found' });

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const expenseCode = data.expense_code !== undefined && data.expense_code !== null && data.expense_code !== '' ? data.expense_code.trim() : existing.expenseCode;
            const icon = data.icon !== undefined ? (data.icon?.trim() || null) : existing.icon;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;
            let usageTypeId = data.usage_type_id !== undefined && data.usage_type_id !== null && data.usage_type_id !== '' ? data.usage_type_id : existing.usageTypeId;

            if (!name || !expenseCode || !usageTypeId) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Name, expense code and usage type are required.' });
            if (!/^[0-9a-fA-F]{24}$/.test(usageTypeId)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid usage_type_id.' });

            // Validate usageType
            const usageType = await prisma.usageType.findFirst({ where: { id: usageTypeId, deletedAt: null } });
            if (!usageType) return callback({ code: grpc.status.NOT_FOUND, message: 'Usage type not found.' });
            const orgId = data.organization_id || existing.organizationId;
            if (usageType.organizationId !== orgId) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Usage type does not belong to this organization.' });
            }
            // Only enforce active check if usageType changed to a different one
            if (usageTypeId !== existing.usageTypeId && !usageType.isActive) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Cannot assign an inactive usage type.' });
            }

            // Duplicate checks (excluding self)
            const conflictName = await prisma.expenseCategory.findFirst({
                where: { organizationId: orgId, deletedAt: null, id: { not: data.id }, name: { equals: name, mode: 'insensitive' } },
            });
            if (conflictName) return callback({ code: grpc.status.ALREADY_EXISTS, message: 'Another expense category with this name already exists.' });

            const conflictCode = await prisma.expenseCategory.findFirst({
                where: { organizationId: orgId, deletedAt: null, id: { not: data.id }, expenseCode: { equals: expenseCode, mode: 'insensitive' } },
            });
            if (conflictCode) return callback({ code: grpc.status.ALREADY_EXISTS, message: 'Another expense category with this expense code already exists.' });

            const updated = await prisma.expenseCategory.update({
                where: { id: data.id },
                data: { name, expenseCode, icon, description, usageTypeId, isActive, updatedAt: new Date(), organizationId: orgId },
                include: { usageType: true },
            });

            callback(null, { expense_category: mapExpenseCategory(updated), message: 'Expense category updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                const req = call.request || {};
                const target = e.meta?.target || [];
                if (String(target).includes('expense_code')) {
                    return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense category with expense code '${req.expense_code?.trim() || 'this code'}' already exists.` });
                }
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense category '${req.name?.trim() || 'this name'}' already exists.` });
            }
            console.error('UpdateExpenseCategory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteExpenseCategory: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense category id' });
            const cat = await prisma.expenseCategory.findFirst({ where: { id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!cat) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense category not found' });

            // Future: check if referenced by Expense Policies (no table yet, skip)
            // For now, allow soft delete

            await prisma.expenseCategory.update({ where: { id }, data: { deletedAt: new Date(), updatedAt: new Date(), name: `${cat.name}__deleted__${Date.now()}`, expenseCode: `${cat.expenseCode}__deleted__${Date.now()}` } });
            callback(null, { success: true, message: 'Expense category deleted successfully' });
        } catch (e) {
            console.error('DeleteExpenseCategory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateExpenseCategoryStatus: async (call, callback) => {
        try {
            const { id, organization_id, is_active } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense category id' });
            const cat = await prisma.expenseCategory.findFirst({ where: { id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!cat) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense category not found' });
            const updated = await prisma.expenseCategory.update({ where: { id }, data: { isActive: Boolean(is_active), updatedAt: new Date() }, include: { usageType: true } });
            callback(null, { expense_category: mapExpenseCategory(updated), message: is_active ? 'Expense category activated' : 'Expense category deactivated', success: true });
        } catch (e) {
            console.error('UpdateExpenseCategoryStatus Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('expense-category-service');
    const server = new grpc.Server();
    server.addService(expenseCategoryProto.ExpenseCategoryService.service, impl);
    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    console.log(`[expense-category-service] gRPC running on :${PORT}`);
    const shutdown = async (signal) => {
        console.log(`\n[expense-category-service] Received ${signal}, shutting down...`);
        try { server.tryShutdown(() => console.log('[expense-category-service] gRPC stopped.')); await prisma.$disconnect(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('[expense-category-service] Fatal error:', err); process.exit(1); });
