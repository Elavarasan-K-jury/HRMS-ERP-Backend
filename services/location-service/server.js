import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.LOCATION_SERVICE_PORT || 50068);
const locationProto = loadProto('location');

function formatDate(date) {
    if (!date) return '';
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

function mapLocation(l) {
    return {
        id: l.id ?? '',
        organization_id: l.organizationId ?? '',
        entity_type: l.entityType ?? 'organization',
        entity_id: l.entityId ?? '',
        name: l.name ?? '',
        is_headquarters: l.isHeadquarters ?? false,
        timezone: l.timezone ?? '',
        country: l.country ?? '',
        state: l.state ?? '',
        address1: l.address1 ?? '',
        address2: l.address2 ?? '',
        city: l.city ?? '',
        pincode: l.pincode ?? '',
        description: l.description ?? '',
        latitude: typeof l.latitude === 'number' ? l.latitude : 0,
        longitude: typeof l.longitude === 'number' ? l.longitude : 0,
        place_id: l.placeId ?? '',
        formatted_address: l.formattedAddress ?? '',
        created_at: formatDate(l.createdAt),
        updated_at: formatDate(l.updatedAt),
        deleted_at: formatDate(l.deletedAt),
    };
}

const impl = {
    CreateLocation: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }
            if (!data.entity_type || !['organization', 'branch'].includes(data.entity_type)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'entity_type must be "organization" or "branch".',
                });
            }
            if (data.entity_type === 'branch' && !data.entity_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'entity_id is required when entity_type is "branch".',
                });
            }

            const org = await prisma.organizations.findFirst({
                where: { id: data.organization_id, deletedAt: null },
            });
            if (!org) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found.',
                });
            }

            if (data.entity_type === 'branch') {
                const branch = await prisma.branches.findFirst({
                    where: { id: data.entity_id, organizationId: data.organization_id, deletedAt: null },
                });
                if (!branch) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Branch not found in this organization.',
                    });
                }
            }

            const existing = await prisma.locations.findFirst({
                where: {
                    organizationId: data.organization_id,
                    entityType: data.entity_type,
                    ...(data.entity_type === 'branch' ? { entityId: data.entity_id } : { entityId: null }),
                    deletedAt: null,
                },
            });
            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A location is already set for this entity.',
                });
            }

            const location = await prisma.locations.create({
                data: {
                    organizationId: data.organization_id,
                    entityType: data.entity_type,
                    entityId: data.entity_type === 'branch' ? data.entity_id : null,
                    name: data.name || null,
                    isHeadquarters: !!data.is_headquarters,
                    timezone: data.timezone || null,
                    country: data.country || null,
                    state: data.state || null,
                    address1: data.address1 || null,
                    address2: data.address2 || null,
                    city: data.city || null,
                    pincode: data.pincode || null,
                    description: data.description || null,
                    latitude: Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : null,
                    longitude: Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : null,
                    placeId: data.place_id || null,
                    formattedAddress: data.formatted_address || null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                location: mapLocation(location),
                success: true,
                message: 'Location saved successfully.',
            });
        } catch (e) {
            console.error('CreateLocation Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetLocation: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid location id.',
                });
            }

            const location = await prisma.locations.findFirst({ where: { id, deletedAt: null } });
            if (!location) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Location not found.',
                });
            }

            callback(null, {
                location: mapLocation(location),
                success: true,
                message: 'Location found.',
            });
        } catch (e) {
            console.error('GetLocation Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListLocations: async (call, callback) => {
        try {
            const {
                organization_id,
                entity_type = '',
                entity_id = '',
                page = 1,
                limit = 20,
                search = '',
            } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            const skip = (page - 1) * limit;
            const where = { organizationId: organization_id, deletedAt: null };
            if (entity_type) where.entityType = entity_type;
            if (entity_id) where.entityId = entity_id;

            if (search) {
                where.OR = [
                    { city: { contains: search, mode: 'insensitive' } },
                    { country: { contains: search, mode: 'insensitive' } },
                    { formattedAddress: { contains: search, mode: 'insensitive' } },
                ];
            }

            const [locations, total] = await Promise.all([
                prisma.locations.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: Number(limit),
                }),
                prisma.locations.count({ where }),
            ]);

            callback(null, {
                locations: locations.map(mapLocation),
                total,
                page: Number(page),
                limit: Number(limit),
                total_pages: Math.ceil(total / Number(limit)),
                success: true,
                message: 'Locations listed successfully.',
            });
        } catch (e) {
            console.error('ListLocations Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateLocation: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.id || !/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid location id.',
                });
            }

            const existing = await prisma.locations.findFirst({ where: { id: data.id, deletedAt: null } });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Location not found.',
                });
            }

            if (data.entity_type && data.entity_type !== existing.entityType) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'entity_type cannot be changed.',
                });
            }

            const updated = await prisma.locations.update({
                where: { id: data.id },
                data: {
                    name: data.name !== undefined ? data.name : existing.name,
                    isHeadquarters: data.is_headquarters !== undefined ? !!data.is_headquarters : existing.isHeadquarters,
                    timezone: data.timezone !== undefined ? data.timezone : existing.timezone,
                    country: data.country !== undefined ? data.country : existing.country,
                    state: data.state !== undefined ? data.state : existing.state,
                    address1: data.address1 !== undefined ? data.address1 : existing.address1,
                    address2: data.address2 !== undefined ? data.address2 : existing.address2,
                    city: data.city !== undefined ? data.city : existing.city,
                    pincode: data.pincode !== undefined ? data.pincode : existing.pincode,
                    description: data.description !== undefined ? data.description : existing.description,
                    latitude: data.latitude !== undefined ? Number(data.latitude) : existing.latitude,
                    longitude: data.longitude !== undefined ? Number(data.longitude) : existing.longitude,
                    placeId: data.place_id !== undefined ? data.place_id : existing.placeId,
                    formattedAddress: data.formatted_address !== undefined ? data.formatted_address : existing.formattedAddress,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                location: mapLocation(updated),
                success: true,
                message: 'Location updated successfully.',
            });
        } catch (e) {
            console.error('UpdateLocation Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteLocation: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid location id.',
                });
            }

            const existing = await prisma.locations.findFirst({ where: { id, deletedAt: null } });
            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Location not found.',
                });
            }

            await prisma.locations.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Location deleted successfully.',
            });
        } catch (e) {
            console.error('DeleteLocation Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('location-service');
    const server = new grpc.Server();
    server.addService(locationProto.LocationService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[location-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[location-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown(async (err) => {
                if (err) {
                    console.error('[location-service] Force closing due to error:', err);
                    server.forceShutdown();
                }
                await prisma.$disconnect();
                process.exit(err ? 1 : 0);
            });
        } catch (e) {
            console.error('[location-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[location-service] Fatal error:', err);
    process.exit(1);
});