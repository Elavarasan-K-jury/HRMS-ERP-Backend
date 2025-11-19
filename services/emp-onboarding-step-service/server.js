import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.EMP_ONBOARDING_STEP_SERVICE_PORT || 50058);
const onboardingStepProto = loadProto('emp_onboarding_step');

const impl = {
    // -----------------------------
    // Create Employee Onboarding Step
    // -----------------------------
    CreateEmployeeOnboardingStep: async (call, callback) => {
        try {
            const data = call.request;

            // Validate flow existence
            const flow = await prisma.employeeOnboardingFlows.findUnique({
                where: { id: data.onboarding_id },
            });

            if (!flow || flow.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding flow not found',
                });
            }

            const existing = await prisma.employeeOnboardingSteps.findFirst({
                where: {
                    name: data.name,
                    onboardingId: data.onboarding_id,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Step already exists for this onboarding flow',
                });
            }

            const created = await prisma.employeeOnboardingSteps.create({
                data: {
                    onboardingId: data.onboarding_id,
                    name: data.name,
                    isActive: data.is_active ?? true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                step: mapStep(created),
                message: 'Step created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreateEmployeeOnboardingStep Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Get Employee Onboarding Step
    // -----------------------------
    GetEmployeeOnboardingStep: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid step id',
                });
            }

            const step = await prisma.employeeOnboardingSteps.findUnique({
                where: { id },
            });

            if (!step || step.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding step not found',
                });
            }

            callback(null, {
                step: mapStep(step),
                message: 'Step found successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetEmployeeOnboardingStep Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // List Employee Onboarding Steps
    // -----------------------------
    ListEmployeeOnboardingSteps: async (call, callback) => {
        try {
            const {
                onboarding_id,
                page,
                limit,
                search,
                sort_by,
                sort_order,
            } = call.request;

            let paginate = {}
            if (page && limit) {
                paginate = {
                    skip: (page - 1) * limit,
                    take: limit,
                }
            }

            let where = {
                deletedAt: null,
            };

            if (onboarding_id) {
                where = {
                    ...where,
                    onboardingId: onboarding_id,
                }
            }

            if (search != '' && search != null) {
                where = {
                    ...where,
                    name: {
                        contains: search,
                        mode: 'insensitive',
                    },
                }
            }

            const steps = await prisma.employeeOnboardingSteps.findMany({
                where,
                orderBy: {
                    [sort_by]: sort_order,
                },
                ...paginate,
            });
            const total = await prisma.employeeOnboardingSteps.count({
                where,
            });

            callback(null, {
                steps: steps.map(mapStep),
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / limit),
                message: 'Steps found successfully',
                success: true,
            });
        } catch (e) {
            console.error('ListEmployeeOnboardingSteps Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Update Employee Onboarding Step
    // -----------------------------
    UpdateEmployeeOnboardingStep: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid step id',
                });
            }

            const step = await prisma.employeeOnboardingSteps.findUnique({
                where: { id: data.id },
            });

            if (!step || step.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding step not found',
                });
            }

            const updated = await prisma.employeeOnboardingSteps.update({
                where: { id: data.id },
                data: {
                    name: data.name,
                    isActive: data.is_active,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                step: mapStep(updated),
                message: 'Step updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdateEmployeeOnboardingStep Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Delete Employee Onboarding Step
    // -----------------------------
    DeleteEmployeeOnboardingStep: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid step id',
                });
            }

            await prisma.employeeOnboardingSteps.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Step deleted successfully' });
        } catch (e) {
            console.error('DeleteEmployeeOnboardingStep Error:', e);
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
function mapStep(step) {
    return {
        id: step.id,
        onboarding_id: step.onboardingId,
        name: step.name,
        is_active: step.isActive,
        created_at: step.createdAt ? step.createdAt.toISOString() : '',
        updated_at: step.updatedAt ? step.updatedAt.toISOString() : '',
        deleted_at: step.deletedAt ? step.deletedAt.toISOString() : '',
    };
}

// ---------------------------------
// Bootstrap gRPC Server
// ---------------------------------
async function main() {
    const server = new grpc.Server();
    server.addService(onboardingStepProto.EmployeeOnboardingStepService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-onboarding-step-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-onboarding-step-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-onboarding-step-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-onboarding-step-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[employee-onboarding-step-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-onboarding-step-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-onboarding-step-service] Fatal error:', err);
    process.exit(1);
});
