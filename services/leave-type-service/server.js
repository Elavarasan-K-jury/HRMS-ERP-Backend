import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.LEAVE_TYPE_SERVICE_PORT || 5077;
const proto = loadProto('leave_type');

/* ========================= HELPERS ========================= */

function toAPI(t) {
    return {
        id: t.id,
        organization_id: t.organizationId,
        name: t.name,
        code: t.code,
        description: t.description || '',

        paid: t.paid,
        max_per_year: t.maxPerYear || 0,

        allow_half_day: t.allowHalfDay,
        requires_document: t.requiresDocument,
        document_after_days: t.documentAfterDays || 0,

        carry_forward: t.carryForward,
        max_carry_forward: t.maxCarryForward || 0,

        encashment_allowed: t.encashmentAllowed,
        max_encash_per_year: t.maxEncashPerYear || 0,

        gender_restriction: t.genderRestriction || 'NONE',

        probation_allowed: t.probationAllowed,
        min_service_months: t.minServiceMonths || 0,

        max_consecutive_days: t.maxConsecutiveDays || 0,
        sandwich_rule: t.sandwichRule,

        default_annual_allocation: t.defaultAnnualAllocation ?? null,

        accrual_enabled: t.accrualEnabled,
        accrual_frequency: t.accrualFrequency,
        accrue_after_days: t.accrueAfterDays || 0,
        monthly_accrual_rate: t.monthlyAccrualRate || 0,

        is_active: t.isActive,

        created_at: t.createdAt?.toISOString() || '',
        updated_at: t.updatedAt?.toISOString() || '',
        deleted_at: t.deletedAt?.toISOString() || '',
    };
}

/* ========================= IMPLEMENTATION ========================= */

const impl = {

    CreateLeaveType: async (call, cb) => {
        try {
            const data = call.request;

            const type = await prisma.leaveTypes.create({
                data: { deletedAt: null,
                    organizationId: data.organization_id,
                    name: data.name,
                    code: data.code,
                    description: data.description,

                    paid: data.paid,
                    maxPerYear: data.max_per_year,

                    allowHalfDay: data.allow_half_day,
                    requiresDocument: data.requires_document,
                    documentAfterDays: data.document_after_days,

                    carryForward: data.carry_forward,
                    maxCarryForward: data.max_carry_forward,

                    encashmentAllowed: data.encashment_allowed,
                    maxEncashPerYear: data.max_encash_per_year,

                    genderRestriction: data.gender_restriction,

                    probationAllowed: data.probation_allowed,
                    minServiceMonths: data.min_service_months,

                    maxConsecutiveDays: data.max_consecutive_days,
                    sandwichRule: data.sandwich_rule,

                    defaultAnnualAllocation: data.default_annual_allocation ?? null,

                    accrualEnabled: data.accrual_enabled,
                    accrualFrequency: data.accrual_frequency,
                    accrueAfterDays: data.accrue_after_days,
                    monthlyAccrualRate: data.monthly_accrual_rate,

                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            cb(null, { leave_type: toAPI(type), success: "true", message: "Leave type created" });
        } catch (err) {
            cb({ code: grpc.status.INTERNAL, message: err.message });
        }
    },

    UpdateLeaveType: async (call, cb) => {
        try {
            const { id, data } = call.request;

            const type = await prisma.leaveTypes.findFirst({ where: { deletedAt: null, id } });
            if (!type) return cb({ code: grpc.status.NOT_FOUND, message: "Leave type not found" });

            const updated = await prisma.leaveTypes.update({
                where: { id },
                data: {
                    updatedAt: new Date(),
                    ...{
                        organizationId: data.organization_id,
                        name: data.name,
                        code: data.code,
                        description: data.description || type.description,

                        paid: data.paid,
                        maxPerYear: data.max_per_year,

                        allowHalfDay: data.allow_half_day,
                        requiresDocument: data.requires_document,
                        documentAfterDays: data.document_after_days,

                        carryForward: data.carry_forward,
                        maxCarryForward: data.max_carry_forward,

                        encashmentAllowed: data.encashment_allowed,
                        maxEncashPerYear: data.max_encash_per_year,

                        genderRestriction: data.gender_restriction,

                        probationAllowed: data.probation_allowed,
                        minServiceMonths: data.min_service_months,

                        maxConsecutiveDays: data.max_consecutive_days,
                        sandwichRule: data.sandwich_rule,

                        defaultAnnualAllocation: data.default_annual_allocation ?? type.defaultAnnualAllocation,

                        accrualEnabled: data.accrual_enabled,
                        accrualFrequency: data.accrual_frequency,
                        accrueAfterDays: data.accrue_after_days,
                        monthlyAccrualRate: data.monthly_accrual_rate,
                    },
                }
            });

            cb(null, { leave_type: toAPI(updated), success: "true", message: "Updated successfully" });

        } catch (err) {
            cb({ code: grpc.status.INTERNAL, message: err.message });
        }
    },

    GetLeaveType: async (call, cb) => {
        try {
            const { id } = call.request;

            const type = await prisma.leaveTypes.findFirst({ where: { deletedAt: null, id } });
            if (!type) return cb({ code: grpc.status.NOT_FOUND, message: "Leave type not found" });

            cb(null, { leave_type: toAPI(type), success: "true", message: "Found" });
        } catch (err) {
            cb({ code: grpc.status.INTERNAL, message: err.message });
        }
    },

    ListLeaveTypes: async (call, cb) => {
        try {
            const { organization_id } = call.request;

            const types = await prisma.leaveTypes.findMany({
                where: { deletedAt: null, organizationId: organization_id },
                orderBy: { createdAt: 'desc' }
            });

            cb(null, { leave_types: types.map(toAPI) });
        } catch (err) {
            cb({ code: grpc.status.INTERNAL, message: err.message });
        }
    },

    DeleteLeaveType: async (call, cb) => {
        try {
            const { id } = call.request;

            const type = await prisma.leaveTypes.findFirst({ where: { deletedAt: null, id } });
            if (!type) return cb({ code: grpc.status.NOT_FOUND, message: "Leave type not found" });

            await prisma.leaveTypes.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() }
            });

            cb(null, { success: "true", message: "Deleted successfully" });

        } catch (err) {
            cb({ code: grpc.status.INTERNAL, message: err.message });
        }
    }
};

/* ========================= START SERVER ========================= */

async function main() {
    await checkDbConnection('leave-type-service');

    const server = new grpc.Server();
    server.addService(proto.LeaveTypeService.service, impl);

    await new Promise((resolve, reject) =>
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            err => err ? reject(err) : resolve()
        )
    );

    console.log(`[leave-type-service] gRPC running on :${PORT}`);
}

main().catch((err) => {
    console.error('[leave-type-service] Fatal error:', err);
    process.exit(1);
});
