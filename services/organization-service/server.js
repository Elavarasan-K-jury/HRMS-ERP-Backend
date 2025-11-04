import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { de } from 'zod/v4/locales';

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

    ListOrganizations: async (_, callback) => {
        try {
            const orgs = await prisma.organizations.findMany({
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            callback(null, { organizations: orgs.map(mapOrg) });
        } catch (e) {
            callback(e);
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

function main() {
    const server = new grpc.Server();
    server.addService(organizationProto.OrganizationService.service, impl);
    server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => {
        if (err) throw err;
        console.log(`[organization-service] gRPC running on :${PORT}`);
    });
}

main();
