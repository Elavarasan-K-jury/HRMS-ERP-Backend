import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.ORG_DEPT_SERVICE_PORT || 50054;
const departmentProto = loadProto('org_department');

const impl = {
    // ──────────────────────────────────────────────────────────────────────
    // CREATE DEPARTMENT
    // ──────────────────────────────────────────────────────────────────────
    CreateDepartment: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and name are required.',
                });
            }

            // Check if department with same name + org exists
            const nameExists = await prisma.organizationDepartments.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: data.name,
                    deletedAt: null,
                },
            });

            if (nameExists) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Department with this name already exists in the organization.',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                name: data.name,
                code: data.code || null,
                departmentHeadId: data.department_head_id || null,
                departmentHeadStratDate: data.department_head_start_date
                    ? new Date(data.department_head_start_date)
                    : null,
                description: data.description || null,
                note: data.note || null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            const dept = await prisma.organizationDepartments.create({
                data: mappedData,
            });

            callback(null, {
                department: mapDepartment(dept),
                message: 'Department created successfully',
                success: true,
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // GET DEPARTMENT
    // ──────────────────────────────────────────────────────────────────────
    GetDepartment: async (call, callback) => {
        try {
            const { id } = call.request;

            const dept = await prisma.organizationDepartments.findUnique({
                where: { id, deletedAt: null },
            });

            if (!dept)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department not found',
                });

            callback(null, {
                department: mapDepartment(dept),
                message: 'Department found successfully',
                success: true,
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // LIST DEPARTMENTS (with filters, pagination, search, sort)
    // ──────────────────────────────────────────────────────────────────────
    ListDepartments: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            let where = {
                deletedAt: null,
            };

            if (organization_id) {
                where = {
                    ...where,
                    organizationId: organization_id,
                }
            }
            if (search != null || search != '') {
                where = {
                    ...where,
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { code: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                    ],
                }
            }

            const validSortFields = {
                name: 'name',
                code: 'code',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizationDepartments.count({ where });

            const depts = await prisma.organizationDepartments.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take: limit,
                include: {
                    organization: true
                }
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                departments: depts.map(mapDepartment),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Departments found successfully',
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // UPDATE DEPARTMENT
    // ──────────────────────────────────────────────────────────────────────
    UpdateDepartment: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid department id',
                });

            const existing = await prisma.organizationDepartments.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department not found',
                });

            // Prevent name conflict within same org
            if (data.name && data.name !== existing.name) {
                const nameConflict = await prisma.organizationDepartments.findFirst({
                    where: {
                        organizationId: data.organization_id || existing.organizationId,
                        name: data.name,
                        deletedAt: null,
                        id: { not: data.id },
                    },
                });

                if (nameConflict) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'Another department with this name already exists.',
                    });
                }
            }

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                name: data.name || existing.name,
                code: data.code ?? existing.code,
                departmentHeadId: data.department_head_id ?? existing.departmentHeadId,
                departmentHeadStratDate: data.department_head_start_date
                    ? new Date(data.department_head_start_date)
                    : existing.departmentHeadStratDate,
                description: data.description ?? existing.description,
                note: data.note ?? existing.note,
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationDepartments.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, {
                department: mapDepartment(updated),
                message: 'Department updated successfully',
                success: true,
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // DELETE DEPARTMENT (Soft Delete)
    // ──────────────────────────────────────────────────────────────────────
    DeleteDepartment: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid department id',
                });

            const dept = await prisma.organizationDepartments.findUnique({
                where: { id, deletedAt: null },
            });

            if (!dept)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department not found',
                });

            await prisma.organizationDepartments.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Department deleted successfully',
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

// ──────────────────────────────────────────────────────────────────────────
// MAPPER: Prisma → gRPC Response
// ──────────────────────────────────────────────────────────────────────────
function mapDepartment(dept) {
    return {
        id: dept.id,
        organization_id: dept.organizationId,
        name: dept.name,
        code: dept.code ?? '',
        department_head_id: dept.departmentHeadId ?? '',
        department_head_start_date:
            dept.departmentHeadStratDate?.toISOString() ?? '',
        description: dept.description ?? '',
        note: dept.note ?? '',
        organization: JSON.stringify(mapOrg(dept.organization)),
        created_at: dept.createdAt?.toISOString() ?? '',
        updated_at: dept.updatedAt?.toISOString() ?? '',
        deleted_at: dept.deletedAt?.toISOString() ?? '',
    };
}

// ──────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN + SERVER START
// ──────────────────────────────────────────────────────────────────────────
async function main() {
    const server = new grpc.Server();
    server.addService(departmentProto.OrgDepartmentService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[org-department-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[org-department-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[org-department-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[org-department-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[org-department-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[org-department-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[org-department-service] Fatal error:', err);
    process.exit(1);
});