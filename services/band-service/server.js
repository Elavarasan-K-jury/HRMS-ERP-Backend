import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.BAND_SERVICE_PORT || 5057);
const bandProto = loadProto('band');

const MAX_NAME_LENGTH = 100;

function validObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id || '');
}

const impl = {
    CreateBand: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            const name = data.name.trim();

            if (!name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Name is required.',
                });
            }
            if (name.length > MAX_NAME_LENGTH) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: `Name must be at most ${MAX_NAME_LENGTH} characters.`,
                });
            }

            const existing = await prisma.bands.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: { equals: name, mode: 'insensitive' },
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A band with this name already exists in the organization.',
                });
            }

            const band = await prisma.bands.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    order: Number.isFinite(data.order) ? data.order : 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                band: mapBand(band),
                message: 'Band created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreateBand Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetBand: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid band id',
                });
            }

            const band = await prisma.bands.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!band) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Band not found',
                });
            }

            const [designationCount, employeeCount] = await Promise.all([
                prisma.organizationDesignations.count({
                    where: { bandId: id, deletedAt: null },
                }),
                prisma.organizationEmployees.count({
                    where: { bandId: id, deletedAt: null },
                }),
            ]);

            callback(null, {
                band: {
                    ...mapBand(band),
                    designation_count: designationCount,
                    employee_count: employeeCount,
                },
                message: 'Band found successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetBand Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListBands: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'order',
                sort_order = 'asc',
            } = call.request;

            const skip = (page - 1) * limit;

            let where = {};
            if (organization_id) {
                where = { organizationId: organization_id };
            }
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                name: 'name',
                order: 'order',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'order';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.bands.count({
                where: { ...where, deletedAt: null },
            });

            const bands = await prisma.bands.findMany({
                where: { ...where, deletedAt: null },
                orderBy: [{ order: 'asc' }, { name: 'asc' }],
                skip,
                take: limit,
            });

            // Numeric sort by `order` when requested (or default), so L1..L10..L15 sort correctly
            if (sortField === 'order') {
                bands.sort((a, b) => (order === 'asc' ? a.order - b.order : b.order - a.order));
            }

            const ids = bands.map(b => b.id);
            const [desigCounts, empCounts] = ids.length
                ? await Promise.all([
                    prisma.organizationDesignations.groupBy({
                        by: ['bandId'],
                        where: { bandId: { in: ids }, deletedAt: null },
                        _count: { _all: true },
                    }),
                    prisma.organizationEmployees.groupBy({
                        by: ['bandId'],
                        where: { bandId: { in: ids }, deletedAt: null },
                        _count: { _all: true },
                    }),
                ])
                : [[], []];

            const desigMap = {};
            desigCounts.forEach(c => { desigMap[c.bandId] = c._count._all; });
            const empMap = {};
            empCounts.forEach(c => { empMap[c.bandId] = c._count._all; });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                bands: bands.map(b => ({
                    ...mapBand(b),
                    designation_count: desigMap[b.id] || 0,
                    employee_count: empMap[b.id] || 0,
                })),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Bands found successfully',
            });
        } catch (e) {
            console.error('ListBands Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListAllBands: async (call, callback) => {
        try {
            const { organization_id } = call.request;

            const bands = await prisma.bands.findMany({
                where: { organizationId: organization_id || undefined, deletedAt: null },
                orderBy: [{ order: 'asc' }, { name: 'asc' }],
            });

            callback(null, {
                bands: bands.map(b => ({
                    id: b.id ?? '',
                    name: b.name ?? '',
                    description: b.description ?? '',
                    order: b.order ?? 0,
                })),
                success: true,
                message: 'Bands found successfully',
            });
        } catch (e) {
            console.error('ListAllBands Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateBand: async (call, callback) => {
        try {
            const data = call.request;

            if (!validObjectId(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid band id',
                });
            }

            const existing = await prisma.bands.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Band not found',
                });
            }

            const name = (data.name !== undefined && data.name !== null && data.name !== '')
                ? data.name.trim()
                : existing.name;

            if (!name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Name is required.',
                });
            }
            if (name.length > MAX_NAME_LENGTH) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: `Name must be at most ${MAX_NAME_LENGTH} characters.`,
                });
            }

            const conflict = await prisma.bands.findFirst({
                where: {
                    organizationId: data.organization_id || existing.organizationId,
                    deletedAt: null,
                    id: { not: data.id },
                    name: { equals: name, mode: 'insensitive' },
                },
            });

            if (conflict) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A band with this name already exists in the organization.',
                });
            }

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                name,
                description: data.description !== undefined && data.description !== null
                    ? (data.description.trim() || null)
                    : existing.description,
                order: Number.isFinite(data.order) ? data.order : existing.order,
                updatedAt: new Date(),
            };

            const updated = await prisma.bands.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, {
                band: mapBand(updated),
                message: 'Band updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdateBand Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteBand: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid band id',
                });
            }

            const band = await prisma.bands.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!band) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Band not found',
                });
            }

            const [designationCount, employeeCount] = await Promise.all([
                prisma.organizationDesignations.count({
                    where: { bandId: id, deletedAt: null },
                }),
                prisma.organizationEmployees.count({
                    where: { bandId: id, deletedAt: null },
                }),
            ]);

            if (designationCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot delete this Band because ${designationCount} designation(s) are assigned to it.`,
                });
            }
            if (employeeCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot delete this Band because ${employeeCount} employee(s) are assigned to it.`,
                });
            }

            await prisma.bands.update({
                where: { id },
                data: {
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                    // Free the unique (organizationId, name) index so a band with the
                    // same name can be created again after deletion.
                    name: `${band.name}__deleted__${Date.now()}`,
                },
            });

            callback(null, {
                success: true,
                message: 'Band deleted successfully',
            });
        } catch (e) {
            console.error('DeleteBand Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

function mapBand(b = {}) {
    return {
        id: b.id ?? '',
        organization_id: b.organizationId ?? '',
        name: b.name ?? '',
        description: b.description ?? '',
        order: b.order ?? 0,
        designation_count: b.designationCount ?? 0,
        employee_count: b.employeeCount ?? 0,
        created_at: b.createdAt ? b.createdAt.toISOString() : '',
        updated_at: b.updatedAt ? b.updatedAt.toISOString() : '',
        deleted_at: b.deletedAt ? b.deletedAt.toISOString() : '',
    };
}

async function main() {
    await checkDbConnection('band-service');
    const server = new grpc.Server();
    server.addService(bandProto.BandsService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[band-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[band-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[band-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[band-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[band-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[band-service] Fatal error:', err);
    process.exit(1);
});