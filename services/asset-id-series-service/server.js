import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ASSET_ID_SERIES_SERVICE_PORT || 5069);
const assetIdSeriesProto = loadProto('asset_id_series');

const impl = {
    CreateAssetIdSeries: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            const organization = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            });
            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found.',
                });
            }

            const existingName = await prisma.assetIdSeries.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: data.name,
                    deletedAt: null,
                },
            });
            if (existingName) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A series with this name already exists in this organization.',
                });
            }

            const created = await prisma.assetIdSeries.create({
                data: {
                    organizationId: data.organization_id,
                    name: data.name,
                    prefix: data.prefix || '',
                    digits: data.digits || 6,
                    suffix: data.suffix || '',
                    nextNumber: 1,
                    isActive: data.is_active !== false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                series: mapSeries(created),
                success: true,
                message: 'Asset ID series created successfully',
            });
        } catch (e) {
            console.error('CreateAssetIdSeries Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetAssetIdSeries: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid series ID format' });
            }

            const series = await prisma.assetIdSeries.findUnique({
                where: { id },
            });
            if (!series || series.deletedAt) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Asset ID series not found' });
            }

            callback(null, { series: mapSeries(series), success: true, message: 'Series fetched successfully' });
        } catch (e) {
            console.error('GetAssetIdSeries Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListAssetIdSeries: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            if (!organization_id) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            }

            const where = { deletedAt: null, organizationId: organization_id };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { prefix: { contains: search, mode: 'insensitive' } },
                ];
            }

            const sortMap = { created_at: 'createdAt', updated_at: 'updatedAt', name: 'name' };
            const orderBy = { [sortMap[sort_by] || 'createdAt']: sort_order };

            const skip = (page - 1) * limit;
            const [series, total] = await Promise.all([
                prisma.assetIdSeries.findMany({ where, orderBy, skip, take: limit }),
                prisma.assetIdSeries.count({ where }),
            ]);

            callback(null, {
                series: series.map(mapSeries),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: 'Series list fetched successfully',
            });
        } catch (e) {
            console.error('ListAssetIdSeries Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateAssetIdSeries: async (call, callback) => {
        try {
            const data = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid series ID format' });
            }

            const existing = await prisma.assetIdSeries.findFirst({
                where: { id: data.id, deletedAt: null },
            });
            if (!existing) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Asset ID series not found' });
            }

            if (data.name && data.name !== existing.name) {
                const duplicateName = await prisma.assetIdSeries.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                        name: data.name,
                        deletedAt: null,
                        id: { not: data.id },
                    },
                });
                if (duplicateName) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'A series with this name already exists in this organization.',
                    });
                }
            }

            const updated = await prisma.assetIdSeries.update({
                where: { id: data.id },
                data: {
                    name: data.name || existing.name,
                    prefix: data.prefix !== undefined ? data.prefix : existing.prefix,
                    digits: data.digits || existing.digits,
                    suffix: data.suffix !== undefined ? data.suffix : existing.suffix,
                    isActive: data.is_active !== undefined ? data.is_active : existing.isActive,
                    updatedAt: new Date(),
                },
            });

            callback(null, { series: mapSeries(updated), success: true, message: 'Series updated successfully' });
        } catch (e) {
            console.error('UpdateAssetIdSeries Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteAssetIdSeries: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid series ID format' });
            }

            const existing = await prisma.assetIdSeries.findFirst({
                where: { id, deletedAt: null },
            });
            if (!existing) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Asset ID series not found' });
            }

            await prisma.assetIdSeries.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Series deleted successfully' });
        } catch (e) {
            console.error('DeleteAssetIdSeries Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GenerateAssetId: async (call, callback) => {
        try {
            const { organization_id, series_id, preview_only } = call.request;

            if (!organization_id || !series_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and series_id are required.',
                });
            }

            const series = await prisma.assetIdSeries.findFirst({
                where: {
                    id: series_id,
                    organizationId: organization_id,
                    isActive: true,
                    deletedAt: null,
                },
            });

            if (!series) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'No active ID series found. Please create one in Settings.',
                });
            }

            const nextNum = series.nextNumber;
            const padded = String(nextNum).padStart(series.digits, '0');
            const assetId = `${series.prefix}${padded}${series.suffix}`;

            const duplicate = await prisma.assets.findFirst({
                where: {
                    organizationId: organization_id,
                    assetTag: assetId,
                    deletedAt: null,
                },
            });
            if (duplicate) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Generated Asset ID "${assetId}" already exists. Please check the series configuration.`,
                });
            }

            let nextNumber = nextNum;

            if (!preview_only) {
                nextNumber = nextNum + 1;
                await prisma.assetIdSeries.update({
                    where: { id: series.id },
                    data: { nextNumber, updatedAt: new Date() },
                });
            }

            callback(null, {
                asset_id: assetId,
                series_id: series.id,
                next_number: nextNumber,
                success: true,
                message: `Asset ID "${assetId}" generated successfully`,
            });
        } catch (e) {
            console.error('GenerateAssetId Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

function mapSeries(s) {
    return {
        id: s.id,
        organization_id: s.organizationId,
        name: s.name,
        prefix: s.prefix,
        digits: s.digits,
        suffix: s.suffix,
        next_number: s.nextNumber,
        is_active: s.isActive,
        created_at: s.createdAt?.toISOString() ?? '',
        updated_at: s.updatedAt?.toISOString() ?? '',
        deleted_at: s.deletedAt?.toISOString() ?? '',
    };
}

async function main() {
    await checkDbConnection('asset-id-series-service');
    const server = new grpc.Server();
    server.addService(assetIdSeriesProto.AssetIdSeriesService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve()),
        );
    });

    console.log(`[asset-id-series-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[asset-id-series-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[asset-id-series-service] Force closing:', err);
                    server.forceShutdown();
                } else {
                    console.log('[asset-id-series-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            process.exit(0);
        } catch (e) {
            console.error('[asset-id-series-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[asset-id-series-service] Fatal error:', err);
    process.exit(1);
});
