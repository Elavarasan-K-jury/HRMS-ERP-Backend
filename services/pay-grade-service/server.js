import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.PAY_GRADE_SERVICE_PORT || 5056);
const payGradeProto = loadProto('pay_grade');

const MAX_NAME_LENGTH = 100;

function validObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id || '');
}

const impl = {
    CreatePayGrade: async (call, callback) => {
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

            const existing = await prisma.payGrades.findFirst({
                where: {
                    organizationId: data.organization_id,
                    name: { equals: name, mode: 'insensitive' },
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A pay grade with this name already exists in the organization.',
                });
            }

            const payGrade = await prisma.payGrades.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, {
                pay_grade: mapPayGrade(payGrade),
                message: 'Pay grade created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreatePayGrade Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetPayGrade: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid pay grade id',
                });
            }

            const payGrade = await prisma.payGrades.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!payGrade) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Pay grade not found',
                });
            }

            const employeeCount = await prisma.organizationEmployees.count({
                where: { payGradeId: id, deletedAt: null },
            });

            callback(null, {
                pay_grade: { ...mapPayGrade(payGrade), employee_count: employeeCount },
                message: 'Pay grade found successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetPayGrade Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPayGrades: async (call, callback) => {
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
                        { description: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                name: 'name',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.payGrades.count({
                where: { ...where, deletedAt: null },
            });

            const payGrades = await prisma.payGrades.findMany({
                where: { ...where, deletedAt: null },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const ids = payGrades.map(p => p.id);
            const counts = ids.length
                ? await prisma.organizationEmployees.groupBy({
                    by: ['payGradeId'],
                    where: { payGradeId: { in: ids }, deletedAt: null },
                    _count: { _all: true },
                })
                : [];
            const countMap = {};
            counts.forEach(c => { countMap[c.payGradeId] = c._count._all; });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                pay_grades: payGrades.map(p => ({
                    ...mapPayGrade(p),
                    employee_count: countMap[p.id] || 0,
                })),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Pay grades found successfully',
            });
        } catch (e) {
            console.error('ListPayGrades Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdatePayGrade: async (call, callback) => {
        try {
            const data = call.request;

            if (!validObjectId(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid pay grade id',
                });
            }

            const existing = await prisma.payGrades.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Pay grade not found',
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

            const conflict = await prisma.payGrades.findFirst({
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
                    message: 'A pay grade with this name already exists in the organization.',
                });
            }

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                name,
                description: data.description !== undefined && data.description !== null
                    ? (data.description.trim() || null)
                    : existing.description,
                updatedAt: new Date(),
            };

            const updated = await prisma.payGrades.update({
                where: { id: data.id },
                data: updateData,
            });

            callback(null, {
                pay_grade: mapPayGrade(updated),
                message: 'Pay grade updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdatePayGrade Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeletePayGrade: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid pay grade id',
                });
            }

            const payGrade = await prisma.payGrades.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!payGrade) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Pay grade not found',
                });
            }

            const employeeCount = await prisma.organizationEmployees.count({
                where: { payGradeId: id, deletedAt: null },
            });

            if (employeeCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `This pay grade is currently assigned to ${employeeCount} employee(s). Please reassign those employees before deleting this pay grade.`,
                });
            }

            await prisma.payGrades.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Pay grade deleted successfully',
            });
        } catch (e) {
            console.error('DeletePayGrade Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

function mapPayGrade(p = {}) {
    return {
        id: p.id ?? '',
        organization_id: p.organizationId ?? '',
        name: p.name ?? '',
        description: p.description ?? '',
        employee_count: p.employeeCount ?? 0,
        created_at: p.createdAt ? p.createdAt.toISOString() : '',
        updated_at: p.updatedAt ? p.updatedAt.toISOString() : '',
        deleted_at: p.deletedAt ? p.deletedAt.toISOString() : '',
    };
}

async function main() {
    await checkDbConnection('pay-grade-service');
    const server = new grpc.Server();
    server.addService(payGradeProto.PayGradeService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[pay-grade-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[pay-grade-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[pay-grade-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[pay-grade-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[pay-grade-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[pay-grade-service] Fatal error:', err);
    process.exit(1);
});