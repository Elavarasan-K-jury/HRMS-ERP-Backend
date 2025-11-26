import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma } from "@jury-hrms/db/client.js";
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ATTENDANCE_SERVICE_PORT || 5062);
const attendanceProto = loadProto("attendance");

/* ===========================
   Helper: parse ISO date/time
=========================== */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/* Date-only (strip time) */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* Haversine distance in meters */
function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ===========================
   Policy helpers
=========================== */

async function getActiveAttendancePolicy(organizationId) {
  try {
    const policy = await prisma.attendancePolicies.findFirst({
      where: {
        organizationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!policy) {
      // sensible defaults if none configured
      return {
        graceMinutes: 10,
        halfDayMinutes: 240,
        fullDayMinutes: 480,
        allowGeoCheckIn: true,
        allowOutsideGeo: true,
        autoMarkAbsent: true,
        checkInBufferMin: 15,
        checkOutBufferMin: 15,
        roundingStrategy: "none",
        overtimeAllowed: false,
        minOvertimeMinutes: 30,
      };
    }

    return policy;
  } catch (error) {
    console.log(`getActiveAttendancePolicy(${organizationId})`, error);
  }
}

async function getActiveNetworkPolicyForAttendance(organizationId) {
  try {
    const policy = await prisma.networkPolicies.findFirst({
      where: {
        organizationId,
        isActive: true,
        deletedAt: null,
        enforceOn: { in: ["ATTENDANCE", "BOTH"] },
      },
      orderBy: { createdAt: "desc" },
    });

    return policy || null;
  } catch (error) {
    console.log(`getActiveNetworkPolicyForAttendance(${organizationId})`, error);
  }
}

async function getActiveGeoFences(organizationId) {
  try {
    const fences = await prisma.geoFences.findMany({
      where: {
        organizationId,
        isActive: true,
        deletedAt: null,
      },
    });
    return fences;
  } catch (error) {
    console.log(`getActiveGeoFences(${organizationId})`, error);
  }
}

/* network/IP enforcement */
async function enforceNetworkPolicy({ organizationId, ipAddress }) {
  try {
    const policy = await getActiveNetworkPolicyForAttendance(organizationId);
    if (!policy) return; // nothing to enforce

    if (!ipAddress) {
      throw {
        code: grpc.status.PERMISSION_DENIED,
        message: "IP address required by network policy",
      };
    }

    const allowed = policy.allowedIPs || [];
    if (allowed.length && !allowed.includes(ipAddress)) {
      throw {
        code: grpc.status.PERMISSION_DENIED,
        message: "IP address not allowed for attendance",
      };
    }
  } catch (error) {
    console.log(`enforceNetworkPolicy({ ${organizationId}, ${ipAddress} })`, e);
  }
}

/* geofence enforcement */
async function enforceGeoFence({ organizationId, lat, lon }) {
  try {
    const policy = await getActiveAttendancePolicy(organizationId);
    if (!policy.allowGeoCheckIn) return; // no geo restriction

    const fences = await getActiveGeoFences(organizationId);
    if (!fences.length) {
      if (policy.allowOutsideGeo) return;
      throw {
        code: grpc.status.PERMISSION_DENIED,
        message: "No active geofence configured, and outside-geo not allowed",
      };
    }

    if (lat == null || lon == null) {
      if (policy.allowOutsideGeo) return;
      throw {
        code: grpc.status.PERMISSION_DENIED,
        message: "Location required for attendance",
      };
    }

    let inside = false;
    for (const fence of fences) {
      const d = distanceInMeters(lat, lon, fence.latitude, fence.longitude);
      if (d <= fence.radiusMeters) {
        inside = true;
        break;
      }
    }

    if (!inside && !policy.allowOutsideGeo) {
      throw {
        code: grpc.status.PERMISSION_DENIED,
        message: "Outside allowed geofence for attendance",
      };
    }
  } catch (error) {
    console.log(`enforceGeoFence({ ${organizationId}, ${lat}, ${lon} })`, error);
  }
}

/* ===========================
   Shift lookup for the day
=========================== */

async function getShiftForDate(employeeId, dateOnly) {
  try {
    const assignment = await prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        deletedAt: null,
        validFrom: { lte: dateOnly },
        OR: [{ validTo: null }, { validTo: { gte: dateOnly } }],
      },
      include: { shift: true },
    });

    return assignment?.shift || null;
  } catch (error) {
    console.log(`getShiftForDate(${employeeId}, ${dateOnly})`, error);
  }
}

/* ===========================
   Compute attendance metrics
=========================== */

async function computeAttendanceStatus({ attendance, shift, policy }) {
  try {
    const result = { ...attendance };

    const checkIn = new Date(attendance.checkIn);
    const checkOut = attendance.checkOut ? new Date(attendance.checkOut) : new Date();

    let grossMinutes = 0;
    if (checkIn && checkOut) {
      grossMinutes = Math.max(
        0,
        ((checkOut.getTime() - checkIn.getTime()) / 60000)
      );
    }

    let effectiveMinutes = 0;
    let checkInTime = null;
    const attendanceLogs = await prisma.attendanceLogs.findMany({
      where: {
        attendanceId: attendance.id,
      },
      orderBy: { createdAt: "asc" },
    })
    for (const log of attendanceLogs) {
      if (log.type == 'CHECK_IN') {
        checkInTime = log.createdAt;
      } else {
        effectiveMinutes += ((log.createdAt - checkInTime) / 60000);
      }
    }
    const grace = policy.graceMinutes ?? 10;
    let lateMinutes = 0;

    if (shift && checkIn) {
      const shiftStart = new Date(attendance.date);
      shiftStart.setHours(
        shift.startTime.getHours(),
        shift.startTime.getMinutes(),
        0,
        0
      );

      const diff = Math.round((checkIn - shiftStart) / 60000);
      if (diff > grace) {
        lateMinutes = diff;
      }
    }

    let status = attendance.status || "PENDING";

    if (attendance.isHoliday) {
      status = "HOLIDAY";
    } else if (!checkIn && !checkOut) {
      // leave auto-absent marking to cron / scheduler; here keep PENDING
      status = "PENDING";
    } else {
      if (effectiveMinutes >= (policy.fullDayMinutes ?? 480)) {
        status = "PRESENT";
      } else if (effectiveMinutes >= (policy.halfDayMinutes ?? 240)) {
        status = "HALF_DAY";
      } else if (lateMinutes > 0) {
        status = "LATE";
      } else {
        status = "ABSENT";
      }
    }

    result.grossHours = grossMinutes / 60;
    result.effectiveHours = effectiveMinutes / 60;
    result.lateArrivalMinutes = lateMinutes;
    result.status = status;

    return result;
  } catch (error) {
    console.log(
      `computeAttendanceStatus({ ${JSON.stringify(attendance)}, ${JSON.stringify(
        shift
      )}, ${JSON.stringify(policy)} })`,
      error
    );
  }
}

function formatDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/* ===========================
   Mapper to gRPC AttendanceObject
=========================== */

function mapAttendanceToProto(att) {
  return {
    id: att.id,
    organization_id: att.organizationId,
    employee_id: att.employeeId,
    date: att.date ? formatDate(att.date) : "",
    check_in: att.checkIn ? formatDateTime(att.checkIn) : "",
    check_out: att.checkOut ? formatDateTime(att.checkOut) : "",
    gross_hours: att.grossHours ?? 0,
    effective_hours: att.effectiveHours ?? 0,
    late_arrival_minutes: att.lateArrivalMinutes ?? 0,
    status: att.status ?? "PENDING",
    logs: att.logs && att.logs.map(e => ({
      ...e,
      createdAt: e.createdAt ? formatDateTime(e.createdAt) : '',
      updatedAt: e.updatedAt ? formatDateTime(e.updatedAt) : '',
      deletedAt: e.deletedAt ? formatDateTime(e.deletedAt) : '',
    })),
    employee: att.employee && {
      id: att.employee.id,
      first_name: att.employee.firstName,
      last_name: att.employee.lastName,
      email: att.employee.email,
      phone: att.employee.phone,
    },
    organization: att.employee && {
      id: att.organization.id,
      name: att.organization.name,
      domain: att.organization.domain,
      email: att.organization.email,
      contactPersonName: att.organization.contactPersonName,
      contactPersonNumber: att.organization.contactPersonNumber,
      industry: att.organization.industry,
    }
  };
}

/* ===========================
   gRPC Implementation
=========================== */

const impl = {
  // ----------------------
  // CheckIn
  // ----------------------
  CheckIn: async (call, callback) => {
    try {
      const { employee_id, ip_address, latitude, longitude, source } =
        call.request;

      if (!employee_id || employee_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid employee_id",
        });
      }

      const employee = await prisma.organizationEmployees.findFirst({
        where: { id: employee_id },
      });

      if (!employee || employee.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Employee not found",
        });
      }

      // Enforce network & geo policies
      await enforceNetworkPolicy({
        organizationId: employee.organizationId,
        ipAddress: ip_address,
      });

      await enforceGeoFence({
        organizationId: employee.organizationId,
        lat: latitude,
        lon: longitude,
      });

      const today = startOfDay(new Date());

      // find or create attendance for today
      let attendance = await prisma.attendance.findFirst({
        where: {
          employeeId: employee_id,
          date: today,
          deletedAt: null,
        },
      });

      const now = new Date();

      if (!attendance) {
        attendance = await prisma.attendance.create({
          data: {
            organizationId: employee.organizationId,
            employeeId: employee_id,
            date: today,
            checkIn: now,
            checkOut: null,
            location:
              latitude != null && longitude != null
                ? { latitude, longitude }
                : null,
            deletedAt: null
          },
        });
      } else {
        // if already checked-in, we don't override, we just log adjustment
        if (!attendance.checkIn) {
          attendance = await prisma.attendance.update({
            where: { id: attendance.id },
            data: {
              checkIn: now,
              location:
                latitude != null && longitude != null
                  ? { latitude, longitude }
                  : attendance.location,
              deletedAt: null
            },
          });
        } else {
          attendance = await prisma.attendance.update({
            where: { id: attendance.id },
            data: {
              checkOut: null,
              location:
                latitude != null && longitude != null
                  ? { latitude, longitude }
                  : attendance.location,
              deletedAt: null
            },
          })
        }
      }

      // log check-in
      await prisma.attendanceLogs.create({
        data: {
          attendanceId: attendance.id,
          type: "CHECK_IN",
          ipAddress: ip_address ?? null,
          geoLocation:
            latitude != null && longitude != null
              ? { latitude, longitude }
              : null,
          source: source ?? "UNKNOWN",
        },
      });

      const policy = await getActiveAttendancePolicy(employee.organizationId);
      const shift = await getShiftForDate(employee_id, today);

      // recompute metrics
      const computed = computeAttendanceStatus({
        attendance,
        shift,
        policy,
      });

      const updated = await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          grossHours: computed.grossHours,
          effectiveHours: computed.effectiveHours,
          lateArrivalMinutes: computed.lateArrivalMinutes,
          status: computed.status,
        },
      });

      return callback(null, {
        attendance: mapAttendanceToProto(updated),
        success: true,
        message: "Successfully checked-in",
      });
    } catch (e) {
      console.error("[CheckIn Error]", e);
      if (e.code && e.message) return callback(e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  // ----------------------
  // CheckOut
  // ----------------------
  CheckOut: async (call, callback) => {
    try {
      const { employee_id, ip_address, latitude, longitude, source } =
        call.request;

      if (!employee_id || employee_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid employee_id",
        });
      }

      const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employee_id },
      });

      if (!employee || employee.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Employee not found",
        });
      }

      await enforceNetworkPolicy({
        organizationId: employee.organizationId,
        ipAddress: ip_address,
      });

      await enforceGeoFence({
        organizationId: employee.organizationId,
        lat: latitude,
        lon: longitude,
      });

      const today = startOfDay(new Date());

      let attendance = await prisma.attendance.findFirst({
        where: {
          employeeId: employee_id,
          date: today,
          deletedAt: null,
        },
      });

      const now = new Date();

      if (!attendance) {
        // no check-in but checking out → create row & mark accordingly
        attendance = await prisma.attendance.create({
          data: {
            organizationId: employee.organizationId,
            employeeId: employee_id,
            date: today,
            checkIn: null,
            checkOut: now,
            location:
              latitude != null && longitude != null
                ? { latitude, longitude }
                : null,
            deletedAt: null
          },
        });
      } else {
        attendance = await prisma.attendance.update({
          where: { id: attendance.id },
          data: {
            checkOut: now,
            location:
              latitude != null && longitude != null
                ? { latitude, longitude }
                : attendance.location,
            deletedAt: null
          },
        });
      }

      await prisma.attendanceLogs.create({
        data: {
          attendanceId: attendance.id,
          type: "CHECK_OUT",
          ipAddress: ip_address ?? null,
          geoLocation:
            latitude != null && longitude != null
              ? { latitude, longitude }
              : null,
          source: source ?? "UNKNOWN",
        },
      });

      const policy = await getActiveAttendancePolicy(employee.organizationId);
      const shift = await getShiftForDate(employee_id, today);

      const computed = computeAttendanceStatus({
        attendance,
        shift,
        policy,
      });

      const updated = await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          grossHours: computed.grossHours,
          effectiveHours: computed.effectiveHours,
          lateArrivalMinutes: computed.lateArrivalMinutes,
          status: computed.status,
        },
      });

      return callback(null, {
        attendance: mapAttendanceToProto(updated),
        success: true,
        message: "Successfully checked out",
      });
    } catch (e) {
      console.error("[CheckOut Error]", e);
      if (e.code && e.message) return callback(e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  // ----------------------
  // RecomputeAttendance
  // ----------------------
  RecomputeAttendance: async (call, callback) => {
    try {
      const { employee_id, date } = call.request;

      if (!employee_id || employee_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid employee_id",
        });
      }

      const d = date ? startOfDay(parseDate(date)) : startOfDay(new Date());
      if (!d) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid date",
        });
      }

      const employee = await prisma.organizationEmployees.findUnique({
        where: { id: employee_id },
      });

      if (!employee || employee.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Employee not found",
        });
      }

      let attendance = await prisma.attendance.findFirst({
        where: {
          employeeId: employee_id,
          date: d,
          deletedAt: null,
        },
      });

      if (!attendance) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Attendance not found for given date",
        });
      }

      const policy = await getActiveAttendancePolicy(employee.organizationId);
      const shift = await getShiftForDate(employee_id, d);

      const computed = await computeAttendanceStatus({
        attendance,
        shift,
        policy,
      });


      const updated = await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          grossHours: computed.grossHours,
          effectiveHours: computed.effectiveHours,
          lateArrivalMinutes: computed.lateArrivalMinutes,
          status: computed.status,
        },
      });

      return callback(null, {
        attendance: mapAttendanceToProto(updated),
        success: true,
        message: "Attendance re-computed successfully",
      });
    } catch (e) {
      console.error("[RecomputeAttendance Error]", e);
      if (e.code && e.message) return callback(e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  // ----------------------
  // ListAttendance (month)
  // ----------------------
  ListAttendance: async (call, callback) => {
    try {
      const { employee_id, month } = call.request;

      if (!employee_id || employee_id.length !== 24) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Invalid employee_id",
        });
      }

      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "month must be YYYY-MM",
        });
      }

      const [yearStr, monthStr] = month.split("-");
      const year = Number(yearStr);
      const m = Number(monthStr) - 1;
      const from = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(year, m + 1, 1, 0, 0, 0, 0));

      const records = await prisma.attendance.findMany({
        where: {
          employeeId: employee_id,
          date: { gte: from, lt: to },
          deletedAt: null,
        },
        include: {
          logs: true,
          employee: true,
          organization: true,
        },
        orderBy: { date: "desc" },
      });

      return callback(null, {
        attendance: records.map(mapAttendanceToProto),
        success: true,
        message: "Successfully listed attendance.",
      });
    } catch (e) {
      console.error("[ListAttendance Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  /* ============================================================
     Attendance Policy CRUD
  ============================================================ */

  CreateAttendancePolicy: async (call, callback) => {
    try {
      const data = call.request;
      const {
        organization_id,
        name,
        grace_minutes,
        half_day_minutes,
        full_day_minutes,
        allow_geo_checkin,
        allow_outside_geo,
        auto_mark_absent,
        checkin_buffer_min,
        checkout_buffer_min,
        rounding_strategy,
        overtime_allowed,
        min_overtime_minutes,
      } = data;

      const now = new Date();

      const policy = await prisma.attendancePolicies.create({
        data: {
          organizationId: organization_id,
          name,
          graceMinutes: grace_minutes ?? 10,
          halfDayMinutes: half_day_minutes ?? 240,
          fullDayMinutes: full_day_minutes ?? 480,
          allowGeoCheckIn: allow_geo_checkin ?? true,
          allowOutsideGeo: allow_outside_geo ?? false,
          autoMarkAbsent: auto_mark_absent ?? true,
          checkInBufferMin: checkin_buffer_min ?? 15,
          checkOutBufferMin: checkout_buffer_min ?? 15,
          roundingStrategy: rounding_strategy ?? "none",
          overtimeAllowed: overtime_allowed ?? false,
          minOvertimeMinutes: min_overtime_minutes ?? 30,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      });

      callback(null, {
        policy: {
          id: policy.id,
          organization_id: policy.organizationId,
          name: policy.name,
          grace_minutes: policy.graceMinutes ?? 0,
          half_day_minutes: policy.halfDayMinutes ?? 0,
          full_day_minutes: policy.fullDayMinutes ?? 0,
          allow_geo_checkin: policy.allowGeoCheckIn,
          allow_outside_geo: policy.allowOutsideGeo,
          auto_mark_absent: policy.autoMarkAbsent,
          checkin_buffer_min: policy.checkInBufferMin ?? 0,
          checkout_buffer_min: policy.checkOutBufferMin ?? 0,
          rounding_strategy: policy.roundingStrategy ?? "",
          overtime_allowed: policy.overtimeAllowed,
          min_overtime_minutes: policy.minOvertimeMinutes ?? 0,
        },
      });
    } catch (e) {
      console.error("[CreateAttendancePolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  UpdateAttendancePolicy: async (call, callback) => {
    try {
      const { policy_id, data } = call.request;

      const existing = await prisma.attendancePolicies.findUnique({
        where: { id: policy_id },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Attendance policy not found",
        });
      }

      const updated = await prisma.attendancePolicies.update({
        where: { id: policy_id },
        data: {
          name: data.name ?? existing.name,
          graceMinutes: data.grace_minutes ?? existing.graceMinutes,
          halfDayMinutes: data.half_day_minutes ?? existing.halfDayMinutes,
          fullDayMinutes: data.full_day_minutes ?? existing.fullDayMinutes,
          allowGeoCheckIn: data.allow_geo_checkin ?? existing.allowGeoCheckIn,
          allowOutsideGeo: data.allow_outside_geo ?? existing.allowOutsideGeo,
          autoMarkAbsent: data.auto_mark_absent ?? existing.autoMarkAbsent,
          checkInBufferMin:
            data.checkin_buffer_min ?? existing.checkInBufferMin,
          checkOutBufferMin:
            data.checkout_buffer_min ?? existing.checkOutBufferMin,
          roundingStrategy: data.rounding_strategy ?? existing.roundingStrategy,
          overtimeAllowed: data.overtime_allowed ?? existing.overtimeAllowed,
          minOvertimeMinutes:
            data.min_overtime_minutes ?? existing.minOvertimeMinutes,
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

      callback(null, {
        policy: {
          id: updated.id,
          organization_id: updated.organizationId,
          name: updated.name,
          grace_minutes: updated.graceMinutes ?? 0,
          half_day_minutes: updated.halfDayMinutes ?? 0,
          full_day_minutes: updated.fullDayMinutes ?? 0,
          allow_geo_checkin: updated.allowGeoCheckIn,
          allow_outside_geo: updated.allowOutsideGeo,
          auto_mark_absent: updated.autoMarkAbsent,
          checkin_buffer_min: updated.checkInBufferMin ?? 0,
          checkout_buffer_min: updated.checkOutBufferMin ?? 0,
          rounding_strategy: updated.roundingStrategy ?? "",
          overtime_allowed: updated.overtimeAllowed,
          min_overtime_minutes: updated.minOvertimeMinutes ?? 0,
        },
      });
    } catch (e) {
      console.error("[UpdateAttendancePolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  ListAttendancePolicy: async (call, callback) => {
    try {
      const { organization_id } = call.request;
      const policies = await prisma.attendancePolicies.findMany({
        where: {
          organizationId: organization_id,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      callback(null, {
        policies: policies.map((p) => ({
          id: p.id,
          organization_id: p.organizationId,
          name: p.name,
          grace_minutes: p.graceMinutes ?? 0,
          half_day_minutes: p.halfDayMinutes ?? 0,
          full_day_minutes: p.fullDayMinutes ?? 0,
          allow_geo_checkin: p.allowGeoCheckIn,
          allow_outside_geo: p.allowOutsideGeo,
          auto_mark_absent: p.autoMarkAbsent,
          checkin_buffer_min: p.checkInBufferMin ?? 0,
          checkout_buffer_min: p.checkOutBufferMin ?? 0,
          rounding_strategy: p.roundingStrategy ?? "",
          overtime_allowed: p.overtimeAllowed,
          min_overtime_minutes: p.minOvertimeMinutes ?? 0,
        })),
      });
    } catch (e) {
      console.error("[ListAttendancePolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  /* ============================================================
     Network Policy CRUD
  ============================================================ */

  CreateNetworkPolicy: async (call, callback) => {
    try {
      const { organization_id, name, enforce_on, allowed_ips } = call.request;

      const policy = await prisma.networkPolicies.create({
        data: {
          organizationId: organization_id,
          name,
          enforceOn: enforce_on || "ATTENDANCE",
          allowedIPs: allowed_ips || [],
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

      callback(null, {
        policy: {
          id: policy.id,
          organization_id: policy.organizationId,
          name: policy.name,
          enforce_on: policy.enforceOn,
          allowed_ips: policy.allowedIPs || [],
          created_at: policy.createdAt,
          updated_at: policy.updatedAt,
          deleted_at: policy.deletedAt,
        },
      });
    } catch (e) {
      console.error("[CreateNetworkPolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  UpdateNetworkPolicy: async (call, callback) => {
    try {
      const { policy_id, data } = call.request;

      const existing = await prisma.networkPolicies.findUnique({
        where: { id: policy_id },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Network policy not found",
        });
      }

      const updated = await prisma.networkPolicies.update({
        where: { id: policy_id },
        data: {
          name: data.name ?? existing.name,
          enforceOn: data.enforce_on ?? existing.enforceOn,
          allowedIPs: data.allowed_ips?.length
            ? data.allowed_ips
            : existing.allowedIPs,
          updatedAt: new Date(),
        },
      });

      callback(null, {
        policy: {
          id: updated.id,
          organization_id: updated.organizationId,
          name: updated.name,
          enforce_on: updated.enforceOn,
          allowed_ips: updated.allowedIPs || [],
        },
      });
    } catch (e) {
      console.error("[UpdateNetworkPolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  ListNetworkPolicy: async (call, callback) => {
    try {
      const { organization_id } = call.request;

      const policies = await prisma.networkPolicies.findMany({
        where: {
          organizationId: organization_id,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      callback(null, {
        policies: policies.map((p) => ({
          id: p.id,
          organization_id: p.organizationId,
          name: p.name,
          enforce_on: p.enforceOn,
          allowed_ips: p.allowedIPs || [],
        })),
      });
    } catch (e) {
      console.error("[ListNetworkPolicy Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  /* ============================================================
     GeoFence CRUD
  ============================================================ */

  CreateGeoFence: async (call, callback) => {
    try {
      const { organization_id, name, latitude, longitude, radius_meters } =
        call.request;

      const fence = await prisma.geoFences.create({
        data: {
          organizationId: organization_id,
          name,
          latitude,
          longitude,
          radiusMeters: radius_meters,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

      callback(null, {
        geofence: {
          id: fence.id,
          organization_id: fence.organizationId,
          name: fence.name,
          latitude: fence.latitude,
          longitude: fence.longitude,
          radius_meters: fence.radiusMeters,
          created_at: fence.createdAt,
          updated_at: fence.updatedAt,
          deleted_at: fence.deletedAt,
        },
      });
    } catch (e) {
      console.error("[CreateGeoFence Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  UpdateGeoFence: async (call, callback) => {
    try {
      const { geofence_id, data } = call.request;

      const existing = await prisma.geoFences.findUnique({
        where: { id: geofence_id },
      });

      if (!existing || existing.deletedAt) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "GeoFence not found",
        });
      }

      const updated = await prisma.geoFences.update({
        where: { id: geofence_id },
        data: {
          name: data.name ?? existing.name,
          latitude:
            typeof data.latitude === "number"
              ? data.latitude
              : existing.latitude,
          longitude:
            typeof data.longitude === "number"
              ? data.longitude
              : existing.longitude,
          radiusMeters:
            typeof data.radius_meters === "number"
              ? data.radius_meters
              : existing.radiusMeters,
          updatedAt: new Date(),
        },
      });

      callback(null, {
        geofence: {
          id: updated.id,
          organization_id: updated.organizationId,
          name: updated.name,
          latitude: updated.latitude,
          longitude: updated.longitude,
          radius_meters: updated.radiusMeters,
        },
      });
    } catch (e) {
      console.error("[UpdateGeoFence Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },

  ListGeoFence: async (call, callback) => {
    try {
      const { organization_id } = call.request;

      const fences = await prisma.geoFences.findMany({
        where: {
          organizationId: organization_id,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      callback(null, {
        geofences: fences.map((f) => ({
          id: f.id,
          organization_id: f.organizationId,
          name: f.name,
          latitude: f.latitude,
          longitude: f.longitude,
          radius_meters: f.radiusMeters,
        })),
      });
    } catch (e) {
      console.error("[ListGeoFence Error]", e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message || "Internal error",
      });
    }
  },
};

/* ------------------------------------------------------------------ */
/* 🧩 Graceful shutdown-aware main()                                  */
/* ------------------------------------------------------------------ */

async function main() {
  const server = new grpc.Server();

  server.addService(attendanceProto.AttendanceService.service, impl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve())
    );
  });

  console.log(`[attendance-service] gRPC running on :${PORT}`);

  const shutdown = async (signal) => {
    console.log(
      `\n[attendance-service] Received ${signal}, shutting down gracefully...`
    );

    try {
      server.tryShutdown((err) => {
        if (err) {
          console.error(
            "[attendance-service] Force closing due to error:",
            err
          );
          server.forceShutdown();
        } else {
          console.log("[attendance-service] gRPC server stopped.");
        }
      });

      await prisma.$disconnect();
      console.log("[attendance-service] Prisma disconnected.");
      process.exit(0);
    } catch (e) {
      console.error("[attendance-service] Error during shutdown:", e);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[attendance-service] Fatal error:", err);
  process.exit(1);
});
