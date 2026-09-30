// holiday-service/server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

/* ---------------------------------------------
   CONFIG
--------------------------------------------- */
const PORT = process.env.HOLIDAY_SERVICE_PORT || 5079;
const holidayProto = loadProto('holiday');

/* ---------------------------------------------
   HELPERS
--------------------------------------------- */
function localDayKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function toApiHoliday(h) {
    if (!h) return null;

    return {
        id: h.id,
        organization_id: h.organizationId,
        policy_id: h.policyId || '',
        date: localDayKey(h.date),
        name: h.name,
        type: h.type || 'PUBLIC',
        leave_optional: h.leaveOptional || false,

        created_at: h.createdAt?.toISOString() || '',
        updated_at: h.updatedAt?.toISOString() || '',
    };
}

/* ============================================================
   IMPLEMENTATION
============================================================ */
const impl = {
    /* --------------------------------------------------------
       CREATE
    -------------------------------------------------------- */
    CreateHoliday: async (call, cb) => {
        try {
            const { organization_id, policy_id, date, name, type, leave_optional } = call.request;

            // Validate policy ownership if policy_id is provided
            if (policy_id) {
                const policy = await prisma.holidayPolicies.findFirst({
                    where: { deletedAt: null, id: policy_id, isActive: true },
                });
                if (!policy) {
                    return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday policy not found' });
                }
                if (policy.organizationId !== organization_id) {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Holiday policy does not belong to this organization' });
                }
            }

            // Check duplicate name within organization
            const holidayNameExists = await prisma.holidays.findFirst({
                where: { deletedAt: null, name, organizationId: organization_id },
            });
            // if (holidayNameExists) {
            //     return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Holiday name already exists' });
            // }

            const holiday = await prisma.holidays.create({
                data: {
                    organizationId: organization_id,
                    policyId: policy_id || null,
                    date: new Date(date),
                    name,
                    type: type || 'PUBLIC',
                    leaveOptional: leave_optional || false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            cb(null, {
                holiday: toApiHoliday(holiday),
                message: 'Holiday created',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       UPDATE
    -------------------------------------------------------- */
    UpdateHoliday: async (call, cb) => {
        try {
            const { holiday_id, policy_id, date, name, type, leave_optional } = call.request;

            const holidayIdExists = await prisma.holidays.findFirst({
                where: { deletedAt: null, id: holiday_id },
            });
            if (!holidayIdExists) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday not found' });
            }

            // Validate policy ownership if policy_id is being changed
            if (policy_id && policy_id !== '' && policy_id !== holidayIdExists.policyId) {
                const policy = await prisma.holidayPolicies.findFirst({
                    where: { deletedAt: null, id: policy_id, isActive: true },
                });
                if (!policy) {
                    return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday policy not found' });
                }
                if (policy.organizationId !== holidayIdExists.organizationId) {
                    return cb({ code: grpc.status.FAILED_PRECONDITION, message: 'Holiday policy does not belong to this organization' });
                }
            }

            // Check duplicate name within organization (excluding current holiday)
            if (name) {
                const holidayNameExistsWithOtherID = await prisma.holidays.findFirst({
                    where: { deletedAt: null, name, id: { not: holiday_id }, organizationId: holidayIdExists.organizationId },
                });
                if (holidayNameExistsWithOtherID) {
                    return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Holiday name already exists' });
                }
            }

            const holiday = await prisma.holidays.update({
                where: { id: holiday_id },
                data: {
                    policyId: policy_id != '' && policy_id != null ? policy_id : holidayIdExists.policyId,
                    date: date ? new Date(date) : holidayIdExists.date,
                    name: name ?? holidayIdExists.name,
                    type: type ?? holidayIdExists.type,
                    leaveOptional: typeof leave_optional === 'boolean' ? leave_optional : holidayIdExists.leaveOptional,
                    updatedAt: new Date(),
                },
            });

            cb(null, {
                holiday: toApiHoliday(holiday),
                message: 'Updated',
            });
        } catch (e) {
            if (e.code === 'P2025') {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday not found' });
            }
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       DELETE (soft delete)
    -------------------------------------------------------- */
    DeleteHoliday: async (call, cb) => {
        try {
            const { holiday_id } = call.request;

            const holiday = await prisma.holidays.findFirst({
                where: { deletedAt: null, id: holiday_id },
            });
            if (!holiday) {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday not found' });
            }

            await prisma.holidays.update({
                where: { id: holiday_id },
                data: { deletedAt: new Date() },
            });

            cb(null, {
                success: true,
                message: 'Deleted successfully',
            });
        } catch (e) {
            if (e.code === 'P2025') {
                return cb({ code: grpc.status.NOT_FOUND, message: 'Holiday not found' });
            }
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       GET SINGLE
    -------------------------------------------------------- */
    GetHoliday: async (call, cb) => {
        try {
            const { holiday_id } = call.request;

            const holiday = await prisma.holidays.findFirst({
                where: { deletedAt: null, id: holiday_id },
            });

            if (!holiday) {
                return cb(null, {
                    holiday: null,
                    message: 'Not found',
                });
            }

            cb(null, {
                holiday: toApiHoliday(holiday),
                message: 'Success',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       LIST HOLIDAYS (with filters + total_count)
    -------------------------------------------------------- */
    ListHolidays: async (call, cb) => {
        try {
            const { organization_id, year, type, policy_id } = call.request;

            // year arrives as a string over gRPC (proto: string year).
            // Must parse to integer before arithmetic — `year + 1` on "2026"
            // yields "20261" and new Date("20261", 0, 1) becomes +020260-12-31…
            let dateRange;
            if (year !== undefined && year !== null && year !== '') {
                const yearNum = Number(year);
                if (!Number.isInteger(yearNum) || yearNum < 1970 || yearNum > 9999) {
                    return cb({ code: grpc.status.INVALID_ARGUMENT, message: `Invalid year: ${year}` });
                }
                dateRange = {
                    date: {
                        gte: new Date(yearNum, 0, 1),
                        lt: new Date(yearNum + 1, 0, 1),
                    },
                };
            }

            const where = {
                organizationId: organization_id,
                ...(dateRange || {}),
                ...(type ? { type } : {}),
                ...(policy_id ? { policyId: policy_id } : {}),
            };

            const [rows, count] = await Promise.all([
                prisma.holidays.findMany({
                    where,
                    orderBy: { date: 'asc' },
                }),
                prisma.holidays.count({ where }),
            ]);

            cb(null, {
                holidays: rows.map(toApiHoliday),
                total_count: count,
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* --------------------------------------------------------
       HOLIDAY CALENDAR (MONTH VIEW)
    -------------------------------------------------------- */
    GetHolidayCalendar: async (call, cb) => {
        try {
            const { organization_id, month, policy_id } = call.request;

            const [year, m] = month.split('-').map(Number);
            const start = new Date(year, m - 1, 1);
            const end = new Date(year, m, 0);

            const where = {
                organizationId: organization_id,
                date: { gte: start, lt: new Date(year, m, 1) },
                ...(policy_id ? { policyId: policy_id } : {}),
            };

            const holidays = await prisma.holidays.findMany({
                where,
            });

            const result = [];

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = localDayKey(d);

                const hl = holidays.find(
                    (h) => localDayKey(h.date) === dateStr
                );

                result.push({
                    date: dateStr,
                    is_holiday: !!hl,
                    name: hl?.name || '',
                    type: hl?.type || '',
                    leave_optional: hl?.leaveOptional || false,
                });
            }

            cb(null, { days: result });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ============================================================
   SERVER BOOTSTRAP
============================================================ */
async function main() {
    await checkDbConnection('holiday-service');

    const server = new grpc.Server();
    server.addService(holidayProto.HolidayService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[holiday-service] gRPC running on :${PORT}`);

    // graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n[holiday-service] ${signal} received, shutting down...`);
        server.tryShutdown(async () => {
            await prisma.$disconnect();
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
    console.error('[holiday-service] Fatal:', e);
    process.exit(1);
});
