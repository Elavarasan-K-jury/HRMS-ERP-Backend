// services/attendance-log-service/server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.ATTENDANCE_LOG_SERVICE_PORT || 5070);
const attendanceLogProto = loadProto('attendance_log');

function toDateString(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapAttendanceLog(log) {
  if (!log) return null;

  const att = log.attendance;

  return {
    id: log.id,
    attendance_id: log.attendanceId,
    organization_id: att ? att.organizationId : '',
    employee_id: att ? att.employeeId : '',
    date: att ? toDateString(att.date) : '',
    type: log.type,
    ip_address: log.ipAddress ?? '',
    source: log.source ?? '',
    geo_location: log.geoLocation ? JSON.stringify(log.geoLocation) : '',
    created_at: log.createdAt ? log.createdAt.toISOString() : '',
  };
}

const impl = {
  ListAttendanceLogs: async (call, callback) => {
    try {
      const { organization_id, employee_id, attendance_id, date } = call.request;

      const whereLogs = { deletedAt: null };
      if (attendance_id) whereLogs.attendanceId = attendance_id;

      const logs = await prisma.attendanceLogs.findMany({
        where: whereLogs,
        include: { attendance: true },
        orderBy: { createdAt: 'asc' },
      });

      const filtered = logs.filter((log) => {
        const att = log.attendance;
        if (!att) return false;

        if (organization_id && String(att.organizationId) !== String(organization_id)) return false;
        if (employee_id && String(att.employeeId) !== String(employee_id)) return false;

        if (date) {
          const attDate = toDateString(att.date);
          if (attDate !== date) return false;
        }

        return true;
      });

      callback(null, { logs: filtered.map(mapAttendanceLog) });
    } catch (e) {
      console.error('[ListAttendanceLogs Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },
};

async function main() {
  const server = new grpc.Server();

  server.addService(attendanceLogProto.AttendanceLogService.service, impl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve()),
    );
  });

  console.log(`[attendance-log-service] gRPC running on :${PORT}`);

  const shutdown = async (signal) => {
    console.log(`\n[attendance-log-service] Received ${signal}, shutting down gracefully...`);

    try {
      server.tryShutdown((err) => {
        if (err) {
          console.error('[attendance-log-service] Force closing due to error:', err);
          server.forceShutdown();
        } else {
          console.log('[attendance-log-service] gRPC server stopped.');
        }
      });

      await prisma.$disconnect();
      console.log('[attendance-log-service] Prisma disconnected.');
      process.exit(0);
    } catch (e) {
      console.error('[attendance-log-service] Error during shutdown:', e);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[attendance-log-service] Fatal error:', err);
  process.exit(1);
});
