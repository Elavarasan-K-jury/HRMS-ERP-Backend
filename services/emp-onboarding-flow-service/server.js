import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.EMP_ONBOARDING_FLOW_SERVICE_PORT || 50056);
const onboardingFlowProto = loadProto('emp_onboarding_flow');

const impl = {
    // -----------------------------
    // Create Employee Onboarding Flow
    // -----------------------------
    CreateEmployeeOnboardingFlow: async (call, callback) => {
        try {
            const data = call.request;

            const organization = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            });

            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const existing = await prisma.employeeOnboardingFlows.findFirst({
                where: {
                    name: data.name,
                    organizationId: data.organization_id,
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Onboarding flow already exists',
                });
            }

            const created = await prisma.employeeOnboardingFlows.create({
                data: {
                    organizationId: data.organization_id,
                    name: data.name,
                    description: data.description ?? null,
                    steps: data.steps ?? 0,
                    estimatedDays: data.estimated_days ?? null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, { flow: mapFlow(created) });
        } catch (e) {
            console.error('CreateEmployeeOnboardingFlow Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Get Employee Onboarding Flow
    // -----------------------------
    GetEmployeeOnboardingFlow: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid flow id',
                });
            }

            const flow = await prisma.employeeOnboardingFlows.findUnique({
                where: { id },
            });

            if (!flow || flow.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding flow not found',
                });
            }

            callback(null, { flow: mapFlow(flow) });
        } catch (e) {
            console.error('GetEmployeeOnboardingFlow Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // List Employee Onboarding Flows
    // -----------------------------
    ListEmployeeOnboardingFlows: async (call, callback) => {
        try {
            const { organization_id } = call.request;

            const flows = await prisma.employeeOnboardingFlows.findMany({
                where: {
                    organizationId: organization_id,
                    deletedAt: null,
                },
                orderBy: { createdAt: 'desc' },
            });

            callback(null, { flows: flows.map(mapFlow) });
        } catch (e) {
            console.error('ListEmployeeOnboardingFlows Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Update Employee Onboarding Flow
    // -----------------------------
    UpdateEmployeeOnboardingFlow: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid flow id',
                });
            }

            const existing = await prisma.employeeOnboardingFlows.findUnique({
                where: { id: data.id },
            });

            if (!existing || existing.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Onboarding flow not found',
                });
            }

            const updated = await prisma.employeeOnboardingFlows.update({
                where: { id: data.id },
                data: {
                    organizationId: data.organization_id,
                    name: data.name,
                    description: data.description ?? null,
                    steps: data.steps ?? 0,
                    estimatedDays: data.estimated_days ?? null,
                    updatedAt: new Date(),
                },
            });

            callback(null, { flow: mapFlow(updated) });
        } catch (e) {
            console.error('UpdateEmployeeOnboardingFlow Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // -----------------------------
    // Delete Employee Onboarding Flow
    // -----------------------------
    DeleteEmployeeOnboardingFlow: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid flow id',
                });
            }

            await prisma.employeeOnboardingFlows.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Deleted successfully' });
        } catch (e) {
            console.error('DeleteEmployeeOnboardingFlow Error:', e);
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
function mapFlow(flow) {
    return {
        id: flow.id,
        organization_id: flow.organizationId,
        name: flow.name,
        description: flow.description ?? '',
        steps: flow.steps ?? 0,
        estimated_days: flow.estimatedDays ?? 0,
        created_at: flow.createdAt ? flow.createdAt.toISOString() : '',
        updated_at: flow.updatedAt ? flow.updatedAt.toISOString() : '',
        deleted_at: flow.deletedAt ? flow.deletedAt.toISOString() : '',
    };
}

// ---------------------------------
// Bootstrap gRPC Server
// ---------------------------------
async function main() {
    const server = new grpc.Server();

    server.addService(onboardingFlowProto.EmployeeOnboardingFlowService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-onboarding-flow-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-onboarding-flow-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-onboarding-flow-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-onboarding-flow-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[employee-onboarding-flow-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-onboarding-flow-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-onboarding-flow-service] Fatal error:', err);
    process.exit(1);
});
