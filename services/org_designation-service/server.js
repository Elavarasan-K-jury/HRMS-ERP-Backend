import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.ORG_DESG_SERVICE_PORT || 50055);
const designationProto = loadProto('org_designation');

const impl = {
    CreateDesignation: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            // Validate department exists if provided
            if (data.department_id) {
                const departmentExists = await prisma.organizationDepartments.findFirst({
                    where: {
                        id: data.department_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!departmentExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Department not found in organization.',
                    });
                }
            }

            const nameExists = await prisma.organizationDesignations.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: data.name,
                    deletedAt: null,
                },
            });

            if (nameExists) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Designation with this name already exists in the organization.',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                departmentId: data.department_id || null,
                name: data.name,
                level: data.level || null,
                description: data.description || null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            const designation = await prisma.organizationDesignations.create({
                data: mappedData,
                include: {
                    organization: true,
                    department: true,
                },
            });

            callback(null, {
                designation: mapDesignation(designation),
                message: 'Designation created successfully',
                success: true
            });
        } catch (e) {
            console.error('CreateDesignation Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    GetDesignation: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid designation id',
                });
            }

            const designation = await prisma.organizationDesignations.findFirst({
                where: { id, deletedAt: null },
                include: {
                    organization: true,
                    department: true,
                    employees: {
                        where: { deletedAt: null },
                        select: { id: true, fullName: true }
                    }
                },
            });

            if (!designation) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Designation not found',
                });
            }

            callback(null, {
                designation: mapDesignation(designation),
                message: 'Designation found successfully',
                success: true
            });
        } catch (e) {
            console.error('GetDesignation Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListDesignations: async (call, callback) => {
        try {
            const {
                organization_id,
                department_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required.',
                });
            }

            const skip = (page - 1) * limit;
            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(department_id ? { departmentId: department_id } : {}),
                ...(search
                    ? {
                        OR: [
                            { name: { contains: search, mode: 'insensitive' } },
                            { level: { contains: search, mode: 'insensitive' } },
                            { description: { contains: search, mode: 'insensitive' } },
                        ],
                    }
                    : {}),
            };

            const validSortFields = {
                name: 'name',
                level: 'level',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizationDesignations.count({ where });
            const designations = await prisma.organizationDesignations.findMany({
                where,
                include: {
                    department: {
                        select: { name: true }
                    },
                    employees: {
                        where: { deletedAt: null },
                        select: { id: true }
                    }
                },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                designations: designations.map(desg => ({
                    ...mapDesignation(desg),
                    employee_count: desg.employees.length,
                    department_name: desg.department?.name || '',
                })),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Designations found successfully',
            });
        } catch (e) {
            console.error('ListDesignations Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateDesignation: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid designation id',
                });
            }

            const existing = await prisma.organizationDesignations.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Designation not found',
                });
            }

            if (data.name && data.name !== existing.name) {
                const conflict = await prisma.organizationDesignations.findFirst({
                    where: {
                        organizationId: data.organization_id || existing.organizationId,
                        name: data.name,
                        deletedAt: null,
                        id: { not: data.id },
                    },
                });

                if (conflict) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Another designation with this name already exists.',
                    });
                }
            }

            // Validate department if provided
            if (data.department_id && data.department_id !== existing.departmentId) {
                const departmentExists = await prisma.organizationDepartments.findFirst({
                    where: {
                        id: data.department_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!departmentExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Department not found in organization.',
                    });
                }
            }

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                departmentId: data.department_id ?? existing.departmentId,
                name: data.name || existing.name,
                level: data.level ?? existing.level,
                description: data.description ?? existing.description,
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationDesignations.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, {
                designation: mapDesignation(updated),
                message: 'Designation updated successfully',
                success: true
            });
        } catch (e) {
            console.error('UpdateDesignation Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteDesignation: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid designation id',
                });
            }

            const designation = await prisma.organizationDesignations.findFirst({
                where: { id, deletedAt: null },
            });

            if (!designation) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Designation not found',
                });
            }

            await prisma.organizationDesignations.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Designation deleted successfully',
            });
        } catch (e) {
            console.error('DeleteDesignation Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

function mapDesignation(d) {
    return {
        id: d.id,
        organization_id: d.organizationId,
        department_id: d.departmentId ?? '',
        name: d.name,
        level: d.level ?? '',
        description: d.description ?? '',
        created_at: d.createdAt?.toISOString() ?? '',
        updated_at: d.updatedAt?.toISOString() ?? '',
        deleted_at: d.deletedAt?.toISOString() ?? '',
    };
}

async function main() {
    const server = new grpc.Server();
    server.addService(designationProto.OrgDesignationService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[org-designation-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[org-designation-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[org-designation-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[org-designation-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[org-designation-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[org-designation-service] Fatal error:', err);
    process.exit(1);
});