import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.EMP_SERVICE_PORT || 50053;
const employeeProto = loadProto('employee');

const impl = {
    CreateEmployee: async (call, callback) => {
        try {
            const data = call.request;

            // required fields (unchanged)
            if (!data.organization_id || !data.category_id || !data.phone) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, category_id, and phone are required.',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                categoryId: data.category_id,
                designationId: data.designation_id || null,          // ← NEW
                firstName: data.first_name || null,
                lastName: data.last_name || null,
                fullName:
                    data.full_name ||
                    `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                email: data.email || null,
                phone: data.phone,
                altPhone: data.alt_phone || null,
                gender: data.gender ? data.gender.toUpperCase() : null,
                dateOfBirth: new Date(data.date_of_birth),
                createdAt: new Date()
            };

            const employee = await prisma.organizationEmployees.create({
                data: mappedData,
            });

            callback(null, { employee: mapEmployee(employee) });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            const emp = await prisma.organizationEmployees.findUnique({ where: { id, deletedAt: null } });

            if (!emp)
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            callback(null, { employee: mapEmployee(emp) });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListEmployees: async (call, callback) => {
        try {
            const { organization_id, category_id, designation_id } = call.request; // ← NEW filter
            const where = {
                deletedAt: null,
                ...(organization_id ? { organizationId: organization_id } : {}),
                ...(category_id ? { categoryId: category_id } : {}),
                ...(designation_id ? { designationId: designation_id } : {}),
            };

            const employees = await prisma.organizationEmployees.findMany({ where });
            callback(null, { employees: employees.map(mapEmployee) });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateEmployee: async (call, callback) => {
        try {
            const data = call.request;

            const existing = await prisma.organizationEmployees.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing)
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            const updateData = {
                organizationId: data.organization_id ?? existing.organizationId,
                categoryId: data.category_id ?? existing.categoryId,
                designationId: data.designation_id ?? existing.designationId, // ← NEW
                firstName: data.first_name ?? existing.firstName,
                lastName: data.last_name ?? existing.lastName,
                fullName:
                    data.full_name ||
                    `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                email: data.email || existing.email,
                phone: data.phone || existing.phone,
                altPhone: data.alt_phone || existing.altPhone,
                gender: data.gender ? data.gender.toUpperCase() : null,
                dateOfBirth: data.date_of_birth
                    ? new Date(data.date_of_birth)
                    : existing.dateOfBirth,
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationEmployees.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, { employee: mapEmployee(updated) });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            const emp = await prisma.organizationEmployees.findUnique({ where: { id, deletedAt: null } });
            if (!emp)
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            await prisma.organizationEmployees.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Employee deleted successfully' });
        } catch (e) {
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
        designation_id: emp.designationId ?? '',               // ← NEW
        first_name: emp.firstName ?? '',
        last_name: emp.lastName ?? '',
        full_name: emp.fullName ?? '',
        email: emp.email ?? '',
        phone: emp.phone ?? '',
        alt_phone: emp.altPhone ?? '',
        gender: emp.gender ?? '',
        date_of_birth: emp.dateOfBirth ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }) : '',
        created_at: emp.createdAt ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) : '',
        updated_at: emp.updatedAt ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) : '',
        deleted_at: emp.deletedAt ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) : '',
    };
}

async function main() {
    const server = new grpc.Server();
    server.addService(employeeProto.EmployeeService.service, impl);

    // ✅ Same as organization-service
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
