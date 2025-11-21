import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.EMP_ONBOARDING_PROGRESS_SERVICE_PORT || 50061);
const onboardingProgressProto = loadProto('emp_onboarding_progress');

const impl = {
    // -----------------------------
    // Create Employee Onboarding Progress
    // -----------------------------
    CreateEmployeeOnboardingProgress: async (call, callback) => {
        try {
            const data = call.request;

            // ✅ Validate employee
            const employee = await prisma.organizationEmployees.findUnique({
                where: { id: data.employee_id },
            });
            if (!employee) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found',
                });
            }

            // ✅ Validate flow
            const flow = await prisma.employeeOnboardingFlows.findUnique({
                where: { id: data.flow_id },
            });
            if (!flow) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding flow not found',
                });
            }

            // ✅ Validate step
            const step = await prisma.employeeOnboardingSteps.findUnique({
                where: { id: data.step_id },
            });
            if (!step) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding step not found',
                });
            }

            // ✅ Validate feature
            const feature = await prisma.onboardingStepFeatures.findUnique({
                where: { id: data.step_feature_id },
            });
            if (!feature) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding feature not found',
                });
            }

            // ✅ Check existing progress
            const existing = await prisma.onboardingProgress.findFirst({
                where: {
                    employeeId: data.employee_id,
                    flowId: data.flow_id,
                    stepId: data.step_id,
                    stepFeatureId: data.step_feature_id,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Progress record already exists for this feature',
                });
            }

            // ✅ Create progress record
            const created = await prisma.onboardingProgress.create({
                data: {
                    employeeId: data.employee_id,
                    flowId: data.flow_id,
                    stepId: data.step_id,
                    stepFeatureId: data.step_feature_id,
                    stepFeatureValue: data.step_feature_value ?? null,
                },
            });

            callback(null, { progress: mapProgress(created) });
        } catch (e) {
            console.error('CreateEmployeeOnboardingProgress Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Get Employee Onboarding Progress
    // -----------------------------
    GetEmployeeOnboardingProgress: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid progress id',
                });
            }

            const progress = await prisma.onboardingProgress.findUnique({
                where: { id },
            });

            if (!progress) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Progress not found',
                });
            }

            callback(null, { progress: mapProgress(progress) });
        } catch (e) {
            console.error('GetEmployeeOnboardingProgress Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // List Employee Onboarding Progress (by Employee or Flow)
    // -----------------------------
    ListEmployeeOnboardingProgresses: async (call, callback) => {
        try {
            const { employee_id, flow_id } = call.request;

            const progresses = await prisma.onboardingProgress.findMany({
                where: {
                    ...(employee_id ? { employeeId: employee_id } : {}),
                    ...(flow_id ? { flowId: flow_id } : {}),
                },
                orderBy: { id: 'asc' },
            });

            callback(null, { progresses: progresses.map(mapProgress) });
        } catch (e) {
            console.error('ListEmployeeOnboardingProgresses Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Update Employee Onboarding Progress
    // -----------------------------
    UpdateEmployeeOnboardingProgress: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid progress id',
                });
            }

            const progress = await prisma.onboardingProgress.findUnique({
                where: { id: data.id },
            });

            if (!progress) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Progress not found',
                });
            }

            const updated = await prisma.onboardingProgress.update({
                where: { id: data.id },
                data: {
                    stepFeatureValue: data.step_feature_value ?? progress.stepFeatureValue,
                },
            });

            callback(null, { progress: mapProgress(updated) });
        } catch (e) {
            console.error('UpdateEmployeeOnboardingProgress Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Delete Employee Onboarding Progress
    // -----------------------------
    DeleteEmployeeOnboardingProgress: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid progress id',
                });
            }

            await prisma.onboardingProgress.delete({
                where: { id },
            });

            callback(null, { success: true, message: 'Progress deleted successfully' });
        } catch (e) {
            console.error('DeleteEmployeeOnboardingProgress Error:', e);
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
function mapProgress(progress) {
    return {
        id: progress.id,
        employee_id: progress.employeeId,
        flow_id: progress.flowId,
        step_id: progress.stepId,
        step_feature_id: progress.stepFeatureId,
        step_feature_value: progress.stepFeatureValue ?? '',
    };
}

// ---------------------------------
// Bootstrap gRPC Server
// ---------------------------------
async function main() {
    await checkDbConnection('employee-onboarding-progress-service');
    const server = new grpc.Server();

    server.addService(onboardingProgressProto.EmployeeOnboardingProgressService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-onboarding-progress-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-onboarding-progress-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-onboarding-progress-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-onboarding-progress-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[employee-onboarding-progress-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-onboarding-progress-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-onboarding-progress-service] Fatal error:', err);
    process.exit(1);
});
