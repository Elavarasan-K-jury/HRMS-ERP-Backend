import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.EMP_CAT_SERVICE_PORT || 5052);
const employeeCategoryProto = loadProto('employee_category');

const impl = {
    CreateEmployeeCategory: async (call, callback) => {
        try {
            const data = call.request;

            const existing = await prisma.employeeCategories.findFirst({
                where: { name: data.name, organizationId: data.organization_id },
            });

            if (existing && existing.deletedAt === null) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Employee category already exists',
                });
            }

            const organizationExists = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            });

            if (!organizationExists) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const mappedData = {
                organizationId: data.organization_id,
                name: data.name,
                description: data.description ?? null,
                isActive: data.is_active,
                employmentType: data.employment_type || 'PROBATION',
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            let category;
            if (existing && existing.deletedAt !== null) {
                category = await prisma.employeeCategories.update({
                    where: { id: existing.id },
                    data: mappedData,
                });
            } else {
                category = await prisma.employeeCategories.create({ data: mappedData });
            }

            callback(null, {
                category: mapCategory(category),
                success: true,
                message: 'Created successfully',
            });
        } catch (e) {
            console.error('CreateEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    GetEmployeeCategory: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const category = await prisma.employeeCategories.findFirst({
                where,
                include: {
                    organization: true,
                },
            });

            if (!category) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee category not found',
                });
            }

            callback(null, {
                category: mapCategory(category),
                success: true,
                message: 'Fetched successfully',
            });
        } catch (e) {
            console.error('GetEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListEmployeeAllCategories: async (call, callback) => {
        try {
            const {
                organization_id,
            } = call.request;

            let where = {
                deletedAt: null,
            };

            if (organization_id) {
                where = {
                    ...where,
                    organizationId: organization_id,
                }
            }

            const categories = await prisma.employeeCategories.findMany({
                where,
                include: {
                    organization: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            callback(null, {
                categories: categories.map(mapCategory),
                success: true,
                message: 'Employee categories found successfully',
            });
        } catch (e) {
            console.error('ListEmployeeCategories Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListEmployeeCategories: async (call, callback) => {
        try {
            const {
                organization_id,
                page,
                limit,
                search,
                sort_by,
                sort_order,
            } = call.request;

            let paginate = {};
            if (page && limit) {
                paginate = {
                    skip: (page - 1) * limit,
                    take: limit,
                }
            }

            let where = {
                deletedAt: null,
            };

            if (organization_id) {
                where = {
                    ...where,
                    organizationId: organization_id,
                }
            }

            if (search) {
                where = {
                    ...where,
                    name: { contains: search, mode: 'insensitive' },
                }
            }

            const validSortFields = {
                name: 'name',
                createdAt: 'createdAt',
                updatedAt: 'updatedAt',
            };

            const validSortOrders = {
                asc: 'asc',
                desc: 'desc',
            };

            const orderByField = validSortFields[sort_by] || 'createdAt';
            const order = validSortOrders[sort_order] || 'desc';

            const categories = await prisma.employeeCategories.findMany({
                where,
                orderBy: { [orderByField]: order },
                ...paginate,
                include: {
                    organization: true,
                }
            });

            const total = await prisma.employeeCategories.count({ where });

            callback(null, {
                categories: categories.map(mapCategory),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: 'Employee categories found successfully',
            });
        } catch (e) {
            console.error('ListEmployeeCategories Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    UpdateEmployeeCategory: async (call, callback) => {
        try {
            const data = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }
            // ✅ Also sanitize organization_id completely
            const organization = await prisma.organizations.findUnique({
                where: { id: data.organization_id },
            })
            if (!organization) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const categoryInOrg = await prisma.employeeCategories.findFirst({
                where: { id: data.id, organizationId: data.organization_id, deletedAt: null },
            });

            if (!categoryInOrg) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee category not found',
                });
            }

            const updated = await prisma.employeeCategories.update({
                where: { id: data.id },
                data: {
                    name: data.name,
                    description: data.description ?? null,
                    isActive: data.is_active,
                    employmentType: data.employment_type || undefined,
                    updatedAt: new Date(),
                },
            });

            callback(null, {
                category: mapCategory(updated),
                success: true,
                message: 'Updated successfully',
            });
        } catch (e) {
            console.error('❌ UpdateEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    DeleteEmployeeCategory: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid category id',
                });
            }

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const category = await prisma.employeeCategories.findFirst({ where });

            if (!category) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee category not found',
                });
            }

            await prisma.employeeCategories.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, { success: true, message: 'Deleted successfully' });
        } catch (e) {
            console.error('DeleteEmployeeCategory Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
};
function mapOrg(org = {}) {
    if (!org || !org.id) {
        return {};
    }
    return {
        id: org.id ?? '',
        name: org.name ?? '',
        domain: org.domain ?? '',
        gst_number: org.GSTNumber ?? '',
        email: org.email ?? '',
        contact_person_name: org.contactPersonName ?? '',
        contact_person_number: org.contactPersonNumber ?? '',
        note: org.note ?? '',
        industry: org.industry ?? '',
        size: org.size ?? 0,
        address: org.address ? JSON.stringify(org.address) : '',
        created_at: formatDate(org.createdAt),
        updated_at: formatDate(org.updatedAt),
    };
}
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


function mapCategory(category) {
    return {
        id: category.id,
        organization_id: category.organizationId,
        organization: mapOrg(category.organization),
        name: category.name,
        description: category.description ?? '',
        is_active: category.isActive,
        employment_type: category.employmentType ?? 'PROBATION',
        created_at: formatDate(category.createdAt),
        updated_at: formatDate(category.updatedAt),
        deleted_at: formatDate(category.deletedAt),
    };
}



async function main() {
    await checkDbConnection('employee-category-service');
    const server = new grpc.Server();

    server.addService(employeeCategoryProto.EmployeeCategoryService.service, impl);

    // Convert bindAsync to Promise
    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-category-service] gRPC running on :${PORT}`);

    // Graceful shutdown handler
    const shutdown = async (signal) => {
        console.log(`\n[employee-category-service] Received ${signal}, shutting down gracefully...`);

        try {
            // 🧹 Stop accepting new gRPC calls
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-category-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-category-service] gRPC server stopped.');
                }
            });

            // 🧹 Disconnect Prisma cleanly
            await prisma.$disconnect();
            console.log('[employee-category-service] Prisma disconnected.');

            process.exit(0);
        } catch (e) {
            console.error('[employee-category-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    // Handle termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-category-service] Fatal error:', err);
    process.exit(1);
});