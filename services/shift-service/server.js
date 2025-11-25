import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();


const PORT = Number(process.env.SHIFT_SERVICE_PORT || 5071);
const shiftProto = loadProto('shift');

const impl = {
  // --------------------
  // Create Shift
  // --------------------
  CreateShift: async (call, callback) => {
    try {
      const {
        organization_id,
        name,
        start_time,
        end_time,
        break_minutes,
        applicable_days,
        weekly_off,
      } = call.request;

      // Validate organization
      const org = await prisma.organizations.findFirst({ where: { id: organization_id } });
      if (!org) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Organization not found',
        });
      }

      // Prevent duplicates
      const existing = await prisma.shifts.findFirst({
        where: {
          organizationId: organization_id,
          name,
          deletedAt: null,
        },
      });
      if (existing) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: 'Shift with this name already exists',
        });
      }

      // Validate times
      const start = new Date(start_time);
      const end = new Date(end_time);
      if (isNaN(start) || isNaN(end)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid start_time or end_time format',
        });
      }
      if (end <= start) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'End time must be after start time',
        });
      }

      const newShift = await prisma.shifts.create({
        data: {
          organizationId: organization_id,
          name,
          startTime: start,
          endTime: end,
          breakMinutes: break_minutes ?? 0,
          applicableDays:
            applicable_days && Object.keys(applicable_days).length
              ? applicable_days
              : {
                monday: true,
                tuesday: true,
                wednesday: true,
                thursday: true,
                friday: true,
                saturday: false,
                sunday: false,
              },
          weeklyOff: weekly_off ?? [],
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

      callback(null, { shift: mapShift(newShift) });
    } catch (e) {
      console.error('[CreateShift Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // --------------------
  // Get Shift
  // --------------------
  GetShift: async (call, callback) => {
    try {
      const { id } = call.request;

      const shift = await prisma.shifts.findUnique({ where: { id } });
      if (!shift || shift.deletedAt !== null) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift not found',
        });
      }

      callback(null, { shift: mapShift(shift) });
    } catch (e) {
      console.error('[GetShift Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // --------------------
  // List Shifts
  // --------------------
  ListShifts: async (call, callback) => {
    try {
      const { organization_id } = call.request;

      if (!organization_id || organization_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid organization_id",
        });
      }

      const shifts = await prisma.shifts.findMany({
        where: {
          organizationId: organization_id,
          deletedAt: null
        },
        orderBy: { createdAt: "desc" },
      });

      callback(null, { shifts: shifts.map(mapShift) });

    } catch (e) {
      console.error("[ListShifts Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  }
  ,

  // --------------------
  // Update Shift
  // --------------------
  UpdateShift: async (call, callback) => {
    try {
      const {
        id,
        organization_id,
        name,
        start_time,
        end_time,
        break_minutes,
        applicable_days,
        weekly_off,
      } = call.request;

      const existing = await prisma.shifts.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift not found',
        });
      }

      const start = new Date(start_time);
      const end = new Date(end_time);
      if (isNaN(start) || isNaN(end)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid start_time or end_time',
        });
      }

      const updated = await prisma.shifts.update({
        where: { id },
        data: {
          organizationId: organization_id,
          name,
          startTime: start,
          endTime: end,
          breakMinutes: break_minutes ?? 0,
          applicableDays:
            applicable_days && Object.keys(applicable_days).length
              ? applicable_days
              : existing.applicableDays,
          weeklyOff: weekly_off ?? existing.weeklyOff,
          updatedAt: new Date(),
        },
      });

      callback(null, { shift: mapShift(updated) });
    } catch (e) {
      console.error('[UpdateShift Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // --------------------
  // Delete Shift
  // --------------------
  DeleteShift: async (call, callback) => {
    try {
      const { id } = call.request;

      const existing = await prisma.shifts.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift not found',
        });
      }

      await prisma.shifts.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      callback(null, { success: true, message: 'Shift deleted successfully' });
    } catch (e) {
      console.error('[DeleteShift Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },
};

// --------------------
// Helper Mapper
// --------------------
function mapShift(shift) {
  return {
    id: shift.id,
    organization_id: shift.organizationId,
    name: shift.name,
    start_time: shift.startTime?.toISOString() ?? '',
    end_time: shift.endTime?.toISOString() ?? '',
    break_minutes: shift.breakMinutes ?? 0,
    applicable_days: shift.applicableDays ?? {},
    weekly_off: shift.weeklyOff ?? [],
    created_at: shift.createdAt?.toISOString() ?? '',
    updated_at: shift.updatedAt?.toISOString() ?? '',
    deleted_at: shift.deletedAt?.toISOString() ?? '',
  };
}

/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
  const server = new grpc.Server();

  server.addService(shiftProto.ShiftService.service, impl);

  // Convert bindAsync to Promise
  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve())
    );
  });

  console.log(`[shift-service] gRPC running on :${PORT}`);

  // Graceful shutdown handler
  const shutdown = async (signal) => {
    console.log(`\n[shift-service] Received ${signal}, shutting down gracefully...`);

    try {
      // 🧹 Stop accepting new gRPC calls
      server.tryShutdown((err) => {
        if (err) {
          console.error('[shift-service] Force closing due to error:', err);
          server.forceShutdown();
        } else {
          console.log('[shift-service] gRPC server stopped.');
        }
      });

      // 🧹 Disconnect Prisma cleanly
      await prisma.$disconnect();
      console.log('[shift-service] Prisma disconnected.');

      process.exit(0);
    } catch (e) {
      console.error('[shift-service] Error during shutdown:', e);
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[shift-service] Fatal error:', err);
  process.exit(1);
});