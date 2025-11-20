import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = Number(process.env.SHIFT_POLICY_SERVICE_PORT || 5065);
const shiftPolicyProto = loadProto('shift_policy');

// Simple validator for "HH:mm" 24-hour time
const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Maps Prisma ShiftPolicies model to gRPC ShiftPolicy message
 */
function mapShiftPolicy(policy) {
  if (!policy) return null;

  return {
    id: policy.id,
    organization_id: policy.organizationId,
    name: policy.name,
    auto_assign: policy.autoAssign ?? false,
    grace_before_start: policy.graceBeforeStart ?? 0,
    grace_after_end: policy.graceAfterEnd ?? 0,
    night_shift_start: policy.nightShiftStart ?? '',
    night_shift_end: policy.nightShiftEnd ?? '',
    rotational: policy.rotational ?? false,
    rotation_period: policy.rotationPeriod ?? 0,
    is_active: policy.isActive ?? true,
    created_at: policy.createdAt?.toISOString() ?? '',
    updated_at: policy.updatedAt?.toISOString() ?? '',
    deleted_at: policy.deletedAt?.toISOString() ?? '',
  };
}


async function ensureSingleAutoAssignPolicy({ organizationId, excludeId }) {
  const existing = await prisma.shiftPolicies.findFirst({
    where: {
      organizationId,
      autoAssign: true,
      isActive: true,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });

  if (existing) {
    const err = {
      code: grpc.status.ALREADY_EXISTS,
      message:
        'Another active auto-assign policy already exists for this organization. Disable it or set autoAssign=false before enabling this one.',
    };
    throw err;
  }
}

/**
 * Validates fields like nightShiftStart/End and rotationPeriod.
 */
function validateShiftPolicyInput({
  nightShiftStart,
  nightShiftEnd,
  rotational,
  rotationPeriod,
}) {
  if (nightShiftStart && !HH_MM_REGEX.test(nightShiftStart)) {
    throw {
      code: grpc.status.INVALID_ARGUMENT,
      message: 'night_shift_start must be in HH:mm 24-hour format (e.g. "22:00")',
    };
  }

  if (nightShiftEnd && !HH_MM_REGEX.test(nightShiftEnd)) {
    throw {
      code: grpc.status.INVALID_ARGUMENT,
      message: 'night_shift_end must be in HH:mm 24-hour format (e.g. "06:00")',
    };
  }

  if (rotational && (!rotationPeriod || rotationPeriod <= 0)) {
    throw {
      code: grpc.status.INVALID_ARGUMENT,
      message: 'rotation_period must be a positive integer when rotational=true',
    };
  }
}

const impl = {
  // ----------------------------------------------------
  // CreateShiftPolicy
  // ----------------------------------------------------
  //
  // Steps:
  // 1. Validate organization exists and is not deleted
  // 2. Validate HH:mm time strings and rotation rules
  // 3. Enforce only one active+autoAssign policy per org
  // 4. Create policy in DB
  // 5. Return mapped policy
  //
  CreateShiftPolicy: async (call, callback) => {
    try {
      const {
        organization_id,
        name,
        auto_assign = false,
        grace_before_start,
        grace_after_end,
        night_shift_start,
        night_shift_end,
        rotational = false,
        rotation_period,
        is_active = true,
      } = call.request;

      // 1. Validate organization
      const org = await prisma.organizations.findFirst({
        where: { id: organization_id, deletedAt: null },
      });

      if (!org) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Organization not found',
        });
      }

      // 2. Validate time fields and rotational logic
      validateShiftPolicyInput({
        nightShiftStart: night_shift_start,
        nightShiftEnd: night_shift_end,
        rotational,
        rotationPeriod: rotation_period,
      });

      // 3. Enforce single auto-assign policy if required
      if (auto_assign && is_active) {
        await ensureSingleAutoAssignPolicy({
          organizationId: organization_id,
        });
      }

      // Optional: unique name per org
      const dupName = await prisma.shiftPolicies.findFirst({
        where: {
          organizationId: organization_id,
          name,
          deletedAt: null,
        },
      });

      if (dupName) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: 'Shift policy with this name already exists in the organization',
        });
      }

      // 4. Create policy
      const now = new Date();
      const policy = await prisma.shiftPolicies.create({
        data: {
          organizationId: organization_id,
          name,
          autoAssign: auto_assign,
          graceBeforeStart: grace_before_start ?? 10,
          graceAfterEnd: grace_after_end ?? 10,
          nightShiftStart: night_shift_start ?? null,
          nightShiftEnd: night_shift_end ?? null,
          rotational,
          rotationPeriod: rotational ? rotation_period ?? 7 : null,
          isActive: is_active,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      });

      callback(null, { policy: mapShiftPolicy(policy) });
    } catch (e) {
      console.error('[CreateShiftPolicy Error]', e);
      if (e.code && e.message) return callback(e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },

  // ----------------------------------------------------
  // GetShiftPolicy
  // ----------------------------------------------------
  //
  // Simple fetch by ID, ensuring not soft-deleted.
  //
  GetShiftPolicy: async (call, callback) => {
    try {
      const { id } = call.request;

      const policy = await prisma.shiftPolicies.findUnique({ where: { id } });

      if (!policy || policy.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift policy not found',
        });
      }

      callback(null, { policy: mapShiftPolicy(policy) });
    } catch (e) {
      console.error('[GetShiftPolicy Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },

  // ----------------------------------------------------
  // ListShiftPolicies
  // ----------------------------------------------------
  //
  // Returns all policies for an organization.
  // If only_active=true → filters to isActive=true and not deleted.
  //
  ListShiftPolicies: async (call, callback) => {
    try {
      const { organization_id, only_active = false } = call.request;

      const where = {
        organizationId: organization_id,
        deletedAt: null,
        ...(only_active ? { isActive: true } : {}),
      };

      const policies = await prisma.shiftPolicies.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      callback(null, { policies: policies.map(mapShiftPolicy) });
    } catch (e) {
      console.error('[ListShiftPolicies Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },

  // ----------------------------------------------------
  // UpdateShiftPolicy
  // ----------------------------------------------------
  //
  // Steps:
  // 1. Fetch existing policy
  // 2. Merge incoming fields
  // 3. Validate time / rotation rules
  // 4. Enforce single auto-assign if auto_assign+is_active true
  // 5. Update in DB & return
  //
  UpdateShiftPolicy: async (call, callback) => {
    try {
      const {
        id,
        organization_id,
        name,
        auto_assign,
        grace_before_start,
        grace_after_end,
        night_shift_start,
        night_shift_end,
        rotational,
        rotation_period,
        is_active,
      } = call.request;

      const existing = await prisma.shiftPolicies.findUnique({ where: { id } });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift policy not found',
        });
      }

      // Build merged view (what the policy will look like after update)
      const merged = {
        organizationId: organization_id || existing.organizationId,
        name: name ?? existing.name,
        autoAssign: typeof auto_assign === 'boolean' ? auto_assign : existing.autoAssign,
        graceBeforeStart:
          typeof grace_before_start === 'number'
            ? grace_before_start
            : existing.graceBeforeStart,
        graceAfterEnd:
          typeof grace_after_end === 'number' ? grace_after_end : existing.graceAfterEnd,
        nightShiftStart: night_shift_start ?? existing.nightShiftStart,
        nightShiftEnd: night_shift_end ?? existing.nightShiftEnd,
        rotational: typeof rotational === 'boolean' ? rotational : existing.rotational,
        rotationPeriod:
          typeof rotation_period === 'number'
            ? rotation_period
            : existing.rotationPeriod,
        isActive: typeof is_active === 'boolean' ? is_active : existing.isActive,
      };

      // Validate night shift times + rotation rules
      validateShiftPolicyInput({
        nightShiftStart: merged.nightShiftStart,
        nightShiftEnd: merged.nightShiftEnd,
        rotational: merged.rotational,
        rotationPeriod: merged.rotationPeriod,
      });

      // Enforce single auto-assign & active
      if (merged.autoAssign && merged.isActive) {
        await ensureSingleAutoAssignPolicy({
          organizationId: merged.organizationId,
          excludeId: id,
        });
      }

      // Update DB
      const updated = await prisma.shiftPolicies.update({
        where: { id },
        data: {
          organizationId: merged.organizationId,
          name: merged.name,
          autoAssign: merged.autoAssign,
          graceBeforeStart: merged.graceBeforeStart,
          graceAfterEnd: merged.graceAfterEnd,
          nightShiftStart: merged.nightShiftStart,
          nightShiftEnd: merged.nightShiftEnd,
          rotational: merged.rotational,
          rotationPeriod: merged.rotationPeriod,
          isActive: merged.isActive,
          updatedAt: new Date(),
        },
      });

      callback(null, { policy: mapShiftPolicy(updated) });
    } catch (e) {
      console.error('[UpdateShiftPolicy Error]', e);
      if (e.code && e.message) return callback(e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },

  // ----------------------------------------------------
  // DeleteShiftPolicy (soft delete)
  // ----------------------------------------------------
  //
  // We don't remove the record.
  // We mark:
  //   deletedAt = now
  //   isActive = false
  //   autoAssign = false
  //
  DeleteShiftPolicy: async (call, callback) => {
    try {
      const { id } = call.request;

      const existing = await prisma.shiftPolicies.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Shift policy not found',
        });
      }

      await prisma.shiftPolicies.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          autoAssign: false,
          updatedAt: new Date(),
        },
      });

      callback(null, {
        success: true,
        message: 'Shift policy deleted successfully',
      });
    } catch (e) {
      console.error('[DeleteShiftPolicy Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || 'Internal server error',
      });
    }
  },
};

/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
  const server = new grpc.Server();

  server.addService(shiftPolicyProto.ShiftPolicyService.service, impl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve()),
    );
  });

  console.log(`[shift-policy-service] gRPC running on :${PORT}`);

  const shutdown = async (signal) => {
    console.log(`\n[shift-policy-service] Received ${signal}, shutting down gracefully...`);

    try {
      server.tryShutdown((err) => {
        if (err) {
          console.error('[shift-policy-service] Force closing due to error:', err);
          server.forceShutdown();
        } else {
          console.log('[shift-policy-service] gRPC server stopped.');
        }
      });

      await prisma.$disconnect();
      console.log('[shift-policy-service] Prisma disconnected.');

      process.exit(0);
    } catch (e) {
      console.error('[shift-policy-service] Error during shutdown:', e);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[shift-policy-service] Fatal error:', err);
  process.exit(1);
});
