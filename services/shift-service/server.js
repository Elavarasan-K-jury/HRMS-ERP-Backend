import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();


const PORT = Number(process.env.SHIFT_SERVICE_PORT || 5071);
const shiftProto = loadProto('shift');

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function isValidObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

// Canonical HH:mm → Date at 1970-01-01 UTC (time-of-day only; UTC encoding matches
// employee.routes hhmm/getUTCHours and existing DB rows like 1970-01-01T04:00:00.000Z)
function parseHmToDate(hm) {
  if (typeof hm !== 'string') return null;
  const m = hm.match(HHMM_RE);
  if (!m) return null;
  return new Date(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2]), 0, 0));
}

// UTC epoch time-of-day → canonical HH:mm (never local getHours — avoids +05:30 display shift)
function dateToHm(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function normalizeShiftType(value) {
  const t = String(value || 'FIXED').toUpperCase();
  return t === 'FLEXIBLE' ? 'FLEXIBLE' : 'FIXED';
}

function hasAnyApplicableDay(days) {
  if (!days || typeof days !== 'object') return false;
  return DAY_KEYS.some((k) => days[k] === true);
}

function normalizeApplicableDays(days, existing) {
  if (days && Object.keys(days).length) return days;
  if (existing) return existing;
  return {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  };
}

function resolveGrossHours(requireGrossHours, grossHours) {
  const enabled = requireGrossHours === true;
  const value = Number(grossHours);
  if (!enabled || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Effective hours = gross_hours - (break_minutes / 60).
 * Duration only — never uses start/end times or Flexible 00:00–23:59 placeholder.
 * Returns null when gross hours are not configured.
 */
function calculateEffectiveHours(grossHours, breakMinutes) {
  const gross = Number(grossHours);
  if (!Number.isFinite(gross) || gross <= 0) return null;
  const breakMin = Number(breakMinutes);
  const bm = Number.isFinite(breakMin) && breakMin > 0 ? breakMin : 0;
  return Math.round((gross - bm / 60) * 100) / 100;
}

// break_minutes must never drive effective hours negative
function assertBreakWithinGross(grossHours, breakMinutes) {
  const gross = Number(grossHours);
  const breakMin = Number(breakMinutes) || 0;
  if (Number.isFinite(gross) && gross > 0 && breakMin > gross * 60) {
    return 'Break duration cannot exceed gross hours (effective hours would be negative)';
  }
  return null;
}

function resolveMaxDuration(shiftType, maxShiftDurationHours) {
  if (shiftType !== 'FLEXIBLE') return null;
  const value = Number(maxShiftDurationHours);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

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
        shift_type,
        code,
        description,
        require_gross_hours,
        gross_hours,
        max_shift_duration_hours,
      } = call.request;

      // Required ObjectId — reject "" / malformed before Prisma
      if (!isValidObjectId(organization_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid organization_id',
        });
      }

      // Validate organization
      const org = await prisma.organizations.findFirst({ where: { id: organization_id } });
      if (!org) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Organization not found',
        });
      }

      // Prevent duplicates among ACTIVE shifts only (soft-deleted names reusable)
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

      // Validate times — canonical HH:mm; end may be < start (overnight, crosses midnight)
      const start = parseHmToDate(start_time);
      const end = parseHmToDate(end_time);
      if (!start || !end) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid start_time or end_time format (expected HH:mm)',
        });
      }

      const shiftType = normalizeShiftType(shift_type);
      const applicableDays = normalizeApplicableDays(applicable_days, null);
      if (!hasAnyApplicableDay(applicableDays)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Select at least one working day',
        });
      }

      const grossHours = resolveGrossHours(require_gross_hours, gross_hours);
      if (shiftType === 'FLEXIBLE' && !(grossHours > 0)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Flexible shifts require gross hours greater than 0',
        });
      }
      const maxDuration = resolveMaxDuration(shiftType, max_shift_duration_hours);
      if (shiftType === 'FLEXIBLE' && !(maxDuration > 0)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Flexible shifts require a maximum shift duration greater than 0',
        });
      }

      const breakError = assertBreakWithinGross(grossHours, break_minutes);
      if (breakError) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: breakError,
        });
      }

      const newShift = await prisma.shifts.create({
        data: {
          organizationId: organization_id,
          name,
          code: code || null,
          description: description || null,
          shiftType,
          startTime: start,
          endTime: end,
          breakMinutes: break_minutes ?? 0,
          applicableDays,
          weeklyOff: weekly_off ?? [],
          grossHours,
          maxShiftDurationHours: maxDuration,
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

      const shift = await prisma.shifts.findUnique({
        where: { id },
        // Normal GET: exclude soft-deleted
        // (findUnique can't combine non-unique filters — re-check deletedAt below)
      });
      if (!shift || shift.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift not found',
        });
      }

      const counts = await countEmployeesByShiftIds([shift.id], shift.organizationId);
      callback(null, { shift: mapShift(shift, counts[shift.id] ?? 0) });
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

      // Active shifts only — soft-deleted must not appear in list
      const shifts = await prisma.shifts.findMany({
        where: {
          organizationId: organization_id,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      const counts = await countEmployeesByShiftIds(
        shifts.map((s) => s.id),
        organization_id
      );
      callback(null, {
        shifts: shifts.map((s) => mapShift(s, counts[s.id] ?? 0)),
      });

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
        shift_type,
        code,
        description,
        require_gross_hours,
        gross_hours,
        max_shift_duration_hours,
      } = call.request;

      const existing = await prisma.shifts.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift not found',
        });
      }

      // organization_id is optional on update (proto string defaults to "").
      // Never write "" into Shifts.organizationId (ObjectId). Keep existing
      // unless a valid ObjectId is supplied; if supplied, enforce ownership.
      let organizationId = existing.organizationId;
      if (organization_id !== undefined && organization_id !== null && organization_id !== '') {
        if (!isValidObjectId(organization_id)) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Invalid organization_id',
          });
        }
        if (organization_id !== existing.organizationId) {
          return callback({
            code: grpc.status.PERMISSION_DENIED,
            message: 'Shift does not belong to this organization',
          });
        }
        organizationId = organization_id;
      }

      // Never wipe name with empty/omitted proto default
      const nextName = name !== undefined && name !== null && name !== '' ? name : existing.name;
      const nextShiftType =
        shift_type !== undefined && shift_type !== null && shift_type !== ''
          ? normalizeShiftType(shift_type)
          : existing.shiftType || 'FIXED';
      const nextApplicableDays = normalizeApplicableDays(applicable_days, existing.applicableDays);
      if (!hasAnyApplicableDay(nextApplicableDays)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Select at least one working day',
        });
      }

      // FE always sends require_gross_hours/gross_hours on full PUT payload.
      // Treat explicit false as "clear", true as "set".
      const nextGrossHours =
        require_gross_hours === true
          ? resolveGrossHours(true, gross_hours)
          : require_gross_hours === false
            ? null
            : existing.grossHours ?? null;
      if (nextShiftType === 'FLEXIBLE' && !(nextGrossHours > 0)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Flexible shifts require gross hours greater than 0',
        });
      }

      const nextMaxDuration =
        nextShiftType === 'FLEXIBLE'
          ? max_shift_duration_hours !== undefined && max_shift_duration_hours !== null
            ? resolveMaxDuration('FLEXIBLE', max_shift_duration_hours)
            : existing.maxShiftDurationHours ?? null
          : null;
      if (nextShiftType === 'FLEXIBLE' && !(nextMaxDuration > 0)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Flexible shifts require a maximum shift duration greater than 0',
        });
      }

      const nextBreakMinutes = break_minutes ?? existing.breakMinutes ?? 0;
      const breakError = assertBreakWithinGross(nextGrossHours, nextBreakMinutes);
      if (breakError) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: breakError,
        });
      }

      const data = {
        name: nextName,
        code: code !== undefined && code !== null ? code || null : existing.code ?? null,
        description: description !== undefined && description !== null ? description : existing.description ?? null,
        shiftType: nextShiftType,
        breakMinutes: nextBreakMinutes,
        applicableDays: nextApplicableDays,
        weeklyOff: weekly_off ?? existing.weeklyOff,
        grossHours: nextGrossHours,
        maxShiftDurationHours: nextMaxDuration,
        updatedAt: new Date(),
      };

      // Times optional on partial update — only overwrite when non-empty HH:mm
      if (start_time) {
        const start = parseHmToDate(start_time);
        if (!start) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Invalid start_time (expected HH:mm)',
          });
        }
        data.startTime = start;
      }
      if (end_time) {
        const end = parseHmToDate(end_time);
        if (!end) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Invalid end_time (expected HH:mm)',
          });
        }
        data.endTime = end;
      }

      // Only touch organizationId when we have a valid ObjectId (never "")
      if (organizationId && isValidObjectId(organizationId)) {
        data.organizationId = organizationId;
      }

      const updated = await prisma.shifts.update({
        where: { id },
        data,
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
function mapShift(shift, employeeCount = 0) {
  const shiftType = normalizeShiftType(shift.shiftType);
  const grossHours = Number(shift.grossHours);
  const maxDuration = Number(shift.maxShiftDurationHours);
  const configuredGross = Number.isFinite(grossHours) && grossHours > 0 ? grossHours : 0;
  return {
    id: shift.id,
    organization_id: shift.organizationId,
    name: shift.name,
    code: shift.code || '',
    description: shift.description || '',
    shift_type: shiftType,
    start_time: dateToHm(shift.startTime),
    end_time: dateToHm(shift.endTime),
    break_minutes: shift.breakMinutes ?? 0,
    applicable_days: shift.applicableDays ?? {},
    weekly_off: shift.weeklyOff ?? [],
    require_gross_hours: configuredGross > 0,
    gross_hours: configuredGross,
    // Derived response field (proto Shift.effective_hours = 19). Not persisted.
    // proto3 double cannot be null — 0 means "not configured" when require_gross_hours is false;
    // gateway maps to JSON null in that case.
    effective_hours: calculateEffectiveHours(configuredGross, shift.breakMinutes ?? 0) ?? 0,
    max_shift_duration_hours:
      shiftType === 'FLEXIBLE' && Number.isFinite(maxDuration) && maxDuration > 0
        ? Math.trunc(maxDuration)
        : 0,
    created_at: shift.createdAt?.toISOString() ?? '',
    updated_at: shift.updatedAt?.toISOString() ?? '',
    deleted_at: shift.deletedAt?.toISOString() ?? '',
    employee_count: employeeCount || 0,
  };
}

/**
 * Distinct current employees per shift (one query, no N+1).
 * Current = deletedAt null + validFrom covers now + validTo null/open.
 * Employee must belong to the same organization (assignment has no orgId).
 * Duplicate rows for one employee keep only the latest validFrom.
 */
async function countEmployeesByShiftIds(shiftIds, organizationId) {
  const counts = Object.create(null);
  if (!shiftIds.length) return counts;
  for (const id of shiftIds) counts[id] = 0;
  const now = new Date();
  const rows = await prisma.employeeShiftAssignment.findMany({
    where: {
      deletedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      shiftId: { in: shiftIds },
      employee: { organizationId, deletedAt: null },
    },
    select: { shiftId: true, employeeId: true, validFrom: true },
  });
  const latestByKey = new Map();
  for (const row of rows) {
    const key = `${row.shiftId}:${row.employeeId}`;
    const prev = latestByKey.get(key);
    if (!prev || row.validFrom > prev.validFrom) latestByKey.set(key, row);
  }
  for (const row of latestByKey.values()) {
    if (counts[row.shiftId] !== undefined) counts[row.shiftId]++;
  }
  return counts;
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