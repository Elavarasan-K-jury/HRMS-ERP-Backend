import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.ORG_SERVICE_PORT || 50051;
const organizationProto = loadProto('organization');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */
const impl = {
    /* ------------------------------------------------------------------ */
    /* 🟢 Create Organization                                             */
    /* ------------------------------------------------------------------ */
    CreateOrganization: async (call, callback) => {
        try {
            const data = call.request;

            const domainExists = await prisma.organizations.findUnique({
                where: { domain: data.domain },
            });

            const mappedData = {
                name: data.name,
                domain: data.domain,
                GSTNumber: data.gst_number ?? null,
                email: data.email ?? null,
                contactPersonName: data.contact_person_name ?? null,
                contactPersonNumber: data.contact_person_number ?? null,
                note: data.note ?? null,
                industry: data.industry ?? null,
                size: data.size ?? null,
                address:
                    typeof data.address === 'string'
                        ? JSON.parse(data.address)
                        : data.address ?? null,

                // ✅ new fields
                maxEmployees: data.max_employees ?? 20,
                maxStorageInGB: data.max_storage_in_gb ?? 10,
                maxApiRatePerMin: data.max_api_rate_per_minute ?? 1000,
                maxPayrollRunsPerMonth: data.max_payroll_runs_per_month ?? 1,
                maxLeavePolicies: data.max_leave_policies ?? 5,
                maxAdminAccounts: data.max_admin_accounts ?? 3,

                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            if (domainExists && domainExists.deletedAt === null) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Domain already exists',
                });
            }

            // Restore soft-deleted org if domain matches
            if (domainExists && domainExists.deletedAt !== null) {
                const restored = await prisma.organizations.update({
                    where: { id: domainExists.id },
                    data: mappedData,
                });
                return callback(null, {
                    organization: mapOrg(restored),
                    success: true,
                    message: 'Organization restored successfully',
                });
            }

            const org = await prisma.organizations.create({ data: mappedData });
            callback(null, {
                organization: mapOrg(org),
                success: true,
                message: 'Organization created successfully',
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟣 Get Organization by ID                                           */
    /* ------------------------------------------------------------------ */
    GetOrganization: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid organization id',
                });

            const org = await prisma.organizations.findUnique({
                where: { id, deletedAt: null },
            });

            if (!org)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            callback(null, { organization: mapOrg(org), success: true });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔵 List Organizations                                               */
    /* ------------------------------------------------------------------ */
    ListOrganizations: async (call, callback) => {
        try {
            const {
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'createdAt',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            const where = {
                deletedAt: null,
                OR: search
                    ? [
                        { name: { contains: search, mode: 'insensitive' } },
                        { domain: { contains: search, mode: 'insensitive' } },
                        { industry: { contains: search, mode: 'insensitive' } },
                    ]
                    : undefined,
            };

            const validSortFields = {
                name: 'name',
                domain: 'domain',
                industry: 'industry',
                size: 'size',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const sortOrder = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizations.count({ where });

            const orgs = await prisma.organizations.findMany({
                where,
                orderBy: { [sortField]: sortOrder },
                skip,
                take: limit,
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                organizations: orgs.map(mapOrg),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Organizations fetched successfully',
            });
        } catch (e) {
            console.log('server.js @ Line 173:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟠 Update Organization                                              */
    /* ------------------------------------------------------------------ */
    UpdateOrganization: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.organizations.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            const updated = await prisma.organizations.update({
                where: { id: data.id },
                data: {
                    name: data.name ?? existing.name,
                    domain: data.domain ?? existing.domain,
                    GSTNumber: data.gst_number ?? existing.GSTNumber,
                    email: data.email ?? existing.email,
                    contactPersonName:
                        data.contact_person_name ?? existing.contactPersonName,
                    contactPersonNumber:
                        data.contact_person_number ?? existing.contactPersonNumber,
                    note: data.note ?? existing.note,
                    industry: data.industry ?? existing.industry,
                    size: data.size ?? existing.size,
                    address:
                        typeof data.address === 'string'
                            ? JSON.parse(data.address)
                            : data.address ?? existing.address,

                    // ✅ updated fields
                    maxEmployees: data.max_employees ?? existing.maxEmployees,
                    maxStorageInGB: data.max_storage_in_gb ?? existing.maxStorageInGB,
                    maxApiRatePerMin:
                        data.max_api_rate_per_minute ?? existing.maxApiRatePerMin,
                    maxPayrollRunsPerMonth:
                        data.max_payroll_runs_per_month ??
                        existing.maxPayrollRunsPerMonth,
                    maxLeavePolicies:
                        data.max_leave_policies ?? existing.maxLeavePolicies,
                    maxAdminAccounts:
                        data.max_admin_accounts ?? existing.maxAdminAccounts,

                    updatedAt: new Date(),
                },
            });

            callback(null, {
                organization: mapOrg(updated),
                success: true,
                message: 'Organization updated successfully',
            });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔴 Soft Delete Organization                                        */
    /* ------------------------------------------------------------------ */
    DeleteOrganization: async (call, callback) => {
        try {
            const { id } = call.request;
            const org = await prisma.organizations.findUnique({
                where: { id, deletedAt: null },
            });

            if (!org)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            await prisma.organizations.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Organization soft-deleted successfully',
            });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ------------------------------------------------------------------ */
/* 🧭 Mapper                                                          */
/* ------------------------------------------------------------------ */
function mapOrg(org) {
    return {
        id: org.id,
        name: org.name,
        domain: org.domain,
        gst_number: org.GSTNumber ?? '',
        email: org.email ?? '',
        contact_person_name: org.contactPersonName ?? '',
        contact_person_number: org.contactPersonNumber ?? '',
        note: org.note ?? '',
        industry: org.industry ?? '',
        size: org.size ?? 0,
        address: org.address ? JSON.stringify(org.address) : '',
        created_at: org.createdAt?.toISOString() ?? '',
        updated_at: org.updatedAt?.toISOString() ?? '',
        deleted_at: org.deletedAt?.toISOString() ?? '',

        // ✅ new fields
        max_employees: org.maxEmployees ?? 20,
        max_storage_in_gb: org.maxStorageInGB ?? 10,
        max_api_rate_per_minute: org.maxApiRatePerMin ?? 1000,
        max_payroll_runs_per_month: org.maxPayrollRunsPerMonth ?? 1,
        max_leave_policies: org.maxLeavePolicies ?? 5,
        max_admin_accounts: org.maxAdminAccounts ?? 3,
    };
}

/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    const server = new grpc.Server();

    server.addService(organizationProto.OrganizationService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[organization-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[organization-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[organization-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[organization-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[organization-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[organization-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[organization-service] Fatal error:', err);
    process.exit(1);
});
