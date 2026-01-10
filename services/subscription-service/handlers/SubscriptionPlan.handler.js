import { grpc } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

/* ============================================================
   🔍 HELPERS
============================================================ */
function normalizeName(name) {
    return name.trim().toLowerCase();
}

function validatePrices(monthly, yearly) {
    if (monthly && yearly && yearly <= monthly) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Yearly price must be greater than monthly price',
        };
    }
}

function validateGst(gst) {
    if (gst !== undefined && (gst < 0 || gst > 100)) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'GST must be between 0 and 100',
        };
    }
}

/* ============================================================
   🟢 CREATE
============================================================ */
export const createSubscriptionPlanFunc = async (call, callback) => {
    try {
        const {
            name,
            description,
            monthly_price,
            yearly_price,
            trial_days,
            gst,
        } = call.request;

        if (!name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Plan name is required',
            });
        }

        validatePrices(monthly_price, yearly_price);
        validateGst(gst);

        // 🔒 Unique name check
        const existing = await prisma.subscriptionPlans.findFirst({
            where: {
                deletedAt: null,
                name: { equals: name, mode: 'insensitive' },
            },
        });

        if (existing) {
            return callback({
                code: grpc.status.ALREADY_EXISTS,
                message: 'Subscription plan with same name already exists',
            });
        }

        /* --------------------------------------------------
           🟢 CREATE PLAN
        -------------------------------------------------- */
        const plan = await prisma.subscriptionPlans.create({
            data: {
                name: name.trim(),
                description,
                monthlyPrice: monthly_price,
                yearlyPrice: yearly_price,
                gst: gst ?? 18,
                trialDays: trial_days ?? 14,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            },
        });

        /* --------------------------------------------------
           🧩 DEFAULT LIMIT FEATURES
        -------------------------------------------------- */
        const defaultFeatures = [
            {
                key: 'max_employees',
                value: 20,
                unit: 'users',
                isUnlimited: false,
            },
            {
                key: 'storage_gb',
                value: 10,
                unit: 'GB',
                isUnlimited: false,
            },
            {
                key: 'api_rate_per_minute',
                value: 1000,
                unit: 'requests/min',
                isUnlimited: false,
            },
            {
                key: 'payroll_runs_per_month',
                value: 1,
                unit: 'runs',
                isUnlimited: false,
            },
            {
                key: 'max_leave_policies',
                value: 5,
                unit: 'policies',
                isUnlimited: false,
            },
            {
                key: 'max_admin_accounts',
                value: 3,
                unit: 'admins',
                isUnlimited: false,
            },
        ];

        await prisma.subscriptionPlanFeatures.createMany({
            data: defaultFeatures.map((f) => ({
                planId: plan.id,
                key: f.key,
                value: f.isUnlimited ? null : f.value,
                unit: f.unit,
                isUnlimited: f.isUnlimited,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            })),
        });

        /* --------------------------------------------------
           ✅ RESPONSE
        -------------------------------------------------- */
        return callback(null, {
            success: true,
            message: 'Subscription plan created successfully',
            data: mapPlan({
                ...plan,
                features: defaultFeatures,
            }),
        });
    } catch (e) {
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};


/* ============================================================
   🟠 UPDATE
============================================================ */
export const updateSubscriptionPlanFunc = async (call, callback) => {
    try {
        const { id, name, description, monthly_price, yearly_price, is_active, gst } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Plan id is required',
            });
        }

        const existing = await prisma.subscriptionPlans.findFirst({
            where: { id, deletedAt: null },
        });

        if (!existing) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Subscription plan not found',
            });
        }

        validatePrices(monthly_price ?? existing.monthlyPrice, yearly_price ?? existing.yearlyPrice);
        validateGst(gst);

        if (name && normalizeName(name) !== normalizeName(existing.name)) {
            const dup = await prisma.subscriptionPlans.findFirst({
                where: {
                    deletedAt: null,
                    name: { equals: name, mode: 'insensitive' },
                    id: { not: id },
                },
            });

            if (dup) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Subscription plan with same name already exists',
                });
            }
        }

        const updated = await prisma.subscriptionPlans.update({
            where: { id },
            data: {
                name: name?.trim(),
                description,
                monthlyPrice: monthly_price,
                yearlyPrice: yearly_price,
                isActive: is_active,
                gst,
            },
        });

        return callback(null, {
            success: true,
            message: 'Subscription plan updated successfully',
            data: mapPlan(updated),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   🔵 GET
============================================================ */
export const getSubscriptionPlanFunc = async (call, callback) => {
    try {
        const { id } = call.request;

        const plan = await prisma.subscriptionPlans.findFirst({
            where: { id, deletedAt: null },
        });

        if (!plan) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Subscription plan not found',
            });
        }

        return callback(null, {
            success: true,
            message: 'Subscription plan fetched successfully',
            data: mapPlan(plan),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   🟡 LIST (PAGINATED)
============================================================ */
export const listSubscriptionPlansFunc = async (call, callback) => {
    try {
        const { page, limit, search = '', sort_by = 'createdAt', sort_order = 'desc' } = call.request;

        let paginate = {}

        if (page && limit) {
            paginate = {
                take: limit,
                skip: (page - 1) * limit
            }
        }

        const where = {
            deletedAt: null,
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        const [total, plans] = await Promise.all([
            prisma.subscriptionPlans.count({ where }),
            prisma.subscriptionPlans.findMany({
                where,
                include: { features: true },
                orderBy: { [mapSortField(sort_by)]: sort_order },
                ...paginate
            }),
        ]);

        return callback(null, {
            success: true,
            message: 'Subscription plans fetched successfully',
            data: plans.map(mapPlan),
            total,
            page: page || 1,
            limit: limit || total,
            total_pages: page && limit ? Math.ceil(total / limit) : 1,
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   🔴 DELETE (SOFT)
============================================================ */
export const deleteSubscriptionPlanFunc = async (call, callback) => {
    try {
        const { id } = call.request;

        const exists = await prisma.subscriptionPlans.findFirst({
            where: { id, deletedAt: null },
        });

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Subscription plan not found',
            });
        }

        await prisma.subscriptionPlans.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        return callback(null, {
            success: true,
            message: 'Subscription plan deleted successfully',
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   ➕ ADD FEATURE
============================================================ */
export const AddPlanFeatureFunc = async (call, callback) => {
    try {
        const { plan_id, key, value, unit, is_unlimited } = call.request;

        if (!plan_id || !key) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'plan_id and key are required',
            });
        }

        const plan = await prisma.subscriptionPlans.findFirst({
            where: { id: plan_id, deletedAt: null },
        });

        if (!plan) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Subscription plan not found',
            });
        }

        const existing = await prisma.subscriptionPlanFeatures.findFirst({
            where: { planId: plan_id, key },
        });

        if (existing) {
            return callback({
                code: grpc.status.ALREADY_EXISTS,
                message: 'Feature already exists for this plan',
            });
        }

        const feature = await prisma.subscriptionPlanFeatures.create({
            data: {
                planId: plan_id,
                key,
                value: is_unlimited ? null : value,
                unit,
                isUnlimited: !!is_unlimited,
            },
        });

        return callback(null, {
            success: true,
            message: 'Plan feature added successfully',
            data: mapPlanFeature(feature),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   📋 LIST FEATURES
============================================================ */
export const ListPlanFeaturesFunc = async (call, callback) => {
    try {
        const { plan_id } = call.request;

        if (!plan_id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'plan_id is required',
            });
        }

        const features = await prisma.subscriptionPlanFeatures.findMany({
            where: { planId: plan_id },
            orderBy: { createdAt: 'asc' },
        });

        return callback(null, {
            success: true,
            message: 'Plan features fetched successfully',
            data: features.map(mapPlanFeature),
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   ✏️ UPDATE PLAN FEATURE
============================================================ */
export const UpdatePlanFeatureFunc = async (call, callback) => {
    try {
        const { id, value, unit, is_unlimited } = call.request;

        /* ---------------------------
           🔴 VALIDATION
        --------------------------- */
        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Feature id is required',
            });
        }

        const feature = await prisma.subscriptionPlanFeatures.findFirst({
            where: { id, deletedAt: null },
        });

        if (!feature) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Plan feature not found',
            });
        }

        /* ---------------------------
           🟢 UPDATE FEATURE
        --------------------------- */
        const updated = await prisma.subscriptionPlanFeatures.update({
            where: { id },
            data: {
                value: is_unlimited ? null : value,
                unit: unit ?? feature.unit,
                isUnlimited: !!is_unlimited,
                updatedAt: new Date(),
            },
        });

        return callback(null, {
            success: true,
            message: 'Plan feature updated successfully',
            data: mapPlanFeature(updated),
        });
    } catch (e) {
        return callback({
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};


/* ============================================================
   ➖ REMOVE FEATURE
============================================================ */
export const RemovePlanFeatureFunc = async (call, callback) => {
    try {
        const { id } = call.request;

        if (!id) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Feature id is required',
            });
        }

        const exists = await prisma.subscriptionPlanFeatures.findUnique({
            where: { id },
        });

        if (!exists) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Plan feature not found',
            });
        }

        await prisma.subscriptionPlanFeatures.delete({
            where: { id },
        });

        return callback(null, {
            success: true,
            message: 'Plan feature removed successfully',
        });
    } catch (e) {
        return callback({ code: grpc.status.INTERNAL, message: e.message });
    }
};

/* ============================================================
   🧭 MAPPERS
============================================================ */
function mapPlan(plan) {
    return {
        id: plan.id,
        name: plan.name,
        description: plan.description ?? '',
        is_active: plan.isActive,
        monthly_price: plan.monthlyPrice ?? 0,
        yearly_price: plan.yearlyPrice ?? 0,
        gst: plan.gst ?? 18,
        trial_days: plan.trialDays,
        created_at: plan.createdAt?.toISOString(),
        updated_at: plan.updatedAt?.toISOString(),
        features: plan?.features?.length ? plan.features.map(mapPlanFeature) : []
    };
}

function mapPlanFeature(feature) {
    return {
        id: feature.id,
        plan_id: feature.planId,
        key: feature.key,
        value: feature.value ?? 0,
        unit: feature.unit ?? '',
        is_unlimited: feature.isUnlimited,
    };
}

function mapSortField(field) {
    const map = {
        created_at: 'createdAt',
        updated_at: 'updatedAt',
        name: 'name',
    };
    return map[field] ?? 'createdAt';
}
