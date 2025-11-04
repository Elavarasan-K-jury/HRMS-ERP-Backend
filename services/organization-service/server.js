import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.ORG_SERVICE_PORT || 50051;
const organizationProto = loadProto('organization');

const impl = {
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
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };

            if (domainExists && domainExists.deletedAt === null)
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Domain already exists',
                });

            if (domainExists && domainExists.deletedAt !== null) {
                const restored = await prisma.organizations.update({
                    where: { id: domainExists.id },
                    data: mappedData,
                });
                return callback(null, { organization: mapOrg(restored) });
            }

            const org = await prisma.organizations.create({ data: mappedData });
            callback(null, { organization: mapOrg(org) });

        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },


    GetOrganization: async (call, callback) => {
        try {
            const { id } = call.request;
            // Check if the id is a valid object id
            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization id' });
            const org = await prisma.organizations.findUnique({ where: { id, deletedAt: null } });
            if (!org)
                return callback({ code: grpc.status.NOT_FOUND, message: 'Organization not found' });
            callback(null, { organization: mapOrg(org) });
        } catch (e) {
            callback(e);
        }
    },

    ListOrganizations: async (call, callback) => {
        try {
            const {
                page = 1,
                limit = 10,
                search = "",
                sort_by = "createdAt",
                sort_order = "desc",
            } = call.request;

            const skip = (page - 1) * limit;

            // 🟢 Search condition — matches name, domain, or industry (case-insensitive)
            const where = {
                deletedAt: null,
                OR: search
                    ? [
                        { name: { contains: search, mode: "insensitive" } },
                        { domain: { contains: search, mode: "insensitive" } },
                        { industry: { contains: search, mode: "insensitive" } },
                    ]
                    : undefined,
            };

            // 🟣 Sorting — only allow safe columns
            const validSortFields = {
                name: "name",
                domain: "domain",
                industry: "industry",
                size: "size",
                created_at: "createdAt",
                updated_at: "updatedAt",
            };

            const sortField = validSortFields[sort_by] || "createdAt";
            const sortOrder = sort_order.toLowerCase() === "asc" ? "asc" : "desc";

            // 🟡 Count total
            const total = await prisma.organizations.count({ where });

            // 🔵 Fetch filtered + sorted + paginated results
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
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

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
        created_at: org.createdAt ? new Date(org.createdAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) : '',
        updated_at: org.updatedAt ? new Date(org.updatedAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) : '',
    };
}

/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
    const server = new grpc.Server();

    server.addService(organizationProto.OrganizationService.service, impl);

    // Convert bindAsync to Promise
    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[organization-service] gRPC running on :${PORT}`);

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\n[organization-service] Received ${signal}, shutting down gracefully...`);

        try {
            // 🧹 Stop accepting new gRPC calls
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[organization-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[organization-service] gRPC server stopped.');
                }
            });

            // 🧹 Disconnect Prisma cleanly
            await prisma.$disconnect();
            console.log('[organization-service] Prisma disconnected.');

            process.exit(0);
        } catch (e) {
            console.error('[organization-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    // Handle termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[organization-service] Fatal error:', err);
    process.exit(1);
});