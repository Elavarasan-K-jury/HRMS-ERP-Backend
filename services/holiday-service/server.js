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
function toApiHoliday(h) {
    if (!h) return null;

    return {
        id: h.id,
        organization_id: h.organizationId,
        policy_id: h.policyId || '',
        date: h.date?.toISOString().split('T')[0],
        name: h.name,
        region: h.region || '',
        type: h.type || 'PUBLIC',

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
            const { organization_id, policy_id, date, name, region, type } = call.request;

            const holiday = await prisma.holidays.create({
                data: {
                    organizationId: organization_id,
                    policyId: policy_id || null,
                    date: new Date(date),
                    name,
                    region,
                    type: type || 'PUBLIC', // must match Prisma enum
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
            const { holiday_id, policy_id, date, name, region, type } = call.request;

            const holiday = await prisma.holidays.update({
                where: { id: holiday_id },
                data: {
                    policyId: policy_id ?? undefined,
                    date: date ? new Date(date) : undefined,
                    name: name ?? undefined,
                    region: region ?? undefined,
                    type: type ?? undefined,
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
       DELETE
    -------------------------------------------------------- */
    DeleteHoliday: async (call, cb) => {
        try {
            const { holiday_id } = call.request;

            await prisma.holidays.delete({
                where: { id: holiday_id },
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

            const holiday = await prisma.holidays.findUnique({
                where: { id: holiday_id },
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
            const { organization_id, year, type, region, policy_id } = call.request;

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(year
                    ? {
                          date: {
                              gte: new Date(`${year}-01-01T00:00:00.000Z`),
                              lte: new Date(`${year}-12-31T23:59:59.999Z`),
                          },
                      }
                    : {}),
                ...(type ? { type } : {}),
                ...(region ? { region } : {}),
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
       HOLIDAY CALENDAR (MONTH VIEW, optional policy/region)
    -------------------------------------------------------- */
    GetHolidayCalendar: async (call, cb) => {
        try {
            const { organization_id, month, policy_id, region } = call.request;

            const [year, m] = month.split('-').map(Number);
            const start = new Date(year, m - 1, 1);
            const end = new Date(year, m, 0);

            const where = {
                organizationId: organization_id,
                date: { gte: start, lte: end },
                deletedAt: null,
                ...(policy_id ? { policyId: policy_id } : {}),
                ...(region ? { region } : {}),
            };

            const holidays = await prisma.holidays.findMany({
                where,
            });

            const result = [];

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];

                const hl = holidays.find(
                    (h) => h.date.toISOString().split('T')[0] === dateStr
                );

                result.push({
                    date: dateStr,
                    is_holiday: !!hl,
                    name: hl?.name || '',
                    type: hl?.type || '',
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
