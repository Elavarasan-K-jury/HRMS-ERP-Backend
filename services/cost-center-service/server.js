import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.COST_CENTER_SERVICE_PORT || 5055);
const costCenterProto = loadProto('cost_center');

const impl = {
    CreateCostCenter: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.name || !data.code) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, name and code are required.',
                });
            }

            const name = data.name.trim();
            const code = data.code.trim();

            if (!name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Name is required.',
                });
            }
            if (!code) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Code is required.',
                });
            }

            const existing = await prisma.costCenters.findFirst({
                where: {
                    organizationId: data.organization_id,
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } },
                    ],
                    deletedAt: null,
                },
            });

            if (existing) {
                const isCode = existing.code.toLowerCase() === code.toLowerCase();
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: isCode
                        ? 'A cost center with this code already exists in the organization.'
                        : 'A cost center with this name already exists in the organization.',
                });
            }

            const costCenter = await prisma.costCenters.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    code,
                    description: data.description?.trim() || null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                cost_center: mapCostCenter(costCenter),
                message: 'Cost center created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreateCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetCostCenter: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid cost center id',
                });
            }

            const costCenter = await prisma.costCenters.findFirst({
                where: { id, deletedAt: null },
            });

            if (!costCenter) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Cost center not found',
                });
            }

            const employeeCount = await prisma.organizationEmployees.count({
                where: { costCenterId: id, deletedAt: null },
            });

            callback(null, {
                cost_center: { ...mapCostCenter(costCenter), employee_count: employeeCount },
                message: 'Cost center found successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListCostCenters: async (call, callback) => {
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

            let where = {};
            if (organization_id) {
                where = { organizationId: organization_id };
            }
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { code: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                name: 'name',
                code: 'code',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.costCenters.count({
                where: { ...where, deletedAt: null },
            });

            const costCenters = await prisma.costCenters.findMany({
                where: { ...where, deletedAt: null },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const ids = costCenters.map(c => c.id);
            const counts = ids.length
                ? await prisma.organizationEmployees.groupBy({
                    by: ['costCenterId'],
                    where: { costCenterId: { in: ids }, deletedAt: null },
                    _count: { _all: true },
                })
                : [];
            const countMap = {};
            counts.forEach(c => { countMap[c.costCenterId] = c._count._all; });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                cost_centers: costCenters.map(c => ({
                    ...mapCostCenter(c),
                    employee_count: countMap[c.id] || 0,
                })),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Cost centers found successfully',
            });
        } catch (e) {
            console.error('ListCostCenters Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateCostCenter: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid cost center id',
                });
            }

            const existing = await prisma.costCenters.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Cost center not found',
                });
            }

            const name = (data.name !== undefined && data.name !== null && data.name !== '')
                ? data.name.trim()
                : existing.name;
            const code = (data.code !== undefined && data.code !== null && data.code !== '')
                ? data.code.trim()
                : existing.code;

            if (!name || !code) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Name and code are required.',
                });
            }

            const conflict = await prisma.costCenters.findFirst({
                where: {
                    organizationId: data.organization_id || existing.organizationId,
                    deletedAt: null,
                    id: { not: data.id },
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } },
                    ],
                },
            });

            if (conflict) {
                const isCode = conflict.code.toLowerCase() === code.toLowerCase();
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: isCode
                        ? 'Another cost center with this code already exists in the organization.'
                        : 'Another cost center with this name already exists in the organization.',
                });
            }

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                name,
                code,
                description: data.description !== undefined && data.description !== null
                    ? (data.description.trim() || null)
                    : existing.description,
                isActive: data.is_active !== undefined && data.is_active !== null
                    ? Boolean(data.is_active)
                    : existing.isActive,
                updatedAt: new Date(),
            };

            const updated = await prisma.costCenters.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, {
                cost_center: mapCostCenter(updated),
                message: 'Cost center updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdateCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteCostCenter: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid cost center id',
                });
            }

            const costCenter = await prisma.costCenters.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!costCenter) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Cost center not found',
                });
            }

            const employeeCount = await prisma.organizationEmployees.count({
                where: { costCenterId: id, deletedAt: null },
            });

            if (employeeCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot delete cost center. ${employeeCount} employee(s) are still assigned to it. Reassign or remove them first.`,
                });
            }

            await prisma.costCenters.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Cost center deleted successfully',
            });
        } catch (e) {
            console.error('DeleteCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListCostCenterEmployees: async (call, callback) => {
        try {
            const {
                cost_center_id,
                organization_id,
                page = 1,
                limit = 10,
                search = '',
            } = call.request;

            const skip = (page - 1) * limit;

            if (!cost_center_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'cost_center_id is required.',
                });
            }

            let where = {
                costCenterId: cost_center_id,
                deletedAt: null,
            };
            if (organization_id) {
                where.organizationId = organization_id;
            }
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { employeeCode: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const total = await prisma.organizationEmployees.count({ where });

            const employees = await prisma.organizationEmployees.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } },
                    },
                    manager: true,
                },
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                employees: employees.map(mapCostCenterEmployee),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Employees found successfully',
            });
        } catch (e) {
            console.error('ListCostCenterEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    AssignEmployeesToCostCenter: async (call, callback) => {
        try {
            const { cost_center_id, organization_id, employee_ids } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(cost_center_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid cost center id',
                });
            }
            if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Select at least one employee to assign.',
                });
            }

            const costCenter = await prisma.costCenters.findFirst({
                where: { id: cost_center_id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!costCenter) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Cost center not found',
                });
            }

            const existing = await prisma.organizationEmployees.findMany({
                where: {
                    id: { in: employee_ids },
                    organizationId: organization_id || undefined,
                    deletedAt: null,
                },
                select: { id: true },
            });

            const validIds = existing.map(e => e.id);

            if (validIds.length === 0) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'No valid employees found to assign.',
                });
            }

            await prisma.organizationEmployees.updateMany({
                where: { id: { in: validIds } },
                data: { costCenterId: cost_center_id, updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: `${validIds.length} employee(s) assigned to the cost center successfully.`,
                assigned_count: validIds.length,
            });
        } catch (e) {
            console.error('AssignEmployeesToCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RemoveEmployeeFromCostCenter: async (call, callback) => {
        try {
            const { cost_center_id, organization_id, employee_id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(cost_center_id) || !/^[0-9a-fA-F]{24}$/.test(employee_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid cost center or employee id',
                });
            }

            const employee = await prisma.organizationEmployees.findFirst({
                where: {
                    id: employee_id,
                    costCenterId: cost_center_id,
                    organizationId: organization_id || undefined,
                    deletedAt: null,
                },
            });

            if (!employee) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found in this cost center.',
                });
            }

            await prisma.organizationEmployees.update({
                where: { id: employee_id },
                data: { costCenterId: null, updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Employee removed from the cost center successfully.',
            });
        } catch (e) {
            console.error('RemoveEmployeeFromCostCenter Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

function mapCostCenter(c = {}) {
    return {
        id: c.id ?? '',
        organization_id: c.organizationId ?? '',
        name: c.name ?? '',
        code: c.code ?? '',
        description: c.description ?? '',
        is_active: c.isActive ?? true,
        employee_count: c.employeeCount ?? 0,
        created_at: c.createdAt ? c.createdAt.toISOString() : '',
        updated_at: c.updatedAt ? c.updatedAt.toISOString() : '',
        deleted_at: c.deletedAt ? c.deletedAt.toISOString() : '',
    };
}

function mapCostCenterEmployee(emp = {}) {
    const assignments = emp.departmentAssignments || [];
    const primaryDept = assignments.length > 0
        ? (assignments[0].department?.parent
            ? `${assignments[0].department.parent.name} >> ${assignments[0].department.name}`
            : assignments[0].department?.name || '')
        : '';
    return {
        id: emp.id ?? '',
        organization_id: emp.organizationId ?? '',
        employee_code: emp.employeeCode ?? '',
        first_name: emp.firstName ?? '',
        last_name: emp.lastName ?? '',
        full_name: emp.fullName ?? '',
        email: emp.email ?? '',
        designation_name: emp.designation?.name ?? '',
        department_name: primaryDept,
        reporting_manager_name: emp.manager?.fullName ?? '',
        reporting_manager_id: emp.managerId ?? '',
        profile_image_file_id: emp.profileImageFileId ?? '',
        profile_image: emp.profileImage ?? '',
    };
}

async function main() {
    await checkDbConnection('cost-center-service');
    const server = new grpc.Server();
    server.addService(costCenterProto.CostCenterService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[cost-center-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[cost-center-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[cost-center-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[cost-center-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[cost-center-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[cost-center-service] Fatal error:', err);
    process.exit(1);
});