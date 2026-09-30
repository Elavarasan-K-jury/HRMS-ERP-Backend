import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.SHIFT_ASSIGNMENT_SERVICE_PORT || 5072);
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
 * Phase 2: date-only (business date) helpers.
 * Dates are stored as UTC midnight (YYYY-MM-DD contract).
 */
const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD parse + calendar roundtrip. Returns UTC midnight Date or null. */
function parseBusinessDate(value) {
  if (!value || !BUSINESS_DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null; // e.g. 2026-02-30
  }
  return dt;
}

/** Canonical YYYY-MM-DD key for a Date (UTC components). */
function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

/** Add N days in UTC (date arithmetic, immune to DST). */
function addUtcDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Today's business date in the server's local calendar (YYYY-MM-DD). */
function todayBusinessKey() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
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
 * start_time / end_time are TIME-OF-DAY only — canonical HH:mm (UTC components of the
 * 1970-01-01 epoch Date), never a full ISO timestamp (avoids +TZ display conversion).
 */
function mapShift(shift) {
  if (!shift) return null;

  const hm = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };

  return {
    id: shift.id,
    name: shift.name,
    start_time: hm(shift.startTime),
    end_time: hm(shift.endTime),
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
async function hasOverlap({ employeeId, from, to, excludeId = null, db = prisma }) {
  // treat null "to" as far future
  const rangeEnd = to ?? new Date("9999-12-31T23:59:59.999Z");

  const overlapping = await db.employeeShiftAssignment.findFirst({
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

/**
 * Clear attendance adjustments in a date range for an employee.
 * - Resets REGULARISED attendance records back to PENDING
 * - Soft-deletes approved AttendanceRegularisation records
 * Called when a new shift/weekly-off assignment is created or updated
 * within a date range that may contain prior adjustments.
 */
async function clearAttendanceAdjustments(employeeId, from, to, db = prisma) {
  const rangeStart = from;
  const rangeEnd = to || new Date("9999-12-31T23:59:59.999Z");

  // 1. Reset REGULARISED attendance records back to PENDING and clear adjusted times
  const resetResult = await db.attendance.updateMany({
    where: {
      employeeId,
      date: { gte: rangeStart, lte: rangeEnd },
      status: "REGULARISED",
    },
    data: { status: "PENDING", checkIn: null, checkOut: null },
  });

  // 2. Soft-delete approved AttendanceRegularisation records in range
  const deleteResult = await db.attendanceRegularisation.updateMany({
    where: {
      employeeId,
      date: { gte: rangeStart, lte: rangeEnd },
      status: "APPROVED",
    },
    data: { deletedAt: new Date() },
  });

  if (resetResult.count > 0 || deleteResult.count > 0) {
    console.log(
      `[clearAttendanceAdjustments] employee=${employeeId}, range=${rangeStart.toISOString()}..${rangeEnd.toISOString()}, reset=${resetResult.count}, deleted_regs=${deleteResult.count}`
    );
  }

  return { resetCount: resetResult.count, deletedRegCount: deleteResult.count };
}

const impl = {
  // ======================================
  // AssignShift (Create)
  // ======================================
  AssignShift: async (call, callback) => {
    try {
      const { employee_id, shift_id, valid_from, valid_to, organization_id } = call.request;

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

      // Organization isolation: when org context is provided, employee must belong to it
      if (organization_id && String(employee.organizationId) !== organization_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Employee does not belong to the organization",
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
          where: { deletedAt: null,
            organizationId: employee.organizationId,
            isActive: true,
            autoAssign: true,
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

      // Clear any attendance adjustments in the new assignment's date range
      await clearAttendanceAdjustments(employee_id, from, to);

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
      const { employee_id, shift_id, active_only, organization_id } = call.request;

      const where = {
        deletedAt: null,
      };

      if (employee_id) where.employeeId = employee_id;
      if (shift_id) where.shiftId = shift_id;
      if (organization_id) where.employee = { organizationId: organization_id };

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
      const { id, valid_from, valid_to, clear_valid_to, organization_id } = call.request;

      if (!id || id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid assignment id",
        });
      }

      const existing = await prisma.employeeShiftAssignment.findUnique({
        where: { id },
        include: { employee: true },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift assignment not found",
        });
      }

      // Organization isolation: assignment's employee must belong to the provided org
      if (
        organization_id &&
        (!existing.employee || String(existing.employee.organizationId) !== organization_id)
      ) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Shift assignment does not belong to the organization",
        });
      }

      // If no changes provided, just return existing (with includes)
      if (!valid_from && !valid_to && !clear_valid_to) {
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

      // Phase 2.4: explicit "open the end date" request (clear_valid_to) — validTo = NULL
      if (clear_valid_to) {
        newTo = null;
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
          shift: true
        },
      });

      // Clear any attendance adjustments in the updated date range
      await clearAttendanceAdjustments(existing.employeeId, newFrom, newTo);

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
      const { id, organization_id } = call.request;

      if (!id || id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid assignment id",
        });
      }

      const existing = await prisma.employeeShiftAssignment.findUnique({
        where: { id },
        include: { employee: true },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Shift assignment not found",
        });
      }

      // Organization isolation: assignment's employee must belong to the provided org
      if (
        organization_id &&
        (!existing.employee || String(existing.employee.organizationId) !== organization_id)
      ) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Shift assignment does not belong to the organization",
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

  // ======================================
  // MoveShift (Phase 2, atomic multi-employee)
  // ======================================
  // Moves one or more employees to a destination shift effective from a business date.
  // Semantics per employee:
  //   covering(D) = latest assignment where validFrom < D+1 AND (validTo null OR validTo >= D)
  //   covering closes at D-1; new row [D, covering.validTo] with destination shift.
  // All-or-nothing: full validation first, then one interactive transaction for everyone.
  // Rejects: past/invalid dates, missing covering, covering starting on D, same-shift,
  //          covering starting after today (future plan) and any other assignment touching [D, ∞).
  MoveShift: async (call, callback) => {
    try {
      const { organization_id, employee_ids, destination_shift_id, effective_from } = call.request;

      if (!organization_id || organization_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "organization_id is required",
        });
      }
      if (!destination_shift_id || destination_shift_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "destination_shift_id is required",
        });
      }
      const ids = [...new Set((employee_ids || []).filter((v) => !!v))];
      if (ids.length === 0) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_ids must not be empty",
        });
      }
      if (ids.some((id) => id.length !== 24)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_ids must be 24-char ObjectId strings",
        });
      }

      const effDate = parseBusinessDate(effective_from);
      if (!effDate) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from must be a valid YYYY-MM-DD business date",
        });
      }
      const effKey = utcDateKey(effDate);
      const todayKey = todayBusinessKey();
      if (effKey < todayKey) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from cannot be in the past",
        });
      }

      // Destination shift: exists, not deleted, same organization
      const destShift = await prisma.shifts.findUnique({ where: { id: destination_shift_id } });
      if (!destShift || destShift.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Destination shift not found",
        });
      }
      if (String(destShift.organizationId) !== organization_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Destination shift does not belong to the organization",
        });
      }

      // Employees: exist, not deleted, same organization
      const employees = await prisma.organizationEmployees.findMany({
        where: { id: { in: ids } },
      });
      const byId = new Map(employees.map((e) => [e.id, e]));
      const missing = ids.filter((id) => !byId.get(id) || byId.get(id).deletedAt);
      if (missing.length > 0) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Employee not found: ${missing.join(", ")}`,
        });
      }
      const foreign = employees
        .filter((e) => String(e.organizationId) !== organization_id)
        .map((e) => e.id);
      if (foreign.length > 0) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: `Employee does not belong to the organization: ${foreign.join(", ")}`,
        });
      }

      const dayStart = effDate;
      const dayEnd = addUtcDays(effDate, 1);
      const closeAt = addUtcDays(effDate, -1);

      // ---- Validation phase (no writes): resolve covering + conflicts for everyone ----
      const plan = [];
      const errors = [];
      for (const id of ids) {
        const covering = await prisma.employeeShiftAssignment.findFirst({
          where: {
            employeeId: id,
            deletedAt: null,
            validFrom: { lt: dayEnd },
            OR: [{ validTo: null }, { validTo: { gte: dayStart } }],
          },
          orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        });

        if (!covering) {
          errors.push({ id, type: "validation", reason: `no shift assignment covering ${effKey}` });
          continue;
        }
        if (covering.shiftId === destination_shift_id) {
          errors.push({
            id,
            type: "validation",
            reason: `already on destination shift on ${effKey}`,
          });
          continue;
        }
        if (covering.validFrom.getTime() > closeAt.getTime()) {
          errors.push({
            id,
            type: "validation",
            reason: `assignment starting ${utcDateKey(covering.validFrom)} cannot be closed before it starts (effective date too early)`,
          });
          continue;
        }
        if (utcDateKey(covering.validFrom) > todayKey) {
          errors.push({
            id,
            type: "conflict",
            reason: `employee already has a future assignment starting ${utcDateKey(covering.validFrom)} (shift ${covering.shiftId}); move rejected to preserve the planned schedule`,
          });
          continue;
        }
        // Defensive overlap: any other assignment overlapping the new range
        // [dayStart, covering.validTo] (excludes the covering row itself)
        const overlapping = await hasOverlap({
          employeeId: id,
          from: dayStart,
          to: covering.validTo,
          excludeId: covering.id,
        });
        if (overlapping) {
          errors.push({
            id,
            type: "conflict",
            reason: `another assignment overlaps the period from ${effKey}; move rejected to preserve the existing schedule`,
          });
          continue;
        }
        plan.push({ employeeId: id, covering });
      }

      if (errors.length > 0) {
        const message = errors.map((e) => `Employee ${e.id}: ${e.reason}`).join("; ");
        const hasConflict = errors.some((e) => e.type === "conflict");
        return callback({
          code: hasConflict ? grpc.status.ALREADY_EXISTS : grpc.status.INVALID_ARGUMENT,
          message,
        });
      }

      // ---- Execution phase: one interactive transaction for ALL employees ----
      const results = [];
      await prisma.$transaction(async (tx) => {
        for (const { employeeId, covering } of plan) {
          // Re-verify covering is unchanged inside the transaction
          const fresh = await tx.employeeShiftAssignment.findUnique({
            where: { id: covering.id },
          });
          if (
            !fresh ||
            fresh.deletedAt ||
            fresh.shiftId !== covering.shiftId ||
            fresh.validFrom.getTime() !== covering.validFrom.getTime()
          ) {
            throw new Error(`Employee ${employeeId}: assignment changed concurrently, move aborted`);
          }

          // Re-verify no other assignment overlaps the new range [dayStart, covering.validTo]
          const overlapping = await hasOverlap({
            employeeId,
            from: dayStart,
            to: covering.validTo,
            excludeId: covering.id,
            db: tx,
          });
          if (overlapping) {
            throw new Error(
              `Employee ${employeeId}: overlapping assignment appeared, move aborted`
            );
          }

          const prevValidTo = covering.validTo ? new Date(covering.validTo) : null;

          // 1. Close covering at D-1
          await tx.employeeShiftAssignment.update({
            where: { id: covering.id },
            data: { validTo: closeAt, updatedAt: new Date() },
          });

          // 2. Create destination segment [D, covering.validTo]
          //    (direct create: bypasses ShiftPolicies auto-assign rotational auto-close)
          const created = await tx.employeeShiftAssignment.create({
            data: {
              employeeId,
              shiftId: destination_shift_id,
              validFrom: effDate,
              validTo: prevValidTo,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          });

          // 3. Clear attendance adjustments only from D forward (never before today)
          await clearAttendanceAdjustments(employeeId, effDate, prevValidTo, tx);

          results.push({
            employee_id: employeeId,
            previous_assignment_id: covering.id,
            previous_shift_id: covering.shiftId,
            previous_valid_to: utcDateKey(closeAt),
            new_assignment_id: created.id,
            new_shift_id: destination_shift_id,
            new_valid_from: effKey,
            new_valid_to: prevValidTo ? utcDateKey(prevValidTo) : "",
          });
        }
      });

      console.log(
        `[MoveShift] moved ${results.length} employee(s) to shift ${destination_shift_id} effective ${effKey}`
      );

      callback(null, {
        success: true,
        effective_from: effKey,
        destination_shift_id,
        results,
      });
    } catch (e) {
      console.error("[MoveShift Error]", e);
      if (e.message && e.message.includes("move aborted")) {
        // Transaction rolled back — another writer touched these rows concurrently
        return callback({
          code: grpc.status.ABORTED,
          message: e.message,
        });
      }
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // ChangeShiftAssignment (Phase 2.4, atomic)
  // ======================================
  // Standardized date-bounded shift change shared by both Org Admin entry points.
  // Semantics (D = effective_from, date-only inclusive):
  //   covering(D) = latest assignment where validFrom < D+1 AND (validTo null OR validTo >= D)
  //   same destination shift          -> 400 friendly error (never a duplicate row)
  //   covering starts exactly on D    -> update that row in place (scheduled-row edit)
  //   covering starts in the future   -> 409 (planned schedule preserved, like Move)
  //   otherwise                       -> close covering at D-1, create [D, valid_to]
  // All-or-nothing: validate first, then one interactive transaction (Phase 2 Move pattern).
  ChangeShiftAssignment: async (call, callback) => {
    try {
      const { organization_id, employee_id, shift_id, effective_from, valid_to } = call.request;

      if (!organization_id || organization_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "organization_id is required",
        });
      }
      if (!employee_id || employee_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_id must be a 24-char ObjectId string",
        });
      }
      if (!shift_id || shift_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "shift_id must be a 24-char ObjectId string",
        });
      }

      const effDate = parseBusinessDate(effective_from);
      if (!effDate) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from must be a valid YYYY-MM-DD business date",
        });
      }
      const effKey = utcDateKey(effDate);
      const todayKey = todayBusinessKey();
      if (effKey < todayKey) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from cannot be in the past",
        });
      }

      let newTo = null;
      if (valid_to && String(valid_to).trim() !== "") {
        const t = parseBusinessDate(valid_to);
        if (!t) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_to must be a valid YYYY-MM-DD business date",
          });
        }
        if (utcDateKey(t) < effKey) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "valid_to cannot be before effective_from",
          });
        }
        newTo = t;
      }

      // Employee: exists, not deleted, same organization
      const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employee_id },
      });
      if (!employee || employee.deletedAt) {
        return callback({ code: grpc.status.NOT_FOUND, message: "Employee not found" });
      }
      if (String(employee.organizationId) !== organization_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Employee does not belong to the organization",
        });
      }

      // Destination shift: exists, not deleted, same organization
      const destShift = await prisma.shifts.findUnique({ where: { id: shift_id } });
      if (!destShift || destShift.deletedAt) {
        return callback({ code: grpc.status.NOT_FOUND, message: "Shift not found" });
      }
      if (String(destShift.organizationId) !== organization_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Shift does not belong to the organization",
        });
      }

      const dayStart = effDate;
      const dayEnd = addUtcDays(effDate, 1);
      const closeAt = addUtcDays(effDate, -1);

      // Covering assignment at D (date-only, inclusive)
      const covering = await prisma.employeeShiftAssignment.findFirst({
        where: {
          employeeId: employee_id,
          deletedAt: null,
          validFrom: { lt: dayEnd },
          OR: [{ validTo: null }, { validTo: { gte: dayStart } }],
        },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        include: {
          employee: { include: { designation: true } },
          shift: true,
        },
      });
      if (!covering) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `no shift assignment covering ${effKey}`,
        });
      }

      // Same shift on D: friendly rejection, never a duplicate row
      if (covering.shiftId === shift_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: `Employee is already assigned to "${destShift.name}" on ${effKey}`,
        });
      }

      const previous = mapAssignmentWithDetails(covering);

      // ---- In-place: covering starts exactly on D (scheduled/future row edit) ----
      if (covering.validFrom.getTime() === dayStart.getTime()) {
        const overlap = await hasOverlap({
          employeeId: employee_id,
          from: dayStart,
          to: newTo,
          excludeId: covering.id,
        });
        if (overlap) {
          return callback({
            code: grpc.status.ALREADY_EXISTS,
            message: `another assignment overlaps the period from ${effKey}; change rejected to preserve the existing schedule`,
          });
        }

        let updated;
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.employeeShiftAssignment.findUnique({
            where: { id: covering.id },
          });
          if (
            !fresh ||
            fresh.deletedAt ||
            fresh.shiftId !== covering.shiftId ||
            fresh.validFrom.getTime() !== covering.validFrom.getTime()
          ) {
            throw new Error("change aborted: assignment changed concurrently");
          }
          const reOverlap = await hasOverlap({
            employeeId: employee_id,
            from: dayStart,
            to: newTo,
            excludeId: covering.id,
            db: tx,
          });
          if (reOverlap) {
            throw new Error("change aborted: overlapping assignment appeared");
          }

          updated = await tx.employeeShiftAssignment.update({
            where: { id: covering.id },
            data: { shiftId: shift_id, validTo: newTo, updatedAt: new Date() },
            include: {
              employee: { include: { designation: true } },
              shift: true,
            },
          });

          await clearAttendanceAdjustments(employee_id, dayStart, newTo, tx);
        });

        console.log(
          `[ChangeShiftAssignment] in-place ${covering.id} -> shift ${shift_id} from ${effKey}`
        );
        return callback(null, {
          previous_assignment: previous,
          assignment: mapAssignmentWithDetails(updated),
        });
      }

      // Covering starts in the future but not on D -> planned schedule, reject (Move rule)
      if (utcDateKey(covering.validFrom) > todayKey) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: `employee already has a future assignment starting ${utcDateKey(covering.validFrom)} (shift ${covering.shiftId}); change rejected to preserve the planned schedule`,
        });
      }

      // Defensive overlap over [D, valid_to] (excludes the covering row itself)
      const overlap = await hasOverlap({
        employeeId: employee_id,
        from: dayStart,
        to: newTo,
        excludeId: covering.id,
      });
      if (overlap) {
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: `another assignment overlaps the period from ${effKey}; change rejected to preserve the existing schedule`,
        });
      }

      // ---- Execution: close covering at D-1 + create [D, valid_to], ONE transaction ----
      let created;
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.employeeShiftAssignment.findUnique({
          where: { id: covering.id },
        });
        if (
          !fresh ||
          fresh.deletedAt ||
          fresh.shiftId !== covering.shiftId ||
          fresh.validFrom.getTime() !== covering.validFrom.getTime()
        ) {
          throw new Error("change aborted: assignment changed concurrently");
        }
        const reOverlap = await hasOverlap({
          employeeId: employee_id,
          from: dayStart,
          to: newTo,
          excludeId: covering.id,
          db: tx,
        });
        if (reOverlap) {
          throw new Error("change aborted: overlapping assignment appeared");
        }

        // 1. Close covering at D-1 (historical row preserved)
        await tx.employeeShiftAssignment.update({
          where: { id: covering.id },
          data: { validTo: closeAt, updatedAt: new Date() },
        });

        // 2. Create destination segment [D, valid_to] (direct create bypasses
        //    ShiftPolicies rotational auto-close, same as Move)
        created = await tx.employeeShiftAssignment.create({
          data: {
            employeeId: employee_id,
            shiftId: shift_id,
            validFrom: dayStart,
            validTo: newTo,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
          include: {
            employee: { include: { designation: true } },
            shift: true,
          },
        });

        // 3. Clear attendance adjustments from D forward (D is never in the past)
        await clearAttendanceAdjustments(employee_id, dayStart, newTo, tx);
      });

      console.log(
        `[ChangeShiftAssignment] employee ${employee_id}: ${covering.id} closed at ${utcDateKey(closeAt)}, new ${created.id} [${effKey}..${newTo ? utcDateKey(newTo) : "open"}] shift ${shift_id}`
      );

      callback(null, {
        previous_assignment: previous,
        assignment: mapAssignmentWithDetails(created),
      });
    } catch (e) {
      console.error("[ChangeShiftAssignment Error]", e);
      if (e.message && e.message.includes("change aborted")) {
        return callback({
          code: grpc.status.ABORTED,
          message: e.message,
        });
      }
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // SwapShiftAssignment (Phase 2.5, atomic)
  // ======================================
  // Swaps TWO employees' covering shifts from a business date, preserving history.
  // Semantics (D = effective_from, date-only inclusive):
  //   covering_X(D) = latest assignment for X where validFrom < D+1 AND (validTo null OR validTo >= D)
  //   both coverings must exist; their shifts must differ (friendly 400 otherwise)
  //   covering starts exactly on D    -> swap that row's shiftId in place (scheduled-row edit)
  //   covering starts in the future   -> 409 (planned schedule preserved, like Move/Change)
  //   otherwise                       -> close at D-1, create [D, covering.validTo] carrying
  //                                      the OTHER employee's shift (window inherited, never extended)
  // All-or-nothing: validate both employees first, then ONE interactive transaction for both.
  SwapShiftAssignment: async (call, callback) => {
    try {
      const { organization_id, employee_a_id, employee_b_id, effective_from } = call.request;

      if (!organization_id || organization_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "organization_id is required",
        });
      }
      if (!employee_a_id || employee_a_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_a_id must be a 24-char ObjectId string",
        });
      }
      if (!employee_b_id || employee_b_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "employee_b_id must be a 24-char ObjectId string",
        });
      }
      if (employee_a_id === employee_b_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "cannot swap an employee with themselves",
        });
      }

      // Employees: exist, not deleted
      const employees = await prisma.organizationEmployees.findMany({
        where: { id: { in: [employee_a_id, employee_b_id] } },
      });
      const byId = new Map(employees.map((e) => [e.id, e]));
      for (const id of [employee_a_id, employee_b_id]) {
        const emp = byId.get(id);
        if (!emp || emp.deletedAt) {
          return callback({
            code: grpc.status.NOT_FOUND,
            message: `Employee not found: ${id}`,
          });
        }
      }

      // Employee organization ownership (authenticated org context is authoritative)
      for (const id of [employee_a_id, employee_b_id]) {
        if (String(byId.get(id).organizationId) !== organization_id) {
          return callback({
            code: grpc.status.PERMISSION_DENIED,
            message: `Employee does not belong to the organization: ${id}`,
          });
        }
      }

      const effDate = parseBusinessDate(effective_from);
      if (!effDate) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from must be a valid YYYY-MM-DD business date",
        });
      }
      const effKey = utcDateKey(effDate);
      const todayKey = todayBusinessKey();
      if (effKey < todayKey) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from cannot be in the past",
        });
      }

      const dayStart = effDate;
      const dayEnd = addUtcDays(effDate, 1);
      const closeAt = addUtcDays(effDate, -1);

      // ---- Validation phase (no writes): resolve coverings AS OF D (never today-only) ----
      const coverings = {};
      for (const id of [employee_a_id, employee_b_id]) {
        const covering = await prisma.employeeShiftAssignment.findFirst({
          where: {
            employeeId: id,
            deletedAt: null,
            validFrom: { lt: dayEnd },
            OR: [{ validTo: null }, { validTo: { gte: dayStart } }],
          },
          orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
          include: {
            employee: { include: { designation: true } },
            shift: true,
          },
        });
        if (!covering) {
          return callback({
            code: grpc.status.NOT_FOUND,
            message: `no shift assignment covering ${effKey} for employee ${id}`,
          });
        }
        coverings[id] = covering;
      }
      const coveringA = coverings[employee_a_id];
      const coveringB = coverings[employee_b_id];

      // Destination shifts (= each employee's covering shift becomes the other's):
      // must exist, not deleted, same organization.
      const shiftIds = [...new Set([coveringA.shiftId, coveringB.shiftId])];
      const shifts = await prisma.shifts.findMany({ where: { id: { in: shiftIds } } });
      const shiftById = new Map(shifts.map((s) => [s.id, s]));
      for (const sid of shiftIds) {
        const sh = shiftById.get(sid);
        if (!sh || sh.deletedAt) {
          return callback({
            code: grpc.status.NOT_FOUND,
            message: `Shift not found: ${sid}`,
          });
        }
        if (String(sh.organizationId) !== organization_id) {
          return callback({
            code: grpc.status.PERMISSION_DENIED,
            message: `Shift does not belong to the organization: ${sid}`,
          });
        }
      }

      // Same shift on D: reject the meaningless swap
      if (coveringA.shiftId === coveringB.shiftId) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: `Employees are already assigned to the same shift on ${effKey}.`,
        });
      }

      // Per-employee plan: in-place (row starts on D) vs split (close D-1 + create),
      // with Move/Change-compatible future-plan and overlap conflict guards.
      const plan = [];
      for (const id of [employee_a_id, employee_b_id]) {
        const covering = coverings[id];

        if (covering.validFrom.getTime() === dayStart.getTime()) {
          const overlap = await hasOverlap({
            employeeId: id,
            from: dayStart,
            to: covering.validTo,
            excludeId: covering.id,
          });
          if (overlap) {
            return callback({
              code: grpc.status.ALREADY_EXISTS,
              message: `another assignment overlaps the period from ${effKey} for employee ${id}; swap rejected to preserve the existing schedule`,
            });
          }
          plan.push({ employeeId: id, covering, mode: "in-place" });
          continue;
        }

        if (utcDateKey(covering.validFrom) > todayKey) {
          return callback({
            code: grpc.status.ALREADY_EXISTS,
            message: `employee ${id} already has a future assignment starting ${utcDateKey(covering.validFrom)} (shift ${covering.shiftId}); swap rejected to preserve the planned schedule`,
          });
        }

        const overlap = await hasOverlap({
          employeeId: id,
          from: dayStart,
          to: covering.validTo,
          excludeId: covering.id,
        });
        if (overlap) {
          return callback({
            code: grpc.status.ALREADY_EXISTS,
            message: `another assignment overlaps the period from ${effKey} for employee ${id}; swap rejected to preserve the existing schedule`,
          });
        }
        plan.push({ employeeId: id, covering, mode: "split" });
      }

      // Destination = the opposite employee's covering shift
      const destinationOf = {
        [employee_a_id]: coveringB.shiftId,
        [employee_b_id]: coveringA.shiftId,
      };

      // ---- Execution phase: ONE interactive transaction for BOTH employees ----
      const results = {};
      await prisma.$transaction(async (tx) => {
        for (const { employeeId, covering, mode } of plan) {
          // Re-verify the covering row is unchanged inside the transaction
          const fresh = await tx.employeeShiftAssignment.findUnique({
            where: { id: covering.id },
          });
          if (
            !fresh ||
            fresh.deletedAt ||
            fresh.shiftId !== covering.shiftId ||
            fresh.validFrom.getTime() !== covering.validFrom.getTime() ||
            (fresh.validTo ? fresh.validTo.getTime() : null) !==
              (covering.validTo ? covering.validTo.getTime() : null)
          ) {
            throw new Error("swap aborted: assignment changed concurrently");
          }

          // Re-verify no other assignment overlaps the new range [D, covering.validTo]
          const overlapping = await hasOverlap({
            employeeId,
            from: dayStart,
            to: covering.validTo,
            excludeId: covering.id,
            db: tx,
          });
          if (overlapping) {
            throw new Error("swap aborted: overlapping assignment appeared");
          }

          const previous = mapAssignmentWithDetails(covering);
          let row;

          if (mode === "in-place") {
            // Row starts exactly on D: exchange the shiftId, window untouched
            row = await tx.employeeShiftAssignment.update({
              where: { id: covering.id },
              data: { shiftId: destinationOf[employeeId], updatedAt: new Date() },
              include: {
                employee: { include: { designation: true } },
                shift: true,
              },
            });
            await clearAttendanceAdjustments(employeeId, dayStart, covering.validTo, tx);
          } else {
            const prevValidTo = covering.validTo ? new Date(covering.validTo) : null;

            // 1. Close covering at D-1 (historical row preserved)
            await tx.employeeShiftAssignment.update({
              where: { id: covering.id },
              data: { validTo: closeAt, updatedAt: new Date() },
            });

            // 2. Create swapped segment [D, covering.validTo] with the other employee's
            //    shift (direct create bypasses ShiftPolicies rotational auto-close, same as Move)
            row = await tx.employeeShiftAssignment.create({
              data: {
                employeeId,
                shiftId: destinationOf[employeeId],
                validFrom: dayStart,
                validTo: prevValidTo,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              },
              include: {
                employee: { include: { designation: true } },
                shift: true,
              },
            });

            // 3. Clear attendance adjustments from D forward only (D is never in the past)
            await clearAttendanceAdjustments(employeeId, dayStart, prevValidTo, tx);
          }

          results[employeeId] = {
            employee_id: employeeId,
            previous_assignment: previous,
            new_assignment: mapAssignmentWithDetails(row),
          };
        }
      });

      console.log(
        `[SwapShiftAssignment] swapped shifts for ${employee_a_id} <-> ${employee_b_id} effective ${effKey}`
      );

      callback(null, {
        success: true,
        effective_from: effKey,
        employee_a: results[employee_a_id],
        employee_b: results[employee_b_id],
      });
    } catch (e) {
      console.error("[SwapShiftAssignment Error]", e);
      if (e.message && e.message.includes("swap aborted")) {
        // Transaction rolled back — no partial swap can remain
        return callback({
          code: grpc.status.ABORTED,
          message: e.message,
        });
      }
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  // ======================================
  // RotateShiftAssignment (Phase 2.6)
  // Atomic rotation: employees grouped by their covering shift as of D are
  // moved 1->2->3->1 (or ZERO changed) inside ONE transaction.
  // ======================================
  RotateShiftAssignment: async (call, callback) => {
    try {
      const { organization_id, shift_1_id, shift_2_id, shift_3_id, effective_from } = call.request;

      if (!organization_id || organization_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "organization_id is required",
        });
      }
      const trioInput = [shift_1_id, shift_2_id, shift_3_id];
      for (const sid of trioInput) {
        if (!sid || sid.length !== 24) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "shift_1_id, shift_2_id and shift_3_id must be 24-char ObjectId strings",
          });
        }
      }
      if (new Set(trioInput).size !== 3) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "shift_1_id, shift_2_id and shift_3_id must be three distinct shifts",
        });
      }

      const effDate = parseBusinessDate(effective_from);
      if (!effDate) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from must be a valid YYYY-MM-DD business date",
        });
      }
      const effKey = utcDateKey(effDate);
      const todayKey = todayBusinessKey();
      if (effKey < todayKey) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "effective_from cannot be in the past",
        });
      }

      const dayStart = effDate;
      const dayEnd = addUtcDays(effDate, 1);
      const closeAt = addUtcDays(effDate, -1);

      // The three rotation shifts: exist, not deleted, same organization.
      const shifts = await prisma.shifts.findMany({ where: { id: { in: trioInput } } });
      const shiftById = new Map(shifts.map((s) => [s.id, s]));
      for (const sid of trioInput) {
        const sh = shiftById.get(sid);
        if (!sh || sh.deletedAt) {
          return callback({
            code: grpc.status.NOT_FOUND,
            message: `Shift not found: ${sid}`,
          });
        }
        if (String(sh.organizationId) !== organization_id) {
          return callback({
            code: grpc.status.PERMISSION_DENIED,
            message: `Shift does not belong to the organization: ${sid}`,
          });
        }
      }

      // ---- Resolve covering(D) for every org employee, then group by trio ----
      // Fetch without a deletedAt SQL filter (docs may omit the field), then
      // filter in JS — same pattern Swap uses for employee lookups.
      const orgEmployees = await prisma.organizationEmployees.findMany({
        where: { organizationId: organization_id },
        select: { id: true, deletedAt: true },
      });
      const empIds = orgEmployees.filter((e) => !e.deletedAt).map((e) => e.id);
      const coverings = empIds.length
        ? await prisma.employeeShiftAssignment.findMany({
            where: {
              employeeId: { in: empIds },
              deletedAt: null,
              validFrom: { lt: dayEnd },
              OR: [{ validTo: null }, { validTo: { gte: dayStart } }],
            },
            orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
            include: {
              employee: { include: { designation: true } },
              shift: true,
            },
          })
        : [];
      const coveringByEmp = new Map();
      for (const row of coverings) {
        if (!coveringByEmp.has(row.employeeId)) coveringByEmp.set(row.employeeId, row);
      }

      const trio = new Set(trioInput);
      const groupCounts = { [shift_1_id]: 0, [shift_2_id]: 0, [shift_3_id]: 0 };
      const participants = [];
      for (const [empId, cov] of coveringByEmp) {
        if (trio.has(cov.shiftId)) {
          participants.push({ employeeId: empId, covering: cov });
          groupCounts[cov.shiftId] += 1;
        }
      }
      participants.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

      if (participants.length === 0) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: `no employees are assigned to the selected rotation shifts as of ${effKey}`,
        });
      }

      // Rotation mapping: group1 -> group2 -> group3 -> group1.
      const destinationOf = {
        [shift_1_id]: shift_2_id,
        [shift_2_id]: shift_3_id,
        [shift_3_id]: shift_1_id,
      };

      // ---- Validation phase (no writes): plan every participant ----
      const plan = [];
      for (const { employeeId, covering } of participants) {
        const destination = destinationOf[covering.shiftId];

        if (covering.validFrom.getTime() === dayStart.getTime()) {
          const overlap = await hasOverlap({
            employeeId,
            from: dayStart,
            to: covering.validTo,
            excludeId: covering.id,
          });
          if (overlap) {
            return callback({
              code: grpc.status.ALREADY_EXISTS,
              message: `another assignment overlaps the period from ${effKey} for employee ${employeeId}; rotation rejected to preserve the existing schedule`,
            });
          }
          plan.push({ employeeId, covering, mode: "in-place", destination });
          continue;
        }

        if (utcDateKey(covering.validFrom) > todayKey) {
          return callback({
            code: grpc.status.ALREADY_EXISTS,
            message: `employee ${employeeId} already has a future assignment starting ${utcDateKey(covering.validFrom)} (shift ${covering.shiftId}); rotation rejected to preserve the planned schedule`,
          });
        }

        const overlap = await hasOverlap({
          employeeId,
          from: dayStart,
          to: covering.validTo,
          excludeId: covering.id,
        });
        if (overlap) {
          return callback({
            code: grpc.status.ALREADY_EXISTS,
            message: `another assignment overlaps the period from ${effKey} for employee ${employeeId}; rotation rejected to preserve the existing schedule`,
          });
        }
        plan.push({ employeeId, covering, mode: "split", destination });
      }

      // ---- Execution phase: ONE transaction for ALL participants ----
      const results = [];
      await prisma.$transaction(async (tx) => {
        // Idempotency: if EVERY participant's covering already starts exactly on D
        // and each has a predecessor row ending at D-1, the exact rotation for this
        // effective date has already been applied (split or in-place). Refuse instead
        // of double-rotating on a double-click.
        let allBoundary = true;
        for (const { employeeId, covering } of plan) {
          const cov = await tx.employeeShiftAssignment.findUnique({
            where: { id: covering.id },
          });
          if (!cov || cov.deletedAt || cov.validFrom.getTime() !== dayStart.getTime()) {
            allBoundary = false;
            break;
          }
          const pred = await tx.employeeShiftAssignment.findFirst({
            where: {
              employeeId,
              deletedAt: null,
              validTo: closeAt,
              NOT: { id: covering.id },
            },
          });
          if (!pred) {
            allBoundary = false;
            break;
          }
        }
        if (allBoundary) {
          throw new Error(
            `rotation already applied: assignments for affected employees already change on ${effKey}; refusing to rotate the same employees again on the same effective date`
          );
        }

        for (const { employeeId, covering, mode, destination } of plan) {
          // Re-verify the covering row is unchanged inside the transaction
          const fresh = await tx.employeeShiftAssignment.findUnique({
            where: { id: covering.id },
          });
          if (
            !fresh ||
            fresh.deletedAt ||
            fresh.shiftId !== covering.shiftId ||
            fresh.validFrom.getTime() !== covering.validFrom.getTime() ||
            (fresh.validTo ? fresh.validTo.getTime() : null) !==
              (covering.validTo ? covering.validTo.getTime() : null)
          ) {
            throw new Error("rotation aborted: assignment changed concurrently");
          }

          // Re-verify no other assignment overlaps the new range [D, covering.validTo]
          const overlapping = await hasOverlap({
            employeeId,
            from: dayStart,
            to: covering.validTo,
            excludeId: covering.id,
            db: tx,
          });
          if (overlapping) {
            throw new Error("rotation aborted: overlapping assignment appeared");
          }

          const previous = mapAssignmentWithDetails(covering);
          let row;

          if (mode === "in-place") {
            // Row starts exactly on D: switch the shiftId, window untouched
            row = await tx.employeeShiftAssignment.update({
              where: { id: covering.id },
              data: { shiftId: destination, updatedAt: new Date() },
              include: {
                employee: { include: { designation: true } },
                shift: true,
              },
            });
            await clearAttendanceAdjustments(employeeId, dayStart, covering.validTo, tx);
          } else {
            const prevValidTo = covering.validTo ? new Date(covering.validTo) : null;

            // 1. Close covering at D-1 (historical row preserved)
            await tx.employeeShiftAssignment.update({
              where: { id: covering.id },
              data: { validTo: closeAt, updatedAt: new Date() },
            });

            // 2. Create rotated segment [D, covering.validTo] with the destination
            //    shift (direct create bypasses ShiftPolicies, same as Move/Swap)
            row = await tx.employeeShiftAssignment.create({
              data: {
                employeeId,
                shiftId: destination,
                validFrom: dayStart,
                validTo: prevValidTo,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              },
              include: {
                employee: { include: { designation: true } },
                shift: true,
              },
            });

            // 3. Clear attendance adjustments from D forward (D is never in the past)
            await clearAttendanceAdjustments(employeeId, dayStart, prevValidTo, tx);
          }

          results.push({
            employee_id: employeeId,
            previous_shift_id: covering.shiftId,
            new_shift_id: destination,
            mode,
            previous_assignment: previous,
            new_assignment: mapAssignmentWithDetails(row),
          });
        }
      });

      console.log(
        `[RotateShiftAssignment] rotated ${results.length} employees across [${trioInput.join(", ")}] effective ${effKey}`
      );

      callback(null, {
        success: true,
        effective_from: effKey,
        shift_1_id,
        shift_2_id,
        shift_3_id,
        affected_employee_count: results.length,
        group_counts: trioInput.map((sid) => ({
          shift_id: sid,
          shift_name: shiftById.get(sid).name,
          employee_count: groupCounts[sid],
        })),
        results,
      });
    } catch (e) {
      console.error("[RotateShiftAssignment Error]", e);
      if (e.message && e.message.startsWith("rotation already applied:")) {
        // Transaction rolled back before any write — controlled duplicate conflict
        return callback({
          code: grpc.status.ALREADY_EXISTS,
          message: e.message,
        });
      }
      if (e.message && e.message.includes("rotation aborted")) {
        // Transaction rolled back — no partial rotation can remain
        return callback({
          code: grpc.status.ABORTED,
          message: e.message,
        });
      }
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
