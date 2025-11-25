// src/services/approval/approval.server.js
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.APPROVAL_SERVICE_PORT || 5075);
const approvalProto = loadProto('approval');

// 24-char hex validator
const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

// =======================================================
//  MAPPERS
// =======================================================
function mapOrganization(org) {
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    domain: org.domain ?? '',
  };
}

function mapEmployee(emp) {
  if (!emp) return null;

  const designationName = emp.designation?.name ?? '';
  const designationId = emp.designation?.id ?? '';

  const activeDeptAssign = emp.departmentAssignments?.find((d) => !d.endDate) ?? emp.departmentAssignments?.[0];
  const departmentName = activeDeptAssign?.department?.name ?? '';
  const departmentId = activeDeptAssign?.department?.id ?? '';

  return {
    id: emp.id,
    organization_id: emp.organizationId,
    full_name: emp.fullName,
    email: emp.email ?? '',
    phone: emp.phone ?? '',
    designation_id: designationId,
    designation_name: designationName,
    department_id: departmentId,
    department_name: departmentName,
  };
}

function mapFlowApprover(dbApprover, employeeMap) {
  const emp = employeeMap?.get(dbApprover.userId) ?? null;
  return {
    id: dbApprover.id,
    level_id: dbApprover.levelId,
    user_id: dbApprover.userId ?? '',
    role: dbApprover.role ?? '',
    organization_id: dbApprover.organizationId ?? '',
    employee: mapEmployee(emp) || undefined,
  };
}

function mapFlowLevel(level, employeeMap) {
  return {
    id: level.id,
    level: level.level,
    auto_approve_days: level.autoApproveDays ?? 3,
    escalation_role: level.escalationRole ?? '',
    is_active: level.isActive,
    approvers: (level.approvers || []).map((a) => mapFlowApprover(a, employeeMap)),
  };
}

function mapFlow(flow, employeeMap) {
  return {
    id: flow.id,
    organization_id: flow.organizationId,
    entity_type: flow.entityType,
    organization: mapOrganization(flow.organization) || undefined,
    levels: (flow.levels || []).map((lvl) => mapFlowLevel(lvl, employeeMap)),
    created_at: flow.createdAt?.toISOString() ?? '',
    updated_at: flow.updatedAt?.toISOString() ?? '',
  };
}

// ---------- Entity mappers ----------
function mapLeaveEntity(leave) {
  if (!leave) return {};
  return {
    id: leave.id,
    organization_id: leave.organizationId,
    employee_id: leave.employeeId,
    leave_type_id: leave.leaveTypeId,
    leave_type_name: leave.leaveType?.name ?? '',
    start_date: leave.startDate.toISOString(),
    end_date: leave.endDate.toISOString(),
    reason: leave.reason ?? '',
    status: leave.status,
  };
}

function mapRegularisationEntity(reg) {
  if (!reg) return {};
  return {
    id: reg.id,
    organization_id: reg.attendance?.organizationId ?? '',
    employee_id: reg.employeeId,
    attendance_id: reg.attendanceId,
    date: reg.attendance?.date?.toISOString() ?? '',
    reason: reg.reason,
    status: reg.status,
  };
}

function mapWorkdayEntity(w) {
  if (!w) return {};
  return {
    id: w.id,
    organization_id: w.organizationId,
    employee_id: w.employeeId,
    type: w.type,
    start_date: w.startDate?.toISOString() ?? '',
    end_date: w.endDate?.toISOString() ?? '',
    start_time: w.startTime?.toISOString() ?? '',
    end_time: w.endTime?.toISOString() ?? '',
    reason: w.reason ?? '',
    status: w.status,
  };
}

function mapLog(log, approverMap) {
  const approver = approverMap?.get(log.approverId) ?? null;
  return {
    id: log.id,
    approval_id: log.approvalId,
    organization_id: log.organizationId,
    entity_id: log.entityId,
    entity_type: log.entityType,
    level: log.level,
    approver_id: log.approverId ?? '',
    action: log.action,
    remarks: log.remarks ?? '',
    approved_at: log.approvedAt?.toISOString() ?? '',
    approver: mapEmployee(approver) || undefined,
  };
}

function mapInstance(instance, org, employee, entityData, logsMapped) {
  const { entityType } = instance;

  const leave = entityType === 'LEAVE' ? mapLeaveEntity(entityData) : {};
  const regularisation =
    entityType === 'REGULARISATION' ? mapRegularisationEntity(entityData) : {};
  const workday = entityType === 'WORKDAY' ? mapWorkdayEntity(entityData) : {};

  return {
    id: instance.id,
    organization_id: instance.organizationId,
    entity_id: instance.entityId,
    entity_type: instance.entityType,
    flow_id: instance.flowId,
    current_level: instance.currentLevel,
    status: instance.status,
    created_at: instance.createdAt?.toISOString() ?? '',
    updated_at: instance.updatedAt?.toISOString() ?? '',
    organization: mapOrganization(org) || undefined,
    employee: mapEmployee(employee) || undefined,
    leave,
    regularisation,
    workday,
    logs: logsMapped,
  };
}

// =======================================================
//  HELPERS
// =======================================================

// Load entity + includes based on entityType
async function loadEntityWithIncludes(entityType, entityId) {
  if (!isObjectId(entityId)) return null;

  if (entityType === 'LEAVE') {
    return prisma.leaveRequests.findFirst({
      where: { id: entityId, deletedAt: null },
      include: {
        leaveType: true,
      },
    });
  }

  if (entityType === 'REGULARISATION') {
    return prisma.attendanceRegularisation.findFirst({
      where: { id: entityId, deletedAt: null },
      include: {
        attendance: true,
      },
    });
  }

  if (entityType === 'WORKDAY') {
    return prisma.workdayRequests.findFirst({
      where: { id: entityId, deletedAt: null },
    });
  }

  return null;
}

// Load employee with org / designation / dept
async function loadEmployeeWithRelations(employeeId) {
  if (!employeeId || !isObjectId(employeeId)) return null;

  return prisma.organizationEmployees.findFirst({
    where: { id: employeeId, deletedAt: null },
    include: {
      designation: true,
      departmentAssignments: {
        include: { department: true },
        where: { OR: [{ endDate: null }, { endDate: { equals: null } }] },
      },
    },
  });
}

// Load approvers employees for logs (map)
async function buildApproverMap(logs) {
  const ids = Array.from(
    new Set(logs.map((l) => l.approverId).filter((id) => !!id && isObjectId(id)))
  );
  if (!ids.length) return new Map();

  const emps = await prisma.organizationEmployees.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      designation: true,
      departmentAssignments: {
        include: { department: true },
        where: { OR: [{ endDate: null }, { endDate: { equals: null } }] },
      },
    },
  });

  const map = new Map();
  emps.forEach((e) => map.set(e.id, e));
  return map;
}

// Build employee map for flow approvers
async function buildEmployeeMapFromLevels(levels) {
  const ids = Array.from(
    new Set(
      levels
        .flatMap((l) => l.approvers || [])
        .map((a) => a.userId)
        .filter((id) => !!id && isObjectId(id))
    )
  );
  if (!ids.length) return new Map();

  const emps = await prisma.organizationEmployees.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      designation: true,
      departmentAssignments: {
        include: { department: true },
        where: { OR: [{ endDate: null }, { endDate: { equals: null } }] },
      },
    },
  });
  const map = new Map();
  emps.forEach((e) => map.set(e.id, e));
  return map;
}

// =======================================================
//  FLOW SERVICE IMPLEMENTATION
// =======================================================
const flowImpl = {
  CreateFlow: async (call, callback) => {
    try {
      const { organization_id, entity_type, levels } = call.request;

      if (!isObjectId(organization_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid organization_id',
        });
      }
      if (!entity_type) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'entity_type is required',
        });
      }
      if (!levels || !levels.length) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'At least one level is required',
        });
      }

      const flow = await prisma.approvalFlows.create({
        data: {
          organizationId: organization_id,
          entityType: entity_type,
          levels: {
            create: levels.map((lvl) => ({
              level: lvl.level,
              autoApproveDays: lvl.auto_approve_days || 3,
              escalationRole: lvl.escalation_role || null,
              isActive: lvl.is_active ?? true,
              approvers: {
                create: (lvl.approvers || []).map((a) => ({
                  userId: a.user_id || null,
                  role: a.role || null,
                  organizationId: organization_id,
                })),
              },
            })),
          },
        },
        include: {
          organization: true,
          levels: { include: { approvers: true } },
        },
      });

      const employeeMap = await buildEmployeeMapFromLevels(flow.levels);
      const mapped = mapFlow(flow, employeeMap);

      callback(null, {
        flow: mapped,
        message: 'Approval flow created successfully',
        success: true,
      });
    } catch (e) {
      console.error('[CreateFlow Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  GetFlow: async (call, callback) => {
    try {
      const { id } = call.request;
      if (!isObjectId(id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid flow id',
        });
      }

      const flow = await prisma.approvalFlows.findFirst({
        where: { id, deletedAt: null },
        include: {
          organization: true,
          levels: { include: { approvers: true } },
        },
      });

      if (!flow) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Flow not found',
        });
      }

      const employeeMap = await buildEmployeeMapFromLevels(flow.levels);
      const mapped = mapFlow(flow, employeeMap);

      callback(null, {
        flow: mapped,
        message: 'Flow fetched successfully',
        success: true,
      });
    } catch (e) {
      console.error('[GetFlow Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  ListFlows: async (call, callback) => {
    try {
      const { organization_id, entity_type } = call.request;

      const where = {
        deletedAt: null,
        ...(organization_id ? { organizationId: organization_id } : {}),
        ...(entity_type ? { entityType: entity_type } : {}),
      };

      const flows = await prisma.approvalFlows.findMany({
        where,
        include: {
          organization: true,
          levels: { include: { approvers: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Build employee map for all levels across all flows
      const allLevels = flows.flatMap((f) => f.levels || []);
      const employeeMap = await buildEmployeeMapFromLevels(allLevels);

      const mapped = flows.map((f) => mapFlow(f, employeeMap));

      callback(null, {
        flows: mapped,
        success: true,
        message: 'Flows fetched successfully',
      });
    } catch (e) {
      console.error('[ListFlows Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  UpdateFlow: async (call, callback) => {
    try {
      const { id, levels } = call.request;
      if (!isObjectId(id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid flow id',
        });
      }
      if (!levels || !levels.length) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'At least one level is required',
        });
      }

      const existing = await prisma.approvalFlows.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Flow not found',
        });
      }

      // Delete old levels + approvers
      const oldLevels = await prisma.approvalFlowLevels.findMany({
        where: { flowId: id },
        select: { id: true },
      });
      const levelIds = oldLevels.map((l) => l.id);

      if (levelIds.length) {
        await prisma.approvalFlowApprovers.deleteMany({
          where: { levelId: { in: levelIds } },
        });
        await prisma.approvalFlowLevels.deleteMany({
          where: { flowId: id },
        });
      }

      // Re-create levels
      await prisma.approvalFlowLevels.createMany({
        data: levels.map((lvl) => ({
          flowId: id,
          level: lvl.level,
          autoApproveDays: lvl.auto_approve_days || 3,
          escalationRole: lvl.escalation_role || null,
          isActive: lvl.is_active ?? true,
        })),
      });

      // Need to re-fetch levels to get their IDs for approvers
      const newLevels = await prisma.approvalFlowLevels.findMany({
        where: { flowId: id },
      });

      const approverCreates = [];
      for (const lvl of levels) {
        const dbLevel = newLevels.find((nl) => nl.level === lvl.level);
        if (!dbLevel) continue;
        (lvl.approvers || []).forEach((a) => {
          approverCreates.push({
            levelId: dbLevel.id,
            userId: a.user_id || null,
            role: a.role || null,
            organizationId: existing.organizationId,
          });
        });
      }
      if (approverCreates.length) {
        await prisma.approvalFlowApprovers.createMany({ data: approverCreates });
      }

      const flow = await prisma.approvalFlows.findFirst({
        where: { id },
        include: {
          organization: true,
          levels: { include: { approvers: true } },
        },
      });

      const employeeMap = await buildEmployeeMapFromLevels(flow.levels);
      const mapped = mapFlow(flow, employeeMap);

      callback(null, {
        flow: mapped,
        message: 'Flow updated successfully',
        success: true,
      });
    } catch (e) {
      console.error('[UpdateFlow Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  DeleteFlow: async (call, callback) => {
    try {
      const { id } = call.request;
      if (!isObjectId(id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid flow id',
        });
      }

      const flow = await prisma.approvalFlows.findFirst({
        where: { id, deletedAt: null },
      });
      if (!flow) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Flow not found',
        });
      }

      await prisma.approvalFlows.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      callback(null, {
        success: true,
        message: 'Flow deleted successfully',
      });
    } catch (e) {
      console.error('[DeleteFlow Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },
};

// =======================================================
//  INSTANCE SERVICE IMPLEMENTATION
// =======================================================
const instanceImpl = {
  StartApproval: async (call, callback) => {
    try {
      const { organization_id, entity_id, entity_type, employee_id } = call.request;

      if (!isObjectId(organization_id) || !isObjectId(entity_id) || !isObjectId(employee_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid organization_id / entity_id / employee_id',
        });
      }
      if (!entity_type) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'entity_type is required',
        });
      }

      // get flow for org + entity_type
      const flow = await prisma.approvalFlows.findFirst({
        where: {
          organizationId: organization_id,
          entityType: entity_type,
          deletedAt: null,
        },
        include: {
          levels: {
            where: { isActive: true },
            orderBy: { level: 'asc' },
          },
        },
      });

      if (!flow || !flow.levels.length) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'No approval flow configured for this entity_type',
        });
      }

      const firstLevel = flow.levels[0];

      const instance = await prisma.approvalInstance.create({
        data: {
          organizationId: organization_id,
          entityId: entity_id,
          entityType: entity_type,
          flowId: flow.id,
          currentLevel: firstLevel.level,
          status: 'PENDING',
        },
      });

      await prisma.approvalLogs.create({
        data: {
          approvalId: instance.id,
          organizationId: organization_id,
          entityId: entity_id,
          entityType: entity_type,
          level: firstLevel.level,
          approverId: null,
          action: 'INITIATED',
          remarks: null,
        },
      });

      const org = await prisma.organizations.findFirst({ where: { id: organization_id } });
      const employee = await loadEmployeeWithRelations(employee_id);
      const entityData = await loadEntityWithIncludes(entity_type, entity_id);
      const logs = await prisma.approvalLogs.findMany({
        where: { approvalId: instance.id },
        orderBy: { approvedAt: 'asc' },
      });
      const approverMap = await buildApproverMap(logs);
      const logsMapped = logs.map((l) => mapLog(l, approverMap));

      const mappedInstance = mapInstance(instance, org, employee, entityData, logsMapped);

      callback(null, {
        approval: mappedInstance,
        success: true,
        message: 'Approval started successfully',
      });
    } catch (e) {
      console.error('[StartApproval Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  GetApproval: async (call, callback) => {
    try {
      const { id } = call.request;
      if (!isObjectId(id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid approval id',
        });
      }

      const instance = await prisma.approvalInstance.findFirst({
        where: { id },
      });
      if (!instance) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Approval not found',
        });
      }

      const org = await prisma.organizations.findFirst({
        where: { id: instance.organizationId },
      });

      // We take employee from entity
      let entity;
      let employeeId = null;

      if (instance.entityType === 'LEAVE') {
        entity = await prisma.leaveRequests.findFirst({
          where: { id: instance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (instance.entityType === 'REGULARISATION') {
        entity = await prisma.attendanceRegularisation.findFirst({
          where: { id: instance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (instance.entityType === 'WORKDAY') {
        entity = await prisma.workdayRequests.findFirst({
          where: { id: instance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      }

      const employee = employeeId ? await loadEmployeeWithRelations(employeeId) : null;
      const entityData = await loadEntityWithIncludes(
        instance.entityType,
        instance.entityId
      );

      const logs = await prisma.approvalLogs.findMany({
        where: { approvalId: instance.id },
        orderBy: { approvedAt: 'asc' },
      });
      const approverMap = await buildApproverMap(logs);
      const logsMapped = logs.map((l) => mapLog(l, approverMap));

      const mappedInstance = mapInstance(instance, org, employee, entityData, logsMapped);

      callback(null, {
        approval: mappedInstance,
        success: true,
        message: 'Approval fetched successfully',
      });
    } catch (e) {
      console.error('[GetApproval Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  Approve: async (call, callback) => {
    try {
      const { id, approver_id, remarks } = call.request;

      if (!isObjectId(id) || !isObjectId(approver_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid approval id or approver_id',
        });
      }

      const instance = await prisma.approvalInstance.findFirst({ where: { id } });
      if (!instance) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Approval not found',
        });
      }

      const flow = await prisma.approvalFlows.findFirst({
        where: { id: instance.flowId },
        include: {
          levels: {
            where: { isActive: true },
            orderBy: { level: 'asc' },
          },
        },
      });

      if (!flow) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Flow not found for this approval',
        });
      }

      const currentLevel = instance.currentLevel;
      const levels = flow.levels || [];
      const maxLevel = levels.reduce((m, l) => Math.max(m, l.level), 0);

      // Log APPROVED for current level
      await prisma.approvalLogs.create({
        data: {
          approvalId: instance.id,
          organizationId: instance.organizationId,
          entityId: instance.entityId,
          entityType: instance.entityType,
          level: currentLevel,
          approverId: approver_id,
          action: 'APPROVED',
          remarks: remarks || null,
        },
      });

      let newStatus = instance.status;
      let newLevel = currentLevel;

      if (currentLevel >= maxLevel) {
        newStatus = 'COMPLETED';
      } else {
        // move to next level
        const nextLevel = levels.find((l) => l.level > currentLevel);
        if (nextLevel) {
          newLevel = nextLevel.level;
          newStatus = 'IN_PROGRESS';

          await prisma.approvalLogs.create({
            data: {
              approvalId: instance.id,
              organizationId: instance.organizationId,
              entityId: instance.entityId,
              entityType: instance.entityType,
              level: nextLevel.level,
              approverId: null,
              action: 'MOVED_TO_NEXT_LEVEL',
              remarks: null,
            },
          });
        } else {
          newStatus = 'COMPLETED';
        }
      }

      const updatedInstance = await prisma.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentLevel: newLevel,
          status: newStatus,
        },
      });

      const org = await prisma.organizations.findFirst({
        where: { id: updatedInstance.organizationId },
      });

      // entity to get employee
      let entity;
      let employeeId = null;

      if (updatedInstance.entityType === 'LEAVE') {
        entity = await prisma.leaveRequests.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (updatedInstance.entityType === 'REGULARISATION') {
        entity = await prisma.attendanceRegularisation.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (updatedInstance.entityType === 'WORKDAY') {
        entity = await prisma.workdayRequests.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      }

      const employee = employeeId ? await loadEmployeeWithRelations(employeeId) : null;
      const entityData = await loadEntityWithIncludes(
        updatedInstance.entityType,
        updatedInstance.entityId
      );

      const logs = await prisma.approvalLogs.findMany({
        where: { approvalId: updatedInstance.id },
        orderBy: { approvedAt: 'asc' },
      });
      const approverMap = await buildApproverMap(logs);
      const logsMapped = logs.map((l) => mapLog(l, approverMap));

      const mappedInstance = mapInstance(
        updatedInstance,
        org,
        employee,
        entityData,
        logsMapped
      );

      callback(null, {
        approval: mappedInstance,
        success: true,
        message: `Approval ${newStatus}`,
      });
    } catch (e) {
      console.error('[Approve Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  Reject: async (call, callback) => {
    try {
      const { id, approver_id, remarks } = call.request;
      if (!isObjectId(id) || !isObjectId(approver_id)) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Invalid approval id or approver_id',
        });
      }

      const instance = await prisma.approvalInstance.findFirst({
        where: { id },
      });
      if (!instance) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Approval not found',
        });
      }

      await prisma.approvalLogs.create({
        data: {
          approvalId: instance.id,
          organizationId: instance.organizationId,
          entityId: instance.entityId,
          entityType: instance.entityType,
          level: instance.currentLevel,
          approverId: approver_id,
          action: 'REJECTED',
          remarks: remarks || null,
        },
      });

      const updatedInstance = await prisma.approvalInstance.update({
        where: { id: instance.id },
        data: {
          status: 'REJECTED',
        },
      });

      const org = await prisma.organizations.findFirst({
        where: { id: updatedInstance.organizationId },
      });

      let entity;
      let employeeId = null;

      if (updatedInstance.entityType === 'LEAVE') {
        entity = await prisma.leaveRequests.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (updatedInstance.entityType === 'REGULARISATION') {
        entity = await prisma.attendanceRegularisation.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      } else if (updatedInstance.entityType === 'WORKDAY') {
        entity = await prisma.workdayRequests.findFirst({
          where: { id: updatedInstance.entityId },
          include: { employee: true },
        });
        employeeId = entity?.employeeId ?? null;
      }

      const employee = employeeId ? await loadEmployeeWithRelations(employeeId) : null;
      const entityData = await loadEntityWithIncludes(
        updatedInstance.entityType,
        updatedInstance.entityId
      );

      const logs = await prisma.approvalLogs.findMany({
        where: { approvalId: updatedInstance.id },
        orderBy: { approvedAt: 'asc' },
      });
      const approverMap = await buildApproverMap(logs);
      const logsMapped = logs.map((l) => mapLog(l, approverMap));

      const mappedInstance = mapInstance(
        updatedInstance,
        org,
        employee,
        entityData,
        logsMapped
      );

      callback(null, {
        approval: mappedInstance,
        success: true,
        message: 'Approval Rejected',
      });
    } catch (e) {
      console.error('[Reject Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },

  ListPending: async (call, callback) => {
    try {
      const {
        organization_id,
        approver_id,
        page = 1,
        limit = 10,
      } = call.request;

      const skip = (page - 1) * limit;

      // We consider pending = status PENDING or IN_PROGRESS
      const whereInstance = {
        ...(organization_id ? { organizationId: organization_id } : {}),
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      };

      const total = await prisma.approvalInstance.count({ where: whereInstance });

      const instances = await prisma.approvalInstance.findMany({
        where: whereInstance,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      // Load all orgs, employees, entities and logs in batch-ish way
      const orgIds = Array.from(new Set(instances.map((i) => i.organizationId)));
      const orgs = await prisma.organizations.findMany({
        where: { id: { in: orgIds } },
      });
      const orgMap = new Map();
      orgs.forEach((o) => orgMap.set(o.id, o));

      // entity → employee
      const entityEmployeeMap = new Map();
      const entityDataMap = new Map();

      for (const inst of instances) {
        const entityData = await loadEntityWithIncludes(inst.entityType, inst.entityId);
        entityDataMap.set(inst.id, entityData);

        if (inst.entityType === 'LEAVE') {
          const leave = await prisma.leaveRequests.findFirst({
            where: { id: inst.entityId },
          });
          if (leave) entityEmployeeMap.set(inst.id, leave.employeeId);
        } else if (inst.entityType === 'REGULARISATION') {
          const reg = await prisma.attendanceRegularisation.findFirst({
            where: { id: inst.entityId },
          });
          if (reg) entityEmployeeMap.set(inst.id, reg.employeeId);
        } else if (inst.entityType === 'WORKDAY') {
          const wr = await prisma.workdayRequests.findFirst({
            where: { id: inst.entityId },
          });
          if (wr) entityEmployeeMap.set(inst.id, wr.employeeId);
        }
      }

      const employeeIds = Array.from(
        new Set(
          Array.from(entityEmployeeMap.values()).filter((id) => !!id && isObjectId(id))
        )
      );

      const employees = await prisma.organizationEmployees.findMany({
        where: { id: { in: employeeIds }, deletedAt: null },
        include: {
          designation: true,
          departmentAssignments: {
            include: { department: true },
            where: { OR: [{ endDate: null }, { endDate: { equals: null } }] },
          },
        },
      });
      const empMap = new Map();
      employees.forEach((e) => empMap.set(e.id, e));

      // logs per instance
      const instanceIds = instances.map((i) => i.id);
      const allLogs = await prisma.approvalLogs.findMany({
        where: { approvalId: { in: instanceIds } },
        orderBy: { approvedAt: 'asc' },
      });
      const approverMap = await buildApproverMap(allLogs);

      const logsByInstance = new Map();
      allLogs.forEach((log) => {
        if (!logsByInstance.has(log.approvalId)) logsByInstance.set(log.approvalId, []);
        logsByInstance.get(log.approvalId).push(log);
      });

      const approvals = [];
      for (const inst of instances) {
        // if approver_id filter → check if any log at current level is MOVED_TO_NEXT_LEVEL waiting for this approver
        if (approver_id && isObjectId(approver_id)) {
          // simple filter: only keep if there is a flow level where user is in approvers
          const flowLevels = await prisma.approvalFlowLevels.findMany({
            where: { flowId: inst.flowId, level: inst.currentLevel },
            include: { approvers: true },
          });
          const matchedLevel = flowLevels.find((lvl) =>
            lvl.approvers.some((a) => a.userId === approver_id)
          );
          if (!matchedLevel) continue;
        }

        const org = orgMap.get(inst.organizationId);
        const empId = entityEmployeeMap.get(inst.id);
        const emp = empId ? empMap.get(empId) : null;
        const entityData = entityDataMap.get(inst.id);
        const logs = logsByInstance.get(inst.id) || [];
        const logsMapped = logs.map((l) => mapLog(l, approverMap));

        approvals.push(mapInstance(inst, org, emp, entityData, logsMapped));
      }

      const totalPages = Math.ceil(total / limit);

      callback(null, {
        approvals,
        total,
        page,
        limit,
        total_pages: totalPages,
        success: true,
        message: 'Pending approvals fetched successfully',
      });
    } catch (e) {
      console.error('[ListPending Error]', e);
      callback({
        code: grpc.status.INTERNAL,
        message: e.message,
      });
    }
  },
};

// =======================================================
//  SERVER BOOTSTRAP
// =======================================================
async function main() {
  const server = new grpc.Server();

  server.addService(approvalProto.ApprovalFlowService.service, flowImpl);
  server.addService(approvalProto.ApprovalInstanceService.service, instanceImpl);

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve())
    );
  });

  console.log(`[approval-service] gRPC running on :${PORT}`);

  const shutdown = async (signal) => {
    console.log(`\n[approval-service] Received ${signal}, shutting down...`);
    try {
      server.tryShutdown(() => console.log('[approval-service] gRPC stopped.'));
      await prisma.$disconnect();
      console.log('[approval-service] Prisma disconnected.');
      process.exit(0);
    } catch (e) {
      console.error('[approval-service] Shutdown error:', e);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[approval-service] Fatal error:', err);
  process.exit(1);
});
