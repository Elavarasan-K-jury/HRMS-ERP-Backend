import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";

const PORT = Number(process.env.SHIFT_ASSIGNMENT_SERVICE_PORT || 5064);
const shiftAssignmentProto = loadProto("shift_assignment");

/**
 * Helper: parse ISO date safely
 */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/**
 * Helper: add N days to a Date
 */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 🔹 Map Prisma Employee + Designation → gRPC EmployeeSummary
 */
function mapEmployee(employee) {
  if (!employee) return null;

  return {
    id: employee.id,
    full_name: employee.fullName,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    gender: employee.gender ?? "",
    designation_id: employee.designation ? employee.designation.id : "",
    designation_name: employee.designation ? employee.designation.name : "",
    designation_level: employee.designation
      ? employee.designation.level ?? ""
      : "",
  };
}

/**
 * 🔹 Map Prisma Shift → gRPC ShiftSummary
 */
function mapShift(shift) {
  if (!shift) return null;

  return {
    id: shift.id,
    name: shift.name,
    start_time: shift.startTime?.toISOString() ?? "",
    end_time: shift.endTime?.toISOString() ?? "",
    break_minutes: shift.breakMinutes ?? 0,
  };
}

/**
 * 🔹 Map Prisma EmployeeShiftAssignment (+ includes) → gRPC ShiftAssignment
 */
function mapAssignmentWithDetails(a) {
  if (!a) return null;

  const assignmentCore = {
    id: a.id,
    employee_id: a.employeeId,
    shift_id: a.shiftId,
    valid_from: a.validFrom ? a.validFrom.toISOString() : "",
    valid_to: a.validTo ? a.validTo.toISOString() : "",
    created_at: a.createdAt ? a.createdAt.toISOString() : "",
    updated_at: a.updatedAt ? a.updatedAt.toISOString() : "",
    deleted_at: a.deletedAt ? a.deletedAt.toISOString() : "",
  };

  return {
    ...assignmentCore,
    employee: mapEmployee(a.employee),
    shift: mapShift(a.shift),
  };
}

/**
 * Helper: checks for overlapping assignments for an employee.
 * Rules:
 *  - For a given employee, only one shift assignment can be active for any date range.
 *  - We check overlaps against [validFrom, validTo] range.
 */
async function hasOverlap({ employeeId, from, to, excludeId = null }) {
  // treat null "to" as far future
  const rangeEnd = to ?? new Date("9999-12-31T23:59:59.999Z");

  const overlapping = await prisma.employeeShiftAssignment.findFirst({
    where: {
      employeeId,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      AND: [
        { validFrom: { lte: rangeEnd } },
        {
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
      ],
    },
  });

  return !!overlapping;
}

const impl = {
  // ======================================
  // AssignShift (Create)
  // ======================================
  AssignShift: async (call, callback) => {
    try {
      const { employee_id, shift_id, valid_from, valid_to } = call.request;

      // Validate IDs
      if (!employee_id || !shift_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_id and shift_id are required",
        });
      }
      if (employee_id.length !== 24 || shift_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_id and shift_id must be 24-char ObjectId strings",
        });
      }

      // Validate employee
      const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employee_id },
      });
      if (!employee || employee.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Employee not found",
        });
      }

      // Validate shift
      const shift = await prisma.shifts.findUnique({
        where: { id: shift_id },
      });
      if (!shift || shift.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift not found",
        });
      }

      // Ensure shift and employee belong to same organization
      if (String(employee.organizationId) !== String(shift.organizationId)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Employee and Shift belong to different organizations",
        });
      }

      // -----------------------
      // Parse valid_from / valid_to
      // -----------------------
      let from = null;
      if (valid_from) {
        from = parseDate(valid_from);
        if (!from) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_from is invalid datetime",
          });
        }
      } else {
        // if not provided, default to "now"
        from = new Date();
      }

      let to = null;
      if (valid_to) {
        to = parseDate(valid_to);
        if (!to) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_to is invalid datetime",
          });
        }
      }

      // -----------------------------------
      // 🔗 Make it dynamic using ShiftPolicy (Keka-style)
      // -----------------------------------
      //
      // If client did NOT send valid_to, we will:
      //  - Look up organization's active auto-assign ShiftPolicy
      //  - If rotational + rotationPeriod > 0 → set valid_to = from + rotationPeriod days
      //  - Else → open-ended (valid_to = null)
      //
      if (!to) {
        const policy = await prisma.shiftPolicies.findFirst({
          where: {
            organizationId: employee.organizationId,
            isActive: true,
            autoAssign: true,
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
        });

        if (
          policy &&
          policy.rotational &&
          policy.rotationPeriod &&
          policy.rotationPeriod > 0
        ) {
          to = addDays(from, policy.rotationPeriod);
          console.log(
            `[AssignShift] Using rotational policy ${policy.id}, rotationPeriod=${policy.rotationPeriod}, valid_to=${to.toISOString()}`
          );
        } else {
          // non-rotational or no policy → open-ended
          to = null;
        }
      }

      // validate order
      if (to && to < from) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "valid_to must be after valid_from",
        });
      }

      // Check overlap with existing assignments
      const overlap = await hasOverlap({
        employeeId: employee_id,
        from,
        to,
      });

      if (overlap) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message:
            "Employee already has a shift assignment overlapping this period",
        });
      }

      const now = new Date();

      const assignment = await prisma.employeeShiftAssignment.create({
        data: {
          employeeId: employee_id,
          shiftId: shift_id,
          validFrom: from,
          validTo: to ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        include: {
          employee: {
            include: { designation: true },
          },
          shift: true,
        },
      });

      console.log("[AssignShift] created:", assignment.id);

      callback(null, {
        assignment: mapAssignmentWithDetails(assignment),
      });
    } catch (e) {
      console.error("[AssignShift Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // GetShiftAssignment
  // ======================================
  GetShiftAssignment: async (call, callback) => {
    try {
      const { id } = call.request;

      if (!id || id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid assignment id",
        });
      }

      const assignment = await prisma.employeeShiftAssignment.findUnique({
        where: { id },
        include: {
          employee: {
            include: { designation: true },
          },
          shift: true,
        },
      });

      if (!assignment || assignment.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift assignment not found",
        });
      }

      callback(null, { assignment: mapAssignmentWithDetails(assignment) });
    } catch (e) {
      console.error("[GetShiftAssignment Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // ListShiftAssignments
  // ======================================
  ListShiftAssignments: async (call, callback) => {
    try {
      const { employee_id, shift_id, active_only } = call.request;

      const where = {
        deletedAt: null,
      };

      if (employee_id) where.employeeId = employee_id;
      if (shift_id) where.shiftId = shift_id;

      // If active_only, filter by current date within [validFrom, validTo/null]
      if (active_only) {
        const now = new Date();
        where.validFrom = { lte: now };
        where.OR = [{ validTo: null }, { validTo: { gte: now } }];
      }

      const assignments = await prisma.employeeShiftAssignment.findMany({
        where,
        include: {
          employee: {
            include: {
              designation: true,
            },
          },
          shift: true,
        },
        orderBy: { validFrom: "desc" },
      });

      console.log(
        "[ListShiftAssignments] found:",
        assignments.map((a) => a.id)
      );

      callback(null, {
        assignments: assignments.map(mapAssignmentWithDetails),
      });
    } catch (e) {
      console.error("[ListShiftAssignments Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // UpdateShiftAssignment
  // ======================================
  UpdateShiftAssignment: async (call, callback) => {
    try {
      const { id, valid_from, valid_to } = call.request;

      if (!id || id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid assignment id",
        });
      }

      const existing = await prisma.employeeShiftAssignment.findUnique({
        where: { id },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift assignment not found",
        });
      }

      // If no changes provided, just return existing (with includes)
      if (!valid_from && !valid_to) {
        const withIncludes = await prisma.employeeShiftAssignment.findUnique({
          where: { id },
          include: {
            employee: { include: { designation: true } },
            shift: true,
          },
        });

        return callback(null, {
          assignment: mapAssignmentWithDetails(withIncludes),
        });
      }

      let newFrom = existing.validFrom;
      let newTo = existing.validTo;

      if (valid_from) {
        const f = parseDate(valid_from);
        if (!f) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_from is invalid datetime",
          });
        }
        newFrom = f;
      }

      if (valid_to) {
        const t = parseDate(valid_to);
        if (!t) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_to is invalid datetime",
          });
        }
        newTo = t;
      }

      if (newTo && newTo < newFrom) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "valid_to must be after valid_from",
        });
      }

      // Check overlap against other assignments for same employee
      const overlap = await hasOverlap({
        employeeId: existing.employeeId,
        from: newFrom,
        to: newTo,
        excludeId: existing.id,
      });

      if (overlap) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message:
            "Updated range overlaps with another assignment for this employee",
        });
      }

      const updated = await prisma.employeeShiftAssignment.update({
        where: { id },
        data: {
          validFrom: newFrom,
          validTo: newTo ?? null,
          updatedAt: new Date(),
        },
        include: {
          employee: { include: { designation: true } },
          shift: true },
      });

      callback(null, {
        assignment: mapAssignmentWithDetails(updated),
      });
    } catch (e) {
      console.error("[UpdateShiftAssignment Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // DeleteShiftAssignment (Soft delete)
  // ======================================
  DeleteShiftAssignment: async (call, callback) => {
    try {
      const { id } = call.request;

      if (!id || id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid assignment id",
        });
      }

      const existing = await prisma.employeeShiftAssignment.findUnique({
        where: { id },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift assignment not found",
        });
      }

      await prisma.employeeShiftAssignment.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      callback(null, {
        success: true,
        message: "Shift assignment soft-deleted successfully",
      });
    } catch (e) {
      console.error("[DeleteShiftAssignment Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },
};

/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
  const server = new grpc.Server();

  server.addService(shiftAssignmentProto.ShiftAssignmentService.service, impl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve())
    );
  });

  console.log(`[shift-assignment-service] gRPC running on :${PORT}`);

  const shutdown = async (signal) => {
    console.log(
      `\n[shift-assignment-service] Received ${signal}, shutting down gracefully...`
    );

    try {
      server.tryShutdown((err) => {
        if (err) {
          console.error(
            "[shift-assignment-service] Force closing due to error:",
            err
          );
          server.forceShutdown();
        } else {
          console.log("[shift-assignment-service] gRPC server stopped.");
        }
      });

      await prisma.$disconnect();
      console.log("[shift-assignment-service] Prisma disconnected.");

      process.exit(0);
    } catch (e) {
      console.error("[shift-assignment-service] Error during shutdown:", e);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[shift-assignment-service] Fatal error:", err);
  process.exit(1);
});
