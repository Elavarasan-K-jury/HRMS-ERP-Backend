import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.EMP_ONBOARDING_FEATURE_SERVICE_PORT || 50059);
const onboardingFeatureProto = loadProto('emp_onboarding_feature');

const impl = {
    // -----------------------------
    // Create Employee Onboarding Feature
    // -----------------------------
    CreateEmployeeOnboardingFeature: async (call, callback) => {
        try {
            const data = call.request;

            const step = await prisma.employeeOnboardingSteps.findUnique({
                where: { id: data.step_id },
            });

            if (!step || step.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding step not found',
                });
            }

            const existing = await prisma.onboardingStepFeatures.findFirst({
                where: {
                    featureName: data.feature_name,
                    stepId: data.step_id,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Feature already exists for this step',
                });
            }

            const created = await prisma.onboardingStepFeatures.create({
                data: {
                    stepId: data.step_id,
                    featureName: data.feature_name,
                    featureType: data.feature_type,
                    hasOptions: data.has_options ?? false,
                    options: data.options ? JSON.parse(data.options) : null,
                },
            });

            callback(null, {
                feature: mapFeature(created),
                message: 'Feature created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreateEmployeeOnboardingFeature Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Get Employee Onboarding Feature
    // -----------------------------
    GetEmployeeOnboardingFeature: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid feature id',
                });
            }

            const feature = await prisma.onboardingStepFeatures.findUnique({
                where: { id },
            });

            if (!feature) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Feature not found',
                });
            }

            callback(null, {
                feature: mapFeature(feature),
                message: 'Feature retrieved successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetEmployeeOnboardingFeature Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // List Employee Onboarding Features
    // -----------------------------
    ListEmployeeOnboardingFeatures: async (call, callback) => {
        try {
            const {
                step_id,
                page,
                limit,
                search,
                sort_by,
                sort_order,
            } = call.request;

            let paginate = {};
            if (page && limit) {
                paginate = {
                    skip: (page - 1) * limit,
                    take: limit,
                }
            }

            let where = {
                deletedAt: null,
            };

            if (step_id) {
                where = {
                    ...where,
                    stepId: step_id,
                }
            }

            if (search) {
                where = {
                    ...where,
                    featureName: {
                        contains: search,
                        mode: 'insensitive',
                    },
                }
            }

            const orderByField = sort_by || 'createdAt';
            const order = (sort_order || 'asc').toLowerCase() === 'asc' ? 'asc' : 'desc';

            const features = await prisma.onboardingStepFeatures.findMany({
                where,
                orderBy: { [orderByField]: order },
                ...paginate,
            });
            const total = await prisma.onboardingStepFeatures.count({ where });

            callback(null, {
                features: features.map(mapFeature),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                message: 'Features retrieved successfully',
                success: true,
            });
        } catch (e) {
            console.error('ListEmployeeOnboardingFeatures Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Update Employee Onboarding Feature
    // -----------------------------
    UpdateEmployeeOnboardingFeature: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid feature id',
                });
            }

            const feature = await prisma.onboardingStepFeatures.findUnique({
                where: { id: data.id },
            });

            if (!feature) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Feature not found',
                });
            }

            const updated = await prisma.onboardingStepFeatures.update({
                where: { id: data.id },
                data: {
                    featureName: data.feature_name,
                    featureType: data.feature_type,
                    hasOptions: data.has_options,
                    options: data.options ? JSON.parse(data.options) : null,
                },
            });

            callback(null, {
                feature: mapFeature(updated),
                message: 'Feature updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdateEmployeeOnboardingFeature Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Delete Employee Onboarding Feature
    // -----------------------------
    DeleteEmployeeOnboardingFeature: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid feature id',
                });
            }

            await prisma.onboardingStepFeatures.delete({
                where: { id },
            });

            callback(null, {
                success: true,
                message: 'Feature deleted successfully'
            });
        } catch (e) {
            console.error('DeleteEmployeeOnboardingFeature Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

// ---------------------------------
// Mapper Utility
// ---------------------------------
function mapFeature(feature) {
    return {
        id: feature.id,
        step_id: feature.stepId,
        feature_name: feature.featureName,
        feature_type: feature.featureType,
        has_options: feature.hasOptions,
        options: feature.options ? JSON.stringify(feature.options) : '',
    };
}

// ---------------------------------
// Bootstrap gRPC Server
// ---------------------------------
async function main() {
    await checkDbConnection('employee-onboarding-feature-service');
    const server = new grpc.Server();
    server.addService(onboardingFeatureProto.EmployeeOnboardingFeatureService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-onboarding-feature-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-onboarding-feature-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-onboarding-feature-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-onboarding-feature-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[employee-onboarding-feature-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-onboarding-feature-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-onboarding-feature-service] Fatal error:', err);
    process.exit(1);
});
