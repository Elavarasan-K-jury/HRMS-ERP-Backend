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

            callback(null, {
                flow: mapFlow(created),
                success: true,
                message: 'Onboarding flow created successfully',
            });
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

            callback(null, {
                flow: mapFlow(flow),
                success: true,
                message: 'Onboarding flow fetched successfully',
            });
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
            const {
                organization_id,
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

            if (organization_id) {
                where = {
                    ...where,
                    organizationId: organization_id,
                }
            }

            if (search && search !== '') {
                where = {
                    ...where,
                    name: {
                        contains: search,
                        mode: 'insensitive',
                    },
                };
            }

            const validSortFields = {
                name: 'name',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const sortOrder = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const flows = await prisma.employeeOnboardingFlows.findMany({
                where,
                include: {
                    organization: true,
                    stepsList: {
                        include: {
                            features: true
                        }
                    }
                },
                ...paginate,
                orderBy: {
                    [sortField]: sortOrder,
                },
            });
            const total = await prisma.employeeOnboardingFlows.count({
                where,
            });

            callback(null, {
                flows: flows.map(mapFlow),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: 'Onboarding flows fetched successfully',
            });
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

            callback(null, {
                flow: mapFlow(updated),
                success: true,
                message: 'Onboarding flow updated successfully',
            });
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
function formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

function mapOrg(org = {}) {
    if (!org || !org.id) {
        return {};
    }
    return {
        id: org.id ?? '',
        name: org.name ?? '',
        domain: org.domain ?? '',
        gst_number: org.GSTNumber ?? '',
        email: org.email ?? '',
        contact_person_name: org.contactPersonName ?? '',
        contact_person_number: org.contactPersonNumber ?? '',
        note: org.note ?? '',
        industry: org.industry ?? '',
        size: org.size ?? 0,
        address: org.address ? JSON.stringify(org.address) : '',
        created_at: formatDate(org.createdAt),
        updated_at: formatDate(org.updatedAt),
    };
}

function normalizeOptions(opts) {
    // DB can have [], object, or already-stringified JSON
    if (opts == null) return '[]';
    if (typeof opts === 'string') return opts;
    try { return JSON.stringify(opts); } catch { return '[]'; }
}

function mapFeature(f) {
    return {
        id: f.id,
        step_id: f.stepId,
        feature_name: f.featureName ?? '',
        feature_type: f.featureType ?? '',
        has_options: Boolean(f.hasOptions),
        options: normalizeOptions(f.options),
    };
}

function mapStep(s) {
    return {
        id: s.id,
        onboarding_id: s.onboardingId,
        name: s.name ?? '',
        is_active: Boolean(s.isActive),
        created_at: formatDate(s.createdAt),
        updated_at: formatDate(s.updatedAt),
        deleted_at: formatDate(s.deletedAt),
        features: Array.isArray(s.features) ? s.features.map(mapFeature) : [],
    };
}

function mapFlow(flow) {
    return {
        id: flow.id,
        organization_id: flow.organizationId,
        name: flow.name,
        description: flow.description ?? '',
        steps: flow.steps ?? 0,
        estimated_days: flow.estimatedDays ?? 0,
        created_at: formatDate(flow.createdAt),
        updated_at: formatDate(flow.updatedAt),
        deleted_at: formatDate(flow.deletedAt),
        organization: mapOrg(flow.organization),

        // ✅ include nested steps + features
        steps_list: Array.isArray(flow.stepsList) ? flow.stepsList.map(mapStep) : [],
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
