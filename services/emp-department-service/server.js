import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.EMP_DEPT_SERVICE_PORT || 50056;
const proto = loadProto('employee_department');

const impl = {
    // ──────────────────────────────────────────────────────────────────────
    // ASSIGN DEPARTMENT TO EMPLOYEE
    // ──────────────────────────────────────────────────────────────────────
    AssignDepartment: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.department_id || !data.employee_id || !data.start_date) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'department_id, employee_id, and start_date are required.',
                });
            }

            // Validate ObjectIds
            const validId = /^[0-9a-fA-F]{24}$/;
            if (!validId.test(data.department_id) || !validId.test(data.employee_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid department_id or employee_id format.',
                });
            }

            // Check if department & employee exist
            const [dept, emp] = await Promise.all([
                prisma.organizationDepartments.findUnique({
                    where: { id: data.department_id, deletedAt: null },
                }),
                prisma.organizationEmployees.findUnique({
                    where: { id: data.employee_id, deletedAt: null },
                }),
            ]);

            if (!dept || !emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department or Employee not found.',
                });
            }

            // Prevent duplicate active assignment
            const activeAssignment = await prisma.employeeDepartments.findFirst({
                where: {
                    employeeId: data.employee_id,
                    departmentId: data.department_id,
                    endDate: null,
                },
            });

            if (activeAssignment) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Employee is already assigned to this department.',
                });
            }

            const mappedData = {
                departmentId: data.department_id,
                employeeId: data.employee_id,
                startDate: new Date(data.start_date),
                endDate: data.end_date ? new Date(data.end_date) : null,
            };

            const assignment = await prisma.employeeDepartments.create({
                data: mappedData,
            });

            callback(null, { employee_department: mapAssignment(assignment) });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // GET ASSIGNMENT
    // ──────────────────────────────────────────────────────────────────────
    GetEmployeeDepartment: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid assignment id',
                });

            const assignment = await prisma.employeeDepartments.findUnique({
                where: { id },
            });

            if (!assignment)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Assignment not found',
                });

            callback(null, { employee_department: mapAssignment(assignment) });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // LIST ASSIGNMENTS
    // ──────────────────────────────────────────────────────────────────────
    ListEmployeeDepartments: async (call, callback) => {
        try {
            const {
                employee_id,
                department_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'start_date',
                sort_order = 'desc',
            } = call.request;

            if (!employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'employee_id is required.',
                });
            }

            const skip = (page - 1) * limit;

            const where = {
                employeeId: employee_id,
                ...(department_id ? { departmentId: department_id } : {}),
                ...(search
                    ? {
                        OR: [
                            { department: { name: { contains: search, mode: 'insensitive' } } },
                        ],
                    }
                    : {}),
            };

            const validSortFields = {
                start_date: 'startDate',
                end_date: 'endDate',
            };

            const sortField = validSortFields[sort_by] || 'startDate';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.employeeDepartments.count({ where });

            const assignments = await prisma.employeeDepartments.findMany({
                where,
                include: { department: { select: { name: true } } },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                employee_departments: assignments.map(mapAssignment),
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

    // ──────────────────────────────────────────────────────────────────────
    // UPDATE ASSIGNMENT
    // ──────────────────────────────────────────────────────────────────────
    UpdateEmployeeDepartment: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid assignment id',
                });

            const existing = await prisma.employeeDepartments.findUnique({
                where: { id: data.id },
            });

            if (!existing)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Assignment not found',
                });

            const updateData = {
                departmentId: data.department_id || existing.departmentId,
                employeeId: data.employee_id || existing.employeeId,
                startDate: data.start_date ? new Date(data.start_date) : existing.startDate,
                endDate: data.end_date ? new Date(data.end_date) : existing.endDate,
            };

            const updated = await prisma.employeeDepartments.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, { employee_department: mapAssignment(updated) });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // ──────────────────────────────────────────────────────────────────────
    // REMOVE (Soft delete via endDate)
    // ──────────────────────────────────────────────────────────────────────
    RemoveEmployeeDepartment: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid assignment id',
                });

            const assignment = await prisma.employeeDepartments.findUnique({
                where: { id },
            });

            if (!assignment)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Assignment not found',
                });

            await prisma.employeeDepartments.update({
                where: { id },
                data: { endDate: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Employee removed from department',
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};

// ──────────────────────────────────────────────────────────────────────────
// MAPPER
// ──────────────────────────────────────────────────────────────────────────
function mapAssignment(a) {
    return {
        id: a.id,
        department_id: a.departmentId,
        employee_id: a.employeeId,
        start_date: a.startDate?.toISOString() ?? '',
        end_date: a.endDate?.toISOString() ?? '',
    };
}

// ──────────────────────────────────────────────────────────────────────────
// SERVER START
// ──────────────────────────────────────────────────────────────────────────
async function main() {
    const server = new grpc.Server();
    server.addService(proto.EmployeeDepartmentService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-department-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-department-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[employee-department-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[employee-department-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-department-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[emp-department-service] Fatal error:', err);
    process.exit(1);
});