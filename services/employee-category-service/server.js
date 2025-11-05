import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { ObjectId } from "mongodb";

const PORT = Number(process.env.EMP_CAT_SERVICE_PORT || 50052);
const employeeCategoryProto = loadProto('employee_category');

const impl = {
    CreateEmployeeCategory: async (call, callback) => {
        try {
            const data = call.request;

            const existing = await prisma.employeeCategories.findFirst({
                where: { name: data.name },
            });

            if (existing && existing.deletedAt === null) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Employee category already exists',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                idPrefix: data.id_prefix ?? null,
                isPermanent: data.is_permanent,
                benefitsApplicable: data.benefits_applicable,
                onboardingWorkflow: ObjectId.isValid(data.onboarding_workflow)
                    ? data.onboarding_workflow
                    : null,
                isActive: data.is_active,
                trainingRequired: data.training_required,
                trainingMonths: data.training_months,
                probationRequired: data.probation_required,
                probationMonths: data.probation_months,
                noticeRequired: data.notice_required,
                noticeMonths: data.notice_months,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            let category;
            if (existing && existing.deletedAt !== null) {
                category = await prisma.employeeCategories.update({
                    where: { id: existing.id },
                    data: mappedData,
                });
            } else {
                category = await prisma.employeeCategories.create({ data: mappedData });
            }

            callback(null, { category: mapCategory(category) });
        } catch (e) {
            console.error('CreateEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    GetEmployeeCategory: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const category = await prisma.employeeCategories.findUnique({
                where: { id, deletedAt: null },
            });

            if (!category) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee category not found',
                });
            }

            callback(null, { category: mapCategory(category) });
        } catch (e) {
            console.error('GetEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListEmployeeCategories: async (call, callback) => {
        try {
            const { organization_id } = call.request;

            const categories = await prisma.employeeCategories.findMany({
                where: {
                    deletedAt: null,
                    organizationId: organization_id,
                },
                orderBy: { createdAt: 'desc' },
            });

            callback(null, { categories: categories.map(mapCategory) });
        } catch (e) {
            console.error('ListEmployeeCategories Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateEmployeeCategory: async (call, callback) => {
        try {
            const data = call.request;
            console.log('🔹 Incoming update payload:', data);

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            // ✅ Sanitize onboarding_workflow completely
            let validOnboardingWorkflow = null;
            if (data.onboarding_workflow && ObjectId.isValid(data.onboarding_workflow)) {
                validOnboardingWorkflow = data.onboarding_workflow;
            } else {
                console.warn(
                    `⚠️ Invalid onboarding_workflow "${data.onboarding_workflow}" replaced with null`
                );
            }

            // ✅ Also sanitize organization_id (if it's ObjectId in DB)
            let validOrganizationId = null;
            if (data.organization_id && ObjectId.isValid(data.organization_id)) {
                validOrganizationId = data.organization_id;
            } else {
                console.warn(
                    `⚠️ Invalid organization_id "${data.organization_id}" replaced with null`
                );
            }

            const updated = await prisma.employeeCategories.update({
                where: { id: data.id },
                data: {
                    organizationId: validOrganizationId,
                    name: data.name,
                    code: data.code ?? null,
                    description: data.description ?? null,
                    idPrefix: data.id_prefix ?? null,
                    isPermanent: data.is_permanent,
                    benefitsApplicable: data.benefits_applicable,
                    onboardingWorkflow: validOnboardingWorkflow,
                    isActive: data.is_active,
                    trainingRequired: data.training_required,
                    trainingMonths: data.training_months,
                    probationRequired: data.probation_required,
                    probationMonths: data.probation_months,
                    noticeRequired: data.notice_required,
                    noticeMonths: data.notice_months,
                    updatedAt: new Date(),
                },
            });

            callback(null, { category: mapCategory(updated) });
        } catch (e) {
            console.error('❌ UpdateEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteEmployeeCategory: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            await prisma.employeeCategories.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Deleted successfully' });
        } catch (e) {
            console.error('DeleteEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

function mapCategory(category) {
    return {
        id: category.id,
        organization_id: category.organizationId,
        name: category.name,
        code: category.code ?? '',
        description: category.description ?? '',
        id_prefix: category.idPrefix ?? '',
        is_permanent: category.isPermanent,
        benefits_applicable: category.benefitsApplicable,
        onboarding_workflow: category.onboardingWorkflow ?? '',
        is_active: category.isActive,
        training_required: category.trainingRequired,
        training_months: category.trainingMonths,
        probation_required: category.probationRequired,
        probation_months: category.probationMonths,
        notice_required: category.noticeRequired,
        notice_months: category.noticeMonths,
        created_at: category.createdAt ? category.createdAt.toISOString() : '',
        updated_at: category.updatedAt ? category.updatedAt.toISOString() : '',
        deleted_at: category.deletedAt ? category.deletedAt.toISOString() : '',
    };
}



async function main() {
    const server = new grpc.Server();

    server.addService(employeeCategoryProto.EmployeeCategoryService.service, impl);

    // Convert bindAsync to Promise
    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-category-service] gRPC running on :${PORT}`);

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\n[employee-category-service] Received ${signal}, shutting down gracefully...`);

        try {
            // 🧹 Stop accepting new gRPC calls
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-category-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-category-service] gRPC server stopped.');
                }
            });

            // 🧹 Disconnect Prisma cleanly
            await prisma.$disconnect();
            console.log('[employee-category-service] Prisma disconnected.');

            process.exit(0);
        } catch (e) {
            console.error('[employee-category-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    // Handle termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-category-service] Fatal error:', err);
    process.exit(1);
});