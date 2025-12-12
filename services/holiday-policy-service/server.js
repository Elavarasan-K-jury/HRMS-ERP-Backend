// holiday-policy-service/server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.HOLIDAY_POLICY_SERVICE_PORT || 5080;
const holidayPolicyProto = loadProto('holiday_policy');

function toApiPolicy(p) {
    if (!p) return null;
    return {
        id: p.id,
        organization_id: p.organizationId,
        name: p.name,
        region: p.region,
        applicable_to: p.applicableTo || [],
        is_active: p.isActive,

        created_at: p.createdAt?.toISOString() || '',
        updated_at: p.updatedAt?.toISOString() || '',
    };
}

const impl = {
    /* --------------------------------------------------------
       CREATE POLICY
    -------------------------------------------------------- */
    CreateHolidayPolicy: async (call, cb) => {
        try {
            const { organization_id, name, region, applicable_to } = call.request;

            const policy = await prisma.holidayPolicies.create({
                data: {
                    organizationId: organization_id,
                    name,
                    region,
                    applicableTo: applicable_to || [],
                    isActive: true,
                },
            });

            cb(null, {
                policy: toApiPolicy(policy),
                message: 'Holiday policy created',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       UPDATE POLICY
    -------------------------------------------------------- */
    UpdateHolidayPolicy: async (call, cb) => {
        try {
            const { policy_id, name, region, applicable_to, is_active } = call.request;

            const policy = await prisma.holidayPolicies.update({
                where: { id: policy_id },
                data: {
                    name: name ?? undefined,
                    region: region ?? undefined,
                    applicableTo: applicable_to ?? undefined,
                    isActive: typeof is_active === 'boolean' ? is_active : undefined,
                },
            });

            cb(null, {
                policy: toApiPolicy(policy),
                message: 'Holiday policy updated',
            });
        } catch (e) {
            if (e.code === 'P2025') {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       DELETE POLICY
    -------------------------------------------------------- */
    DeleteHolidayPolicy: async (call, cb) => {
        try {
            const { policy_id } = call.request;

            await prisma.holidayPolicies.update({
                where: { id: policy_id },
                data: { deletedAt: new Date(), isActive: false },
            });

            cb(null, {
                success: true,
                message: 'Holiday policy deleted',
            });
        } catch (e) {
            if (e.code === 'P2025') {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Policy not found' });
            }
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       GET SINGLE POLICY
    -------------------------------------------------------- */
    GetHolidayPolicy: async (call, cb) => {
        try {
            const { policy_id } = call.request;

            const policy = await prisma.holidayPolicies.findUnique({
                where: { id: policy_id },
            });

            if (!policy) {
                return cb(null, {
                    policy: null,
                    message: 'Not found',
                });
            }

            cb(null, {
                policy: toApiPolicy(policy),
                message: 'Success',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LIST POLICIES (with filters + total_count)
    -------------------------------------------------------- */
    ListHolidayPolicies: async (call, cb) => {
        try {
            const { organization_id, region, is_active_only } = call.request;

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(region ? { region } : {}),
                ...(is_active_only ? { isActive: true } : {}),
            };

            const [rows, count] = await Promise.all([
                prisma.holidayPolicies.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                }),
                prisma.holidayPolicies.count({ where }),
            ]);

            cb(null, {
                policies: rows.map(toApiPolicy),
                total_count: count,
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('holiday-policy-service');

    const server = new grpc.Server();
    server.addService(holidayPolicyProto.HolidayPolicyService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[holiday-policy-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[holiday-policy-service] ${signal} received, shutting down...`);
        server.tryShutdown(async () => {
            await prisma.$disconnect();
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
    console.error('[holiday-policy-service] Fatal:', e);
    process.exit(1);
});
