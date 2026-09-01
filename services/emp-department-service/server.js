import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.EMP_DEPT_SERVICE_PORT || 5056;
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

            const dept = await prisma.organizationDepartments.findFirst({
                where: { id: data.department_id },
            })
            if (!dept || dept.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department not found.',
                });
            }
            const emp = await prisma.organizationEmployees.findFirst({
                where: { id: data.employee_id },
            })
            if (!emp || emp.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found.',
                });
            }
            if (data.reporting_to) {
                if (data.reporting_to === data.employee_id) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Reporting to employee cannot be same as employee.',
                    });
                }
                const reportingTo = await prisma.organizationEmployees.findFirst({
                    where: { id: data.reporting_to },
                })
                if (!reportingTo || reportingTo.deletedAt) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Reporting to employee not found.',
                    });
                }
                const reportingToInDept = await prisma.employeeDepartments.findFirst({
                    where: {
                        employeeId: data.reporting_to,
                        departmentId: data.department_id
                    },
                })
                if (!reportingToInDept && dept.departmentHeadId !== data.reporting_to) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Reporting to employee is not assigned to this department.',
                    });
                }
            }

            // Prevent duplicate active assignment
            const activeAssignment = await prisma.employeeDepartments.findFirst({
                where: {
                    employeeId: data.employee_id,
                    departmentId: data.department_id,
                    reportingTo: data.reporting_to ? data.reporting_to : null,
                    OR: [
                        { endDate: null },
                        { endDate: { gte: new Date() } }
                    ]
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
                reportingTo: data.reporting_to || null,
                startDate: new Date(data.start_date),
                endDate: data.end_date ? new Date(data.end_date) : null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };


            const assignment = await prisma.employeeDepartments.create({
                data: mappedData,
                include: {
                    reporting: true,
                    department: { include: { parent: true } },
                    employee: true
                }
            });

            callback(null, {
                success: true,
                message: 'Assignment created successfully.',
                employee_department: mapAssignment(assignment)
            });
        } catch (e) {
            console.error('[emp-department-service] AssignDepartment error:', e);
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
                include: {
                    department: { include: { parent: true } },
                    employee: true,
                    reporting: true
                }
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
                include: { department: { include: { parent: true } } },
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
    // LIST EMPLOYEES IN A DEPARTMENT INCLUDING HEAD
    // ──────────────────────────────────────────────────────────────────────
    ListEmployeeInDepartments: async (call, callback) => {
        try {
            const {
                department_id,
            } = call.request;

            if (!department_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'department_id is required.',
                });
            }
            const department = await prisma.organizationDepartments.findFirst({
                where: { id: department_id },
            });
            if (!department) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Department not found',
                });
            }

            const departmentHead = await prisma.organizationEmployees.findFirst({
                where: { id: department.departmentHeadId },
            });

            const where = {
                departmentId: department_id,
            };


            const assignments = await prisma.employeeDepartments.findMany({
                where,
                include: {
                    employee: true,
                    reporting: true
                },
            });

            callback(null, {
                employees: assignments.map(e => {
                    if (!e.reporting) {
                        return mapAssignmentNew({
                            ...e,
                            reporting: mapEmployee(departmentHead)
                        });
                    }
                    return mapAssignmentNew(e);
                }),
                department_head: mapEmployee(departmentHead),
                success: true,
                message: 'Success fetching employees in department',
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
                reportingTo: data.reporting_to || existing.reportingTo,
                startDate: data.start_date ? new Date(data.start_date) : existing.startDate,
                endDate: data.end_date ? new Date(data.end_date) : existing.endDate,
            };

            const updated = await prisma.employeeDepartments.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    reporting: true,
                    department: { include: { parent: true } },
                    employee: true
                }
            });

            callback(null, { employee_department: mapAssignment(updated) });
        } catch (e) {
            console.log('server.js @ Line 329:', e);
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
function formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}
function mapEmployee(emp) {
    return {
        id: emp.id,
        organization_id: emp.organizationId,
        category_id: emp.categoryId,
        designation_id: emp.designationId ?? '',
        department_id: emp.designation?.departmentId ?? '',
        first_name: emp.firstName ?? '',
        last_name: emp.lastName ?? '',
        full_name: emp.fullName ?? '',
        email: emp.email ?? '',
        phone: emp.phone ?? '',
        alt_phone: emp.altPhone ?? '',
        gender: emp.gender ?? '',
        date_of_birth: emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        created_at: emp.createdAt ? formatDate(emp.createdAt) : null,
        updated_at: emp.updatedAt ? formatDate(emp.updatedAt) : null,
        deleted_at: emp.deletedAt ? formatDate(emp.deletedAt) : null,
    }
}

function mapDepartment(dept = {}) {
    if (!dept || !dept.id) {
        return {};
    }
    return {
        id: dept.id ?? '',
        organization_id: dept.organizationId ?? '',
        name: dept.name ?? '',
        code: dept.code ?? '',
        parent_id: dept.parentId ?? null,
        parent: dept.parent
            ? { id: dept.parent.id, name: dept.parent.name }
            : null,
        department_head_id: dept.departmentHeadId ?? '',
        department_head_start_date: dept.departmentHeadStartDate
            ? formatDate(dept.departmentHeadStartDate)
            : '',
        description: dept.description ?? '',
        note: dept.note ?? '',
        created_at: formatDate(dept.createdAt),
        updated_at: formatDate(dept.updatedAt),
    };
}

function mapAssignmentNew(a) {
    return {
        ...mapEmployee(a.employee),
        reporting: a.reporting ? mapEmployee(a.reporting) : null,
    };
}
function mapAssignment(a) {
    return {
        id: a.id,
        department_id: a.departmentId,
        employee_id: a.employeeId,
        start_date: a.startDate ? formatDate(a.startDate) : null,
        end_date: a.startDate ? formatDate(a.startDate) : null,
        created_at: a.createdAt ? formatDate(a.createdAt) : null,
        updated_at: a.updatedAt ? formatDate(a.updatedAt) : null,
        deleted_at: a.deletedAt ? formatDate(a.deletedAt) : null,
        employee: mapEmployee(a.employee),
        reporting: a.reporting && mapEmployee(a.reporting),
        department: mapDepartment(a.department),
    };
}

// ──────────────────────────────────────────────────────────────────────────
// SERVER START
// ──────────────────────────────────────────────────────────────────────────
async function main() {
    await checkDbConnection('employee-department-service');
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