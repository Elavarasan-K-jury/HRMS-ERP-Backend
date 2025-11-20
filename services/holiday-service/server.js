import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.HOLIDAY_SERVICE_PORT || 50062);
const holidayProto = loadProto('holiday');

// --------------------
// Helpers
// --------------------
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

function parseAndNormalizeDateOnly(isoString) {
  // Accepts 'YYYY-MM-DD' or full ISO, normalizes to UTC date-only
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  // Normalize to UTC start of day
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  return utc;
}

function toYYYYMMDD(date) {
  if (!date) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Optional: Enforce region against active HolidayPolicies if present
async function assertRegionAllowedByPolicy(orgId, region) {
  if (!region) return; // no region filter to enforce
  const activePolicies = await prisma.holidayPolicies.findMany({
    where: { organizationId: orgId, isActive: true, deletedAt: null },
    select: { region: true },
  });
  if (activePolicies.length === 0) return; // nothing to enforce

  const allowed = activePolicies.some((p) => p.region === region);
  if (!allowed) {
    const list = activePolicies.map((p) => p.region).join(', ');
    const msg = list
      ? `Region "${region}" not allowed by active holiday policies. Allowed: ${list}`
      : `Region "${region}" not allowed by active holiday policies.`;
    const err = {
      code: grpc.status.PERMISSION_DENIED,
      message: msg,
    };
    throw err;
  }
}

async function ensureOrganization(orgId) {
  if (!isValidObjectId(orgId)) {
    const err = { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id' };
    throw err;
  }
  const org = await prisma.organizations.findUnique({ where: { id: orgId, deletedAt: null } });
  if (!org) {
    const err = { code: grpc.status.NOT_FOUND, message: 'Organization not found' };
    throw err;
  }
  return org;
}

async function ensureHolidayExists(id) {
  if (!isValidObjectId(id)) {
    const err = { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid holiday id' };
    throw err;
  }
  const holiday = await prisma.holidays.findUnique({
    where: { id },
    include: { organization: true },
  });
  if (!holiday || holiday.deletedAt) {
    const err = { code: grpc.status.NOT_FOUND, message: 'Holiday not found' };
    throw err;
  }
  return holiday;
}

async function assertNoDuplicateHoliday({ organizationId, date, region, excludeId }) {
  const dup = await prisma.holidays.findFirst({
    where: {
      organizationId,
      date,
      region: region || null,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    const err = {
      code: grpc.status.ALREADY_EXISTS,
      message: 'Holiday already exists for this date and region',
    };
    throw err;
  }
}

function mapHoliday(holiday) {
  return {
    id: holiday.id,
    organization_id: holiday.organizationId,
    organization_name: holiday.organization ? holiday.organization.name : '',
    name: holiday.name,
    date: holiday.date ? toYYYYMMDD(holiday.date) : '',
    region: holiday.region ?? '',
  };
}

// --------------------
// gRPC Implementation
// --------------------
const impl = {
  // Create
  CreateHoliday: async (call, callback) => {
    try {
      const { organization_id, name, date, region } = call.request;

      await ensureOrganization(organization_id);

      const normalized = parseAndNormalizeDateOnly(date);
      if (!normalized) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid date format. Expect YYYY-MM-DD or ISO date.',
        });
      }

      await assertRegionAllowedByPolicy(organization_id, region);
      await assertNoDuplicateHoliday({ organizationId: organization_id, date: normalized, region });

      const holiday = await prisma.holidays.create({
        data: {
          organizationId: organization_id,
          name,
          date: normalized,
          region: region || null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        include: { organization: true },
      });

      return callback(null, { holiday: mapHoliday(holiday) });
    } catch (e) {
      console.error('[CreateHoliday Error]', e);
      return callback(e.code ? e : { code: grpc.status.INTERNAL, message: e.message || 'Internal error' });
    }
  },

  // Get by ID
  GetHoliday: async (call, callback) => {
    try {
      const { id } = call.request;
      const holiday = await ensureHolidayExists(id);
      return callback(null, { holiday: mapHoliday(holiday) });
    } catch (e) {
      console.error('[GetHoliday Error]', e);
      return callback(e.code ? e : { code: grpc.status.INTERNAL, message: e.message || 'Internal error' });
    }
  },

  // List
  ListHolidays: async (call, callback) => {
    try {
      const { organization_id, region } = call.request;

      if (!isValidObjectId(organization_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid organization_id',
        });
      }

      const whereClause = {
        organizationId: organization_id,
        deletedAt: null,
        ...(region && region.trim() !== '' ? { region } : {}),
      };

      const holidays = await prisma.holidays.findMany({
        where: whereClause,
        include: { organization: true },
        orderBy: [{ date: 'asc' }, { name: 'asc' }],
      });

      return callback(null, { holidays: holidays.map(mapHoliday) });
    } catch (e) {
      console.error('[ListHolidays Error]', e);
      return callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal error' });
    }
  },

  // Update
  UpdateHoliday: async (call, callback) => {
    try {
      const { id, organization_id, name, date, region } = call.request;

      const existing = await ensureHolidayExists(id);

      if (!isValidObjectId(organization_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid organization_id',
        });
      }
      await ensureOrganization(organization_id);

      const normalized = parseAndNormalizeDateOnly(date);
      if (!normalized) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid date format. Expect YYYY-MM-DD or ISO date.',
        });
      }

      await assertRegionAllowedByPolicy(organization_id, region);
      await assertNoDuplicateHoliday({
        organizationId: organization_id,
        date: normalized,
        region,
        excludeId: id,
      });

      const updated = await prisma.holidays.update({
        where: { id: existing.id },
        data: {
          organizationId: organization_id,
          name,
          date: normalized,
          region: region || null,
          updatedAt: new Date(),
        },
        include: { organization: true },
      });

      return callback(null, { holiday: mapHoliday(updated) });
    } catch (e) {
      console.error('[UpdateHoliday Error]', e);
      return callback(e.code ? e : { code: grpc.status.INTERNAL, message: e.message || 'Internal error' });
    }
  },

  // Delete (soft delete)
  DeleteHoliday: async (call, callback) => {
    try {
      const { id } = call.request;
      const existing = await ensureHolidayExists(id);

      await prisma.holidays.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
      });

      return callback(null, { success: true, message: 'Holiday deleted successfully' });
    } catch (e) {
      console.error('[DeleteHoliday Error]', e);
      return callback(e.code ? e : { code: grpc.status.INTERNAL, message: e.message || 'Internal error' });
    }
  },
};

// --------------------
// Start + Graceful Shutdown
// --------------------
async function main() {
  const server = new grpc.Server();
  server.addService(holidayProto.HolidayService.service, impl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve())
    );
  });

  // server.start();
  console.log(`[holiday-service] gRPC running on :${PORT}`);

  const shutdown = (signal) => {
    console.log(`[holiday-service] Received ${signal}, shutting down...`);
    server.tryShutdown(async (err) => {
      if (err) {
        console.error('[holiday-service] tryShutdown error, forcing shutdown:', err);
        server.forceShutdown();
      }
      try {
        await prisma.$disconnect();
      } catch (e) {
        console.error('[holiday-service] Prisma disconnect error:', e);
      } finally {
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('[holiday-service] Fatal error:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
