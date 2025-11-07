import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.EMP_SERVICE_PORT || 50053);
const employeeProto = loadProto('employee');

const impl = {
    CreateEmployee: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.category_id || !data.phone) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, category_id, and phone are required.',
                });
            }

            // Validate designation if provided
            if (data.designation_id) {
                const designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
            }

            const mappedData = {
                organizationId: data.organization_id,
                categoryId: data.category_id,
                designationId: data.designation_id || null,
                firstName: data.first_name || null,
                lastName: data.last_name || null,
                fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                email: data.email || null,
                phone: data.phone,
                altPhone: data.alt_phone || null,
                gender: data.gender ? data.gender.toUpperCase() : null,
                dateOfBirth: new Date(data.date_of_birth),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const employee = await prisma.organizationEmployees.create({
                data: mappedData,
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                },
            });

            callback(null, {
                employee: mapEmployee(employee),
                message: 'Employee created successfully',
                success: true
            });
        } catch (e) {
            console.error('CreateEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid employee id',
                });
            }

            const emp = await prisma.organizationEmployees.findFirst({
                where: { id, deletedAt: null },
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: true
                        }
                    }
                }
            });

            if (!emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            callback(null, {
                employee: mapEmployee(emp),
                message: 'Employee found successfully',
                success: true
            });
        } catch (e) {
            console.error('GetEmployee Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListEmployees: async (call, callback) => {
        try {
            const {
                organization_id,
                category_id,
                designation_id,
                department_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;
            let where = {
                deletedAt: null,
                ...(organization_id ? { organizationId: organization_id } : {}),
                ...(category_id ? { categoryId: category_id } : {}),
                ...(designation_id ? { designationId: designation_id } : {}),
            };

            // Handle department filter through departmentAssignments
            if (department_id) {
                where = {
                    ...where,
                    departmentAssignments: {
                        some: {
                            departmentId: department_id,
                            deletedAt: null
                        }
                    }
                };
            }

            // Handle search
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                first_name: 'firstName',
                last_name: 'lastName',
                full_name: 'fullName',
                email: 'email',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizationEmployees.count({ where });
            const employees = await prisma.organizationEmployees.findMany({
                where,
                include: {
                    organization: { select: { name: true } },
                    category: { select: { name: true } },
                    designation: { select: { name: true } },
                },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                employees: employees.map(mapEmployee),
                total,
                page,
                limit,
                total_pages: totalPages,
                message: 'Employees found successfully',
                success: true
            });
        } catch (e) {
            console.error('ListEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateEmployee: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.organizationEmployees.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            // Validate designation if provided
            if (data.designation_id && data.designation_id !== existing.designationId) {
                const designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
            }

            const updateData = {
                organizationId: data.organization_id ?? existing.organizationId,
                categoryId: data.category_id ?? existing.categoryId,
                designationId: data.designation_id ?? existing.designationId,
                firstName: data.first_name ?? existing.firstName,
                lastName: data.last_name ?? existing.lastName,
                fullName: data.full_name || `${data.first_name || existing.firstName || ''} ${data.last_name || existing.lastName || ''}`.trim(),
                email: data.email ?? existing.email,
                phone: data.phone ?? existing.phone,
                altPhone: data.alt_phone ?? existing.altPhone,
                gender: data.gender ? data.gender.toUpperCase() : existing.gender,
                dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth) : existing.dateOfBirth,
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationEmployees.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                },
            });

            callback(null, {
                employee: mapEmployee(updated),
                message: 'Employee updated successfully',
                success: true
            });
        } catch (e) {
            console.error('UpdateEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid employee id',
                });
            }

            const emp = await prisma.organizationEmployees.findFirst({
                where: { id, deletedAt: null }
            });

            if (!emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            await prisma.organizationEmployees.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Employee deleted successfully'
            });
        } catch (e) {
            console.error('DeleteEmployee Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

function mapEmployee(emp) {
    return {
        id: emp.id,
        organization_id: emp.organizationId,
        category_id: emp.categoryId,
        designation_id: emp.designationId ?? '',
        first_name: emp.firstName ?? '',
        last_name: emp.lastName ?? '',
        full_name: emp.fullName ?? '',
        email: emp.email ?? '',
        phone: emp.phone ?? '',
        alt_phone: emp.altPhone ?? '',
        gender: emp.gender ?? '',
        date_of_birth: emp.dateOfBirth ? emp.dateOfBirth.toISOString().split('T')[0] : '',
        created_at: emp.createdAt ? emp.createdAt.toISOString() : '',
        updated_at: emp.updatedAt ? emp.updatedAt.toISOString() : '',
        deleted_at: emp.deletedAt ? emp.deletedAt.toISOString() : '',
        // Additional fields from relations
        organization_name: emp.organization?.name || '',
        category_name: emp.category?.name || '',
        designation_name: emp.designation?.name || '',
    };
}

async function main() {
    const server = new grpc.Server();
    server.addService(employeeProto.EmployeeService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[employee-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-service] Fatal error:', err);
    process.exit(1);
});