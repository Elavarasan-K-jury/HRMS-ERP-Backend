import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.EXPENSE_POLICY_SERVICE_PORT || 5067);
const expensePolicyProto = loadProto('expense_policy');

function mapApprovalLevel(l = {}) {
    return {
        id: l.id ?? '',
        expense_policy_id: l.expensePolicyId ?? '',
        level: l.level ?? 0,
        approver_type: l.approverType ?? '',
        approver_id: l.approverId ?? '',
        approver_name: l.approverName ?? '',
        auto_approve: !!l.autoApprove,
        auto_approve_days: l.autoApproveDays ?? 0,
        created_at: l.createdAt ? l.createdAt.toISOString() : '',
        updated_at: l.updatedAt ? l.updatedAt.toISOString() : '',
    };
}

function mapPolicyCategoryApprovalLevel(l = {}) {
    return {
        id: l.id ?? '',
        policy_category_id: l.policyCategoryId ?? '',
        level: l.level ?? 0,
        approver_type: l.approverType ?? '',
        approver_id: l.approverId ?? '',
        approver_name: l.approverName ?? '',
        auto_approve: !!l.autoApprove,
        auto_approve_days: l.autoApproveDays ?? 0,
        created_at: l.createdAt ? l.createdAt.toISOString() : '',
        updated_at: l.updatedAt ? l.updatedAt.toISOString() : '',
    };
}

function mapExpensePolicy(p = {}) {
    return {
        id: p.id ?? '',
        organization_id: p.organizationId ?? '',
        name: p.name ?? '',
        description: p.description ?? '',
        base_currency: p.baseCurrency ?? '',
        payout_mode: p.payoutMode ?? '',
        allow_future_date_claims: !!p.allowFutureDateClaims,
        approval_required: !!p.approvalRequired,
        approval_mode: p.approvalMode ?? '',
        is_active: p.isActive ?? true,
        created_at: p.createdAt ? p.createdAt.toISOString() : '',
        updated_at: p.updatedAt ? p.updatedAt.toISOString() : '',
        approval_levels: (p.approvalLevels || []).map(mapApprovalLevel),
        category_count: p._count?.policyCategories ?? p.category_count ?? 0,
        employee_count: p._count?.policyEmployees ?? p.employee_count ?? 0,
    };
}

function mapExpenseCategoryRule(r = {}) {
    return {
        id: r.id ?? '',
        policy_category_id: r.policyCategoryId ?? '',
        amount_cap_enabled: !!r.amountCapEnabled,
        amount_cap_currency: r.amountCapCurrency ?? '',
        amount_cap_amount: r.amountCapAmount ?? 0,
        amount_cap_period: r.amountCapPeriod ?? '',
        combination_enabled: !!r.combinationEnabled,
        combination_category_id: r.combinationCategoryId ?? '',
        combination_period: r.combinationPeriod ?? '',
        instances_enabled: !!r.instancesEnabled,
        max_instances: r.maxInstances ?? 0,
        instances_period: r.instancesPeriod ?? '',
        expiry_enabled: !!r.expiryEnabled,
        expiry_days: r.expiryDays ?? 0,
        cost_center_required: !!r.costCenterRequired,
        comment_threshold_enabled: !!r.commentThresholdEnabled,
        comment_threshold_amount: r.commentThresholdAmount ?? 0,
        receipt_threshold_enabled: !!r.receiptThresholdEnabled,
        receipt_threshold_amount: r.receiptThresholdAmount ?? 0,
        threshold_approval_enabled: !!r.thresholdApprovalEnabled,
        threshold_currency: r.thresholdCurrency ?? '',
        threshold_amount: r.thresholdAmount ?? 0,
        created_at: r.createdAt ? r.createdAt.toISOString() : '',
        updated_at: r.updatedAt ? r.updatedAt.toISOString() : '',
    };
}

function validateApprovalLevels(levels) {
    if (!Array.isArray(levels) || levels.length === 0) {
        return 'At least one approval level is required when approval is enabled.';
    }
    for (let i = 0; i < levels.length; i++) {
        const l = levels[i];
        if (!['EMPLOYEE', 'ROLE'].includes(l.approver_type)) {
            return `Level ${i + 1}: approver_type must be EMPLOYEE or ROLE.`;
        }
        if (!l.approver_id || !/^[0-9a-fA-F]{24}$/.test(l.approver_id)) {
            return `Level ${i + 1}: approver_id is required and must be valid ObjectId.`;
        }
        if (l.auto_approve) {
            const days = Number(l.auto_approve_days);
            if (!days || isNaN(days) || days <= 0) {
                return `Level ${i + 1}: auto_approve_days must be positive when auto-approve is enabled.`;
            }
        }
    }
    return null;
}

const impl = {
    CreateExpensePolicy: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id || !data.name?.trim()) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id and name are required.' });
            }
            const name = data.name.trim();
            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Policy Name is required.' });
            if (!data.base_currency?.trim()) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Base Currency is required.' });
            }
            const baseCurrency = data.base_currency.trim();
            const payoutMode = data.payout_mode?.trim() || null;
            const allowFuture = Boolean(data.allow_future_date_claims);
            const approvalRequired = Boolean(data.approval_required);
            let approvalMode = data.approval_mode?.trim() || null;
            if (approvalRequired) {
                if (!approvalMode || !['SAME_FOR_ALL', 'BY_CATEGORY'].includes(approvalMode)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'approval_mode must be SAME_FOR_ALL or BY_CATEGORY when approval is required.' });
                }
            } else {
                approvalMode = null;
            }

            const allForDup = await prisma.expensePolicy.findMany({ where: { organizationId: data.organization_id } });
            const existing = allForDup.find(p => !p.deletedAt && p.name.toLowerCase() === name.toLowerCase());
            if (existing) {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense Policy '${name}' already exists.` });
            }

            // Validate approval levels if same for all
            let approvalLevelsData = [];
            if (approvalRequired && approvalMode === 'SAME_FOR_ALL') {
                const levels = data.approval_levels || [];
                if (levels.length > 0) {
                    const err = validateApprovalLevels(levels);
                    if (err) return callback({ code: grpc.status.INVALID_ARGUMENT, message: err });
                    approvalLevelsData = levels;
                }
            }

            const policy = await prisma.expensePolicy.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    baseCurrency,
                    payoutMode,
                    allowFutureDateClaims: allowFuture,
                    approvalRequired,
                    approvalMode,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                    approvalLevels: approvalLevelsData.length ? {
                        create: approvalLevelsData.map((l, idx) => ({
                            level: l.level || idx + 1,
                            approverType: l.approver_type,
                            approverId: l.approver_id,
                            approverName: l.approver_name || '',
                            autoApprove: Boolean(l.auto_approve),
                            autoApproveDays: l.auto_approve ? Number(l.auto_approve_days) : null,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            deletedAt: null,
                        }))
                    } : undefined,
                },
                include: { approvalLevels: true },
            });

            const withCount = { ...policy, _count: { policyCategories: 0 } };
            callback(null, { expense_policy: mapExpensePolicy(withCount), message: 'Expense policy created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense Policy '${call.request?.name?.trim() || 'this name'}' already exists.` });
            }
            console.error('CreateExpensePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetExpensePolicy: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const where = { id, deletedAt: null };
            if (organization_id) where.organizationId = organization_id;
            const policy = await prisma.expensePolicy.findFirst({
                where,
                include: { approvalLevels: { where: { deletedAt: null }, orderBy: { level: 'asc' } } },
            });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            const categoryCount = await prisma.policyExpenseCategory.count({ where: { expensePolicyId: id, deletedAt: null } });
            const withCount = { ...policy, _count: { policyCategories: categoryCount } };
            callback(null, { expense_policy: mapExpensePolicy(withCount), message: 'Expense policy found', success: true });
        } catch (e) {
            console.error('GetExpensePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListExpensePolicies: async (call, callback) => {
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
                    { baseCurrency: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', base_currency: 'baseCurrency', created_at: 'createdAt', updated_at: 'updatedAt' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.expensePolicy.count({ where });
            const policies = await prisma.expensePolicy.findMany({
                where,
                include: { approvalLevels: { where: { deletedAt: null }, orderBy: { level: 'asc' } } },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            // Get category counts
            const ids = policies.map(p => p.id);
            const counts = ids.length ? await prisma.policyExpenseCategory.groupBy({ by: ['expensePolicyId'], where: { expensePolicyId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
            const countMap = {};
            counts.forEach(c => { countMap[c.expensePolicyId] = c._count._all; });

            // Get employee counts
            const empCounts = ids.length ? await prisma.expensePolicyEmployee.groupBy({ by: ['expensePolicyId'], where: { expensePolicyId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
            const empCountMap = {};
            empCounts.forEach(c => { empCountMap[c.expensePolicyId] = c._count._all; });

            callback(null, {
                expense_policies: policies.map(p => mapExpensePolicy({ ...p, _count: { policyCategories: countMap[p.id] || 0, policyEmployees: empCountMap[p.id] || 0 } })),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Expense policies found successfully',
            });
        } catch (e) {
            console.error('ListExpensePolicies Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateExpensePolicy: async (call, callback) => {
        try {
            const data = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const existing = await prisma.expensePolicy.findFirst({ where: { id: data.id, deletedAt: null }, include: { approvalLevels: { where: { deletedAt: null } } } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            // Organization isolation
            if (data.organization_id && String(data.organization_id) !== String(existing.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Expense policy does not belong to this organization.' });
            }

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const baseCurrency = data.base_currency !== undefined && data.base_currency !== null && data.base_currency !== '' ? data.base_currency.trim() : existing.baseCurrency;
            const payoutMode = data.payout_mode !== undefined ? (data.payout_mode?.trim() || null) : existing.payoutMode;
            const allowFuture = data.allow_future_date_claims !== undefined && data.allow_future_date_claims !== null ? Boolean(data.allow_future_date_claims) : existing.allowFutureDateClaims;
            const approvalRequired = data.approval_required !== undefined && data.approval_required !== null ? Boolean(data.approval_required) : existing.approvalRequired;
            let approvalMode = data.approval_mode !== undefined && data.approval_mode !== null && data.approval_mode !== '' ? data.approval_mode.trim() : existing.approvalMode;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Policy Name is required.' });
            if (!baseCurrency) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Base Currency is required.' });
            if (approvalRequired && approvalMode && !['SAME_FOR_ALL', 'BY_CATEGORY'].includes(approvalMode)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'approval_mode must be SAME_FOR_ALL or BY_CATEGORY.' });
            }
            if (!approvalRequired) approvalMode = null;

            const allForDup = await prisma.expensePolicy.findMany({ where: { organizationId: data.organization_id || existing.organizationId } });
            const conflict = allForDup.find(p => !p.deletedAt && String(p.id) !== String(data.id) && p.name.toLowerCase() === name.toLowerCase());
            if (conflict) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense Policy '${name}' already exists.` });

            // Handle approval levels if explicitly provided (non-empty array)
            // Only modify policy-level levels when SAME_FOR_ALL + levels provided
            // Preserve existing levels during mode transitions (don't destroy config)
            const hasExplicitLevels = Array.isArray(data.approval_levels) && data.approval_levels.length > 0;
            if (hasExplicitLevels && approvalRequired && approvalMode === 'SAME_FOR_ALL') {
                const levels = data.approval_levels;
                const err = validateApprovalLevels(levels);
                if (err) return callback({ code: grpc.status.INVALID_ARGUMENT, message: err });
                // Replace all levels: soft delete old, create new
                await prisma.expensePolicyApprovalLevel.updateMany({ where: { expensePolicyId: data.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
                await prisma.expensePolicyApprovalLevel.createMany({
                    data: levels.map((l, idx) => ({
                        expensePolicyId: data.id,
                        level: l.level || idx + 1,
                        approverType: l.approver_type,
                        approverId: l.approver_id,
                        approverName: l.approver_name || '',
                        autoApprove: Boolean(l.auto_approve),
                        autoApproveDays: l.auto_approve ? Number(l.auto_approve_days) : null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    }))
                });
            }
            // If approval disabled (was enabled, now disabled), soft-delete policy-level levels
            if (existing.approvalRequired && !approvalRequired && existing.approvalLevels?.length) {
                await prisma.expensePolicyApprovalLevel.updateMany({ where: { expensePolicyId: data.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            }

            const updated = await prisma.expensePolicy.update({
                where: { id: data.id },
                data: {
                    name, description, baseCurrency, payoutMode, allowFutureDateClaims: allowFuture, approvalRequired, approvalMode, isActive, updatedAt: new Date(),
                    organizationId: data.organization_id || existing.organizationId,
                },
                include: { approvalLevels: { where: { deletedAt: null }, orderBy: { level: 'asc' } } },
            });
            const categoryCount = await prisma.policyExpenseCategory.count({ where: { expensePolicyId: data.id, deletedAt: null } });
            const withCount = { ...updated, _count: { policyCategories: categoryCount } };
            callback(null, { expense_policy: mapExpensePolicy(withCount), message: 'Expense policy updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: `Expense Policy '${call.request?.name?.trim() || 'this name'}' already exists.` });
            }
            console.error('UpdateExpensePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteExpensePolicy: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const policy = await prisma.expensePolicy.findFirst({ where: { id, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            // Organization isolation
            if (organization_id && String(organization_id) !== String(policy.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Expense policy does not belong to this organization.' });
            }

            // Check if has categories — prevent deletion while categories exist
            const catCount = await prisma.policyExpenseCategory.count({ where: { expensePolicyId: id, deletedAt: null } });
            if (catCount > 0) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Cannot delete policy. ${catCount} category(ies) still attached. Remove them first.` });
            }

            // Soft-delete the policy with renamed unique key
            await prisma.expensePolicy.update({ where: { id }, data: { deletedAt: new Date(), updatedAt: new Date(), name: `${policy.name}__deleted__${Date.now()}` } });
            // Soft-delete policy-level approval levels
            await prisma.expensePolicyApprovalLevel.updateMany({ where: { expensePolicyId: id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            // Soft-delete policy employee assignments
            await prisma.expensePolicyEmployee.updateMany({ where: { expensePolicyId: id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            // Soft-delete any remaining PolicyExpenseCategory (orphaned from prior soft-deleted state)
            const orphans = await prisma.policyExpenseCategory.findMany({ where: { expensePolicyId: id, deletedAt: null } });
            for (const orc of orphans) {
                await prisma.policyExpenseCategory.update({ where: { id: orc.id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
                await prisma.expenseCategoryRule.updateMany({ where: { policyCategoryId: orc.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
                await prisma.policyCategoryApprovalLevel.updateMany({ where: { policyCategoryId: orc.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            }
            callback(null, { success: true, message: 'Expense policy deleted successfully' });
        } catch (e) {
            console.error('DeleteExpensePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateExpensePolicyStatus: async (call, callback) => {
        try {
            const { id, organization_id, is_active } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const policy = await prisma.expensePolicy.findFirst({ where: { id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            const updated = await prisma.expensePolicy.update({
                where: { id },
                data: { isActive: Boolean(is_active), updatedAt: new Date() },
                include: { approvalLevels: { where: { deletedAt: null }, orderBy: { level: 'asc' } } },
            });
            const categoryCount = await prisma.policyExpenseCategory.count({ where: { expensePolicyId: id, deletedAt: null } });
            const withCount = { ...updated, _count: { policyCategories: categoryCount } };
            callback(null, { expense_policy: mapExpensePolicy(withCount), message: is_active ? 'Expense policy activated' : 'Expense policy deactivated', success: true });
        } catch (e) {
            console.error('UpdateExpensePolicyStatus Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    AddPolicyCategories: async (call, callback) => {
        try {
            const { expense_policy_id, organization_id, expense_category_ids } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            if (!Array.isArray(expense_category_ids) || expense_category_ids.length === 0) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least one expense category is required.' });
            }
            for (const cid of expense_category_ids) {
                if (!/^[0-9a-fA-F]{24}$/.test(cid)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: `Invalid expense category id: ${cid}` });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });

            // Validate all categories exist, belong to same org, active, not deleted
            const categories = await prisma.expenseCategory.findMany({
                where: { id: { in: expense_category_ids }, deletedAt: null },
                include: { usageType: true },
            });
            if (categories.length !== expense_category_ids.length) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'One or more expense categories not found.' });
            }
            for (const cat of categories) {
                if (String(cat.organizationId) !== String(policy.organizationId)) {
                    return callback({ code: grpc.status.PERMISSION_DENIED, message: `Category '${cat.name}' does not belong to this organization.` });
                }
                if (!cat.isActive) {
                    return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Category '${cat.name}' is inactive and cannot be attached.` });
                }
            }

            // Check already attached
            const existing = await prisma.policyExpenseCategory.findMany({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: { in: expense_category_ids }, deletedAt: null },
            });
            const existingIds = new Set(existing.map(e => String(e.expenseCategoryId)));
            const toCreate = expense_category_ids.filter(id => !existingIds.has(String(id)));

            if (toCreate.length === 0) {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: 'All selected categories are already attached to this policy.' });
            }

            // Hard-delete any soft-deleted duplicates to free unique
            for (const cid of toCreate) {
                await prisma.policyExpenseCategory.deleteMany({ where: { expensePolicyId: expense_policy_id, expenseCategoryId: cid } });
            }

            await prisma.policyExpenseCategory.createMany({
                data: toCreate.map(cid => ({
                    organizationId: policy.organizationId,
                    expensePolicyId: expense_policy_id,
                    expenseCategoryId: cid,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                })),
            });

            callback(null, { added_count: toCreate.length, success: true, message: `${toCreate.length} category(ies) added to policy` });
        } catch (e) {
            if (e.code === 'P2002') {
                return callback({ code: grpc.status.ALREADY_EXISTS, message: 'One or more categories are already attached to this policy.' });
            }
            console.error('AddPolicyCategories Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPolicyCategories: async (call, callback) => {
        try {
            const { expense_policy_id, organization_id, page = 1, limit = 10, search = '' } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });

            const skip = (page - 1) * limit;
            let where = { expensePolicyId: expense_policy_id, deletedAt: null };
            if (organization_id) where.organizationId = organization_id;

            const all = await prisma.policyExpenseCategory.findMany({
                where,
                include: { expenseCategory: { include: { usageType: true } } },
                orderBy: { createdAt: 'desc' },
            });

            // Filter by search in JS (name, expenseCode, usageType)
            let filtered = all;
            if (search) {
                const q = search.toLowerCase();
                filtered = all.filter(pc => {
                    const cat = pc.expenseCategory;
                    if (!cat) return false;
                    return (cat.name || '').toLowerCase().includes(q) ||
                        (cat.expenseCode || '').toLowerCase().includes(q) ||
                        (cat.usageType?.name || '').toLowerCase().includes(q);
                });
            }

            const total = filtered.length;
            const paged = filtered.slice(skip, skip + limit);

            const policyCategories = paged.map(pc => {
                const cat = pc.expenseCategory;
                return {
                    id: pc.id,
                    expense_policy_id: pc.expensePolicyId,
                    expense_category_id: pc.expenseCategoryId,
                    organization_id: pc.organizationId,
                    name: cat?.name || '',
                    expense_code: cat?.expenseCode || '',
                    icon: cat?.icon || '',
                    description: cat?.description || '',
                    usage_type_id: cat?.usageTypeId || '',
                    usage_type_name: cat?.usageType?.name || '',
                    is_active: cat?.isActive ?? true,
                    created_at: pc.createdAt ? pc.createdAt.toISOString() : '',
                    updated_at: pc.updatedAt ? pc.updatedAt.toISOString() : '',
                };
            });

            callback(null, {
                policy_categories: policyCategories,
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Policy categories found successfully',
            });
        } catch (e) {
            console.error('ListPolicyCategories Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RemovePolicyCategory: async (call, callback) => {
        try {
            const { expense_policy_id, expense_category_id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id) || !/^[0-9a-fA-F]{24}$/.test(expense_category_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid policy or category id' });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });

            const rel = await prisma.policyExpenseCategory.findFirst({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: expense_category_id, deletedAt: null },
            });
            if (!rel) return callback({ code: grpc.status.NOT_FOUND, message: 'Category not attached to this policy' });

            await prisma.policyExpenseCategory.update({ where: { id: rel.id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            // Also soft-delete related rules and category-level approval levels
            await prisma.expenseCategoryRule.updateMany({ where: { policyCategoryId: rel.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            await prisma.policyCategoryApprovalLevel.updateMany({ where: { policyCategoryId: rel.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });

            callback(null, { success: true, message: 'Category removed from policy' });
        } catch (e) {
            console.error('RemovePolicyCategory Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetCategoryRules: async (call, callback) => {
        try {
            const { expense_policy_id, expense_category_id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id) || !/^[0-9a-fA-F]{24}$/.test(expense_category_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid policy or category id' });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });

            const rel = await prisma.policyExpenseCategory.findFirst({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: expense_category_id, deletedAt: null },
            });
            if (!rel) return callback({ code: grpc.status.NOT_FOUND, message: 'Category not attached to this policy' });

            let rule = await prisma.expenseCategoryRule.findFirst({ where: { policyCategoryId: rel.id, deletedAt: null } });
            if (!rule) {
                // Return empty rule with defaults (not yet configured)
                rule = {
                    id: '',
                    policyCategoryId: rel.id,
                    amountCapEnabled: false,
                    amountCapCurrency: policy.baseCurrency || 'INR',
                    amountCapAmount: 0,
                    amountCapPeriod: 'MONTH',
                    combinationEnabled: false,
                    combinationCategoryId: '',
                    combinationPeriod: 'MONTH',
                    instancesEnabled: false,
                    maxInstances: 0,
                    instancesPeriod: 'MONTH',
                    expiryEnabled: false,
                    expiryDays: 0,
                    costCenterRequired: false,
                    commentThresholdEnabled: false,
                    commentThresholdAmount: 0,
                    receiptThresholdEnabled: false,
                    receiptThresholdAmount: 0,
                    thresholdApprovalEnabled: false,
                    thresholdCurrency: policy.baseCurrency || 'INR',
                    thresholdAmount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            }

            callback(null, { rule: mapExpenseCategoryRule(rule), message: 'Rules found', success: true });
        } catch (e) {
            console.error('GetCategoryRules Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateCategoryRules: async (call, callback) => {
        try {
            const { expense_policy_id, expense_category_id, organization_id, rule } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id) || !/^[0-9a-fA-F]{24}$/.test(expense_category_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid policy or category id' });
            }
            if (!rule) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Rule payload is required.' });

            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });

            const rel = await prisma.policyExpenseCategory.findFirst({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: expense_category_id, deletedAt: null },
            });
            if (!rel) return callback({ code: grpc.status.NOT_FOUND, message: 'Category not attached to this policy' });

            // Validation per spec
            const validPeriods = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR', 'TENURE'];
            if (rule.amount_cap_enabled) {
                if (!rule.amount_cap_amount || Number(rule.amount_cap_amount) <= 0) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Amount cap amount must be greater than 0.' });
                }
                if (!rule.amount_cap_period || !validPeriods.includes(rule.amount_cap_period)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Amount cap period is required.' });
                }
            }
            if (rule.combination_enabled) {
                if (!rule.combination_category_id || !/^[0-9a-fA-F]{24}$/.test(rule.combination_category_id)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Combination category is required.' });
                }
                if (String(rule.combination_category_id) === String(expense_category_id)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Cannot select the same category for combination.' });
                }
                const comboCat = await prisma.expenseCategory.findFirst({ where: { id: rule.combination_category_id, deletedAt: null } });
                if (!comboCat) return callback({ code: grpc.status.NOT_FOUND, message: 'Combination category not found.' });
                if (String(comboCat.organizationId) !== String(policy.organizationId)) {
                    return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Combination category does not belong to this organization.' });
                }
                if (!comboCat.isActive) {
                    return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Combination category is inactive.' });
                }
                if (!rule.combination_period || !validPeriods.includes(rule.combination_period)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Combination period is required.' });
                }
            }
            if (rule.instances_enabled) {
                if (!rule.max_instances || Number(rule.max_instances) <= 0 || !Number.isInteger(Number(rule.max_instances))) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Max instances must be a positive integer.' });
                }
                if (!rule.instances_period || !validPeriods.includes(rule.instances_period)) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Instances period is required.' });
                }
            }
            if (rule.expiry_enabled) {
                if (!rule.expiry_days || Number(rule.expiry_days) <= 0 || !Number.isInteger(Number(rule.expiry_days))) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Expiry days must be a positive integer.' });
                }
            }
            if (rule.comment_threshold_enabled) {
                if (!rule.comment_threshold_amount || Number(rule.comment_threshold_amount) <= 0) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Comment threshold amount must be greater than 0.' });
                }
            }
            if (rule.receipt_threshold_enabled) {
                if (!rule.receipt_threshold_amount || Number(rule.receipt_threshold_amount) <= 0) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Receipt threshold amount must be greater than 0.' });
                }
            }
            if (rule.threshold_approval_enabled) {
                if (!rule.threshold_amount || Number(rule.threshold_amount) <= 0) {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Threshold approval amount must be greater than 0.' });
                }
            }

            // Upsert: one active rule per policyCategory
            let existingRule = await prisma.expenseCategoryRule.findFirst({ where: { policyCategoryId: rel.id, deletedAt: null } });
            let saved;
            const data = {
                policyCategoryId: rel.id,
                amountCapEnabled: Boolean(rule.amount_cap_enabled),
                amountCapCurrency: rule.amount_cap_currency || policy.baseCurrency || 'INR',
                amountCapAmount: rule.amount_cap_enabled ? Number(rule.amount_cap_amount) : null,
                amountCapPeriod: rule.amount_cap_enabled ? rule.amount_cap_period : null,
                combinationEnabled: Boolean(rule.combination_enabled),
                combinationCategoryId: rule.combination_enabled ? rule.combination_category_id : null,
                combinationPeriod: rule.combination_enabled ? rule.combination_period : null,
                instancesEnabled: Boolean(rule.instances_enabled),
                maxInstances: rule.instances_enabled ? Number(rule.max_instances) : null,
                instancesPeriod: rule.instances_enabled ? rule.instances_period : null,
                expiryEnabled: Boolean(rule.expiry_enabled),
                expiryDays: rule.expiry_enabled ? Number(rule.expiry_days) : null,
                costCenterRequired: Boolean(rule.cost_center_required),
                commentThresholdEnabled: Boolean(rule.comment_threshold_enabled),
                commentThresholdAmount: rule.comment_threshold_enabled ? Number(rule.comment_threshold_amount) : null,
                receiptThresholdEnabled: Boolean(rule.receipt_threshold_enabled),
                receiptThresholdAmount: rule.receipt_threshold_enabled ? Number(rule.receipt_threshold_amount) : null,
                thresholdApprovalEnabled: Boolean(rule.threshold_approval_enabled),
                thresholdCurrency: rule.threshold_approval_enabled ? (rule.threshold_currency || policy.baseCurrency || 'INR') : null,
                thresholdAmount: rule.threshold_approval_enabled ? Number(rule.threshold_amount) : null,
                updatedAt: new Date(),
                deletedAt: null,
            };

            if (existingRule) {
                saved = await prisma.expenseCategoryRule.update({ where: { id: existingRule.id }, data });
            } else {
                saved = await prisma.expenseCategoryRule.create({
                    data: { ...data, id: undefined, createdAt: new Date() },
                });
            }

            callback(null, { rule: mapExpenseCategoryRule(saved), message: 'Rules updated successfully', success: true });
        } catch (e) {
            console.error('UpdateCategoryRules Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetCategoryApproval: async (call, callback) => {
        try {
            const { expense_policy_id, expense_category_id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id) || !/^[0-9a-fA-F]{24}$/.test(expense_category_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid policy or category id' });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            if (!policy.approvalRequired) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Policy does not require approval' });
            }
            if (policy.approvalMode !== 'BY_CATEGORY') {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Policy approval mode is not BY_CATEGORY' });
            }
            const rel = await prisma.policyExpenseCategory.findFirst({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: expense_category_id, deletedAt: null },
            });
            if (!rel) return callback({ code: grpc.status.NOT_FOUND, message: 'Category not attached to this policy' });

            const levels = await prisma.policyCategoryApprovalLevel.findMany({
                where: { policyCategoryId: rel.id, deletedAt: null },
                orderBy: { level: 'asc' },
            });

            callback(null, { levels: levels.map(mapPolicyCategoryApprovalLevel), message: 'Approval chain found', success: true });
        } catch (e) {
            console.error('GetCategoryApproval Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateCategoryApproval: async (call, callback) => {
        try {
            const { expense_policy_id, expense_category_id, organization_id, levels } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id) || !/^[0-9a-fA-F]{24}$/.test(expense_category_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid policy or category id' });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, organizationId: organization_id || undefined, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            if (!policy.approvalRequired) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Policy does not require approval' });
            }
            if (policy.approvalMode !== 'BY_CATEGORY') {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Policy approval mode is not BY_CATEGORY. Category approval not allowed.' });
            }
            const rel = await prisma.policyExpenseCategory.findFirst({
                where: { expensePolicyId: expense_policy_id, expenseCategoryId: expense_category_id, deletedAt: null },
            });
            if (!rel) return callback({ code: grpc.status.NOT_FOUND, message: 'Category not attached to this policy' });

            const incoming = levels || [];
            if (incoming.length === 0) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least one approval level is required.' });
            }
            const err = validateApprovalLevels(incoming);
            if (err) return callback({ code: grpc.status.INVALID_ARGUMENT, message: err });

            // Validate approvers belong to same org
            for (const l of incoming) {
                if (l.approver_type === 'EMPLOYEE') {
                    const emp = await prisma.organizationEmployees.findFirst({ where: { id: l.approver_id, deletedAt: null } });
                    if (!emp) return callback({ code: grpc.status.NOT_FOUND, message: `Employee ${l.approver_id} not found` });
                    if (String(emp.organizationId) !== String(policy.organizationId)) {
                        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Approver does not belong to this organization.' });
                    }
                } else if (l.approver_type === 'ROLE') {
                    // Roles are not strictly validated against DB here; check if needed
                    // For now, allow any role id that is valid ObjectId, as roles are not in Prisma
                }
            }

            // Replace: soft-delete old, create new
            await prisma.policyCategoryApprovalLevel.updateMany({ where: { policyCategoryId: rel.id, deletedAt: null }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            const created = await prisma.policyCategoryApprovalLevel.createMany({
                data: incoming.map((l, idx) => ({
                    policyCategoryId: rel.id,
                    level: l.level || idx + 1,
                    approverType: l.approver_type,
                    approverId: l.approver_id,
                    approverName: l.approver_name || '',
                    autoApprove: Boolean(l.auto_approve),
                    autoApproveDays: l.auto_approve ? Number(l.auto_approve_days) : null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                })),
            });

            const fresh = await prisma.policyCategoryApprovalLevel.findMany({ where: { policyCategoryId: rel.id, deletedAt: null }, orderBy: { level: 'asc' } });
            callback(null, { levels: fresh.map(mapPolicyCategoryApprovalLevel), message: 'Category approval chain updated successfully', success: true });
        } catch (e) {
            console.error('UpdateCategoryApproval Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPolicyEmployees: async (call, callback) => {
        try {
            const { expense_policy_id, organization_id, search = '', page = 1, limit = 10 } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            if (organization_id && String(organization_id) !== String(policy.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Policy does not belong to this organization.' });
            }

            const skip = (page - 1) * limit;
            const where = { expensePolicyId: expense_policy_id, deletedAt: null };

            const assignments = await prisma.expensePolicyEmployee.findMany({ where, orderBy: { createdAt: 'desc' } });
            const empIds = assignments.map(a => a.employeeId);

            let empWhere = { id: { in: empIds }, deletedAt: null, isActive: true };
            if (search) {
                const q = search.toLowerCase();
                empWhere = {
                    id: { in: empIds }, deletedAt: null, isActive: true,
                    OR: [
                        { fullName: { contains: q, mode: 'insensitive' } },
                        { employeeCode: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } },
                    ],
                };
            }

            const total = await prisma.organizationEmployees.count({ where: empWhere });
            const employees = await prisma.organizationEmployees.findMany({
                where: empWhere,
                include: {
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    departmentAssignments: { where: { deletedAt: null }, include: { department: true } },
                },
                orderBy: { fullName: 'asc' },
                skip,
                take: limit,
            });

            const result = employees.map(e => ({
                id: '',
                organization_id: e.organizationId ?? '',
                expense_policy_id,
                employee_id: e.id,
                employee_number: e.employeeCode ?? '',
                employee_name: e.fullName ?? '',
                department: e.departmentAssignments?.[0]?.department?.name ?? '',
                job_title: e.designation?.name ?? '',
                reporting_to: e.manager?.fullName ?? '',
                location: e.location?.name ?? e.branch?.name ?? '',
                created_at: '',
            }));

            callback(null, {
                employees: result,
                total, page, limit,
                total_pages: Math.ceil(total / limit),
                success: true, message: 'Policy employees found',
            });
        } catch (e) {
            console.error('ListPolicyEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    AssignPolicyEmployees: async (call, callback) => {
        try {
            const { expense_policy_id, organization_id, employee_ids = [] } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'employee_ids is required and must be a non-empty array.' });
            }
            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            if (organization_id && String(organization_id) !== String(policy.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Policy does not belong to this organization.' });
            }

            const validEmpIds = employee_ids.filter(id => /^[0-9a-fA-F]{24}$/.test(id));
            if (validEmpIds.length === 0) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'No valid employee ids provided.' });

            const employees = await prisma.organizationEmployees.findMany({ where: { id: { in: validEmpIds }, deletedAt: null, isActive: true } });
            const validEmpSet = new Set(employees.map(e => e.id));
            const invalidCount = validEmpIds.filter(id => !validEmpSet.has(id)).length;

            for (const emp of employees) {
                if (String(emp.organizationId) !== String(policy.organizationId)) {
                    return callback({ code: grpc.status.PERMISSION_DENIED, message: `Employee ${emp.id} does not belong to this organization.` });
                }
            }

            const existing = await prisma.expensePolicyEmployee.findMany({ where: { expensePolicyId: expense_policy_id, employeeId: { in: validEmpIds }, deletedAt: null } });
            const existingSet = new Set(existing.map(e => e.employeeId));

            const toCreate = validEmpIds.filter(id => !existingSet.has(id));
            if (toCreate.length > 0) {
                await prisma.expensePolicyEmployee.createMany({
                    data: toCreate.map(empId => ({
                        organizationId: policy.organizationId,
                        expensePolicyId: expense_policy_id,
                        employeeId: empId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    })),
                });
            }

            callback(null, {
                added_count: toCreate.length,
                already_assigned_count: existingSet.size,
                success: true,
                message: `${toCreate.length} employee(s) assigned. ${existingSet.size} already assigned.`,
            });
        } catch (e) {
            console.error('AssignPolicyEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RemovePolicyEmployee: async (call, callback) => {
        try {
            const { expense_policy_id, employee_id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(expense_policy_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid expense policy id' });
            if (!/^[0-9a-fA-F]{24}$/.test(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });

            const policy = await prisma.expensePolicy.findFirst({ where: { id: expense_policy_id, deletedAt: null } });
            if (!policy) return callback({ code: grpc.status.NOT_FOUND, message: 'Expense policy not found' });
            if (organization_id && String(organization_id) !== String(policy.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Policy does not belong to this organization.' });
            }

            const assignment = await prisma.expensePolicyEmployee.findFirst({ where: { expensePolicyId: expense_policy_id, employeeId: employee_id, deletedAt: null } });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee assignment not found.' });

            await prisma.expensePolicyEmployee.update({ where: { id: assignment.id }, data: { deletedAt: new Date(), updatedAt: new Date() } });

            callback(null, { success: true, message: 'Employee removed from policy.' });
        } catch (e) {
            console.error('RemovePolicyEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('expense-policy-service');
    const server = new grpc.Server();
    server.addService(expensePolicyProto.ExpensePolicyService.service, impl);
    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    console.log(`[expense-policy-service] gRPC running on :${PORT}`);
    const shutdown = async (signal) => {
        console.log(`\n[expense-policy-service] Received ${signal}, shutting down...`);
        try { server.tryShutdown(() => console.log('[expense-policy-service] gRPC stopped.')); await prisma.$disconnect(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('[expense-policy-service] Fatal error:', err); process.exit(1); });
