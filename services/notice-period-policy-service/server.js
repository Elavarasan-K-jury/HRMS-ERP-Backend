import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.NOTICE_PERIOD_POLICY_SERVICE_PORT || 5080);
const policyProto = loadProto('notice_period_policy');

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const VALID_DURATION_UNITS = ['DAYS', 'MONTHS'];

function validObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id || '');
}

function validatePolicyInput(data, isUpdate = false) {
    const errors = [];

    if (!isUpdate || data.title !== undefined) {
        if (!data.title || !data.title.trim()) {
            errors.push('Title is required.');
        } else if (data.title.trim().length > MAX_TITLE_LENGTH) {
            errors.push(`Title must be at most ${MAX_TITLE_LENGTH} characters.`);
        }
    }

    if (data.description !== undefined && data.description !== null) {
        if (data.description.trim().length > MAX_DESCRIPTION_LENGTH) {
            errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
        }
    }

    if (!isUpdate || data.duration_value !== undefined) {
        if (data.duration_value === undefined || data.duration_value === null || isNaN(Number(data.duration_value))) {
            errors.push('Duration value is required and must be a number.');
        } else if (Number(data.duration_value) <= 0) {
            errors.push('Duration value must be a positive number.');
        }
    }

    if (!isUpdate || data.duration_unit !== undefined) {
        if (!data.duration_unit || !VALID_DURATION_UNITS.includes(data.duration_unit)) {
            errors.push(`Duration unit must be one of: ${VALID_DURATION_UNITS.join(', ')}.`);
        }
    }

    return errors;
}

function mapPolicy(p = {}) {
    return {
        id: p.id ?? '',
        organization_id: p.organizationId ?? '',
        title: p.title ?? '',
        description: p.description ?? '',
        duration_value: p.durationValue ?? 0,
        duration_unit: p.durationUnit ?? 'DAYS',
        is_default: p.isDefault ?? false,
        status: p.status ?? 'ACTIVE',
        created_at: p.createdAt ? p.createdAt.toISOString() : '',
        updated_at: p.updatedAt ? p.updatedAt.toISOString() : '',
        employee_count: p.employeeCount ?? 0,
    };
}

async function getEmployeeCount(policyId) {
    const all = await prisma.noticePeriodPolicyEmployee.findMany({ where: { policyId }, include: { employee: true } });
    return all.filter(a => !a.deletedAt && a.employee && !a.employee.deletedAt).length;
}

async function handleDefaultPolicy(organizationId, newDefaultPolicyId, prismaTx = prisma) {
    if (!organizationId) return;
    if (newDefaultPolicyId) {
        await prismaTx.noticePeriodPolicy.updateMany({
            where: {
                organizationId,
                isDefault: true,
                id: { not: newDefaultPolicyId },
                deletedAt: null,
            },
            data: { isDefault: false, updatedAt: new Date() },
        });
    } else {
        // Creating a new default – clear any existing default before insert
        await prismaTx.noticePeriodPolicy.updateMany({
            where: {
                organizationId,
                isDefault: true,
                deletedAt: null,
            },
            data: { isDefault: false, updatedAt: new Date() },
        });
    }
}

const impl = {
    CreatePolicy: async (call, callback) => {
        try {
            const data = call.request;
            const errors = validatePolicyInput(data);
            if (errors.length > 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: errors.join(' '),
                });
            }

            if (!data.organization_id || !data.title) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id and title are required.',
                });
            }

            if (!validObjectId(data.organization_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid organization_id.',
                });
            }

            const title = data.title.trim();
            const description = data.description?.trim() || null;

            // Check for duplicate title within organization
            const existing = await prisma.noticePeriodPolicy.findFirst({
                where: {
                    organizationId: data.organization_id,
                    title: { equals: title, mode: 'insensitive' },
                    deletedAt: null,
                },
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'A policy with this title already exists in the organization.',
                });
            }

            // Handle default policy logic – ensure only one default per org
            if (data.is_default) {
                await handleDefaultPolicy(data.organization_id, null, prisma);
            }

            const policy = await prisma.noticePeriodPolicy.create({
                data: {
                    organizationId: data.organization_id,
                    title,
                    description,
                    durationValue: Number(data.duration_value),
                    durationUnit: data.duration_unit,
                    isDefault: data.is_default || false,
                    status: 'ACTIVE',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            const employeeCount = 0;

            callback(null, {
                policy: {
                    ...mapPolicy(policy),
                    employee_count: employeeCount,
                },
                message: 'Notice period policy created successfully',
                success: true,
            });
        } catch (e) {
            console.error('CreatePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetPolicy: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            const employeeCount = await getEmployeeCount(policy.id);

            callback(null, {
                policy: {
                    ...mapPolicy(policy),
                    employee_count: employeeCount,
                },
                message: 'Policy found successfully',
                success: true,
            });
        } catch (e) {
            console.error('GetPolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPolicies: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            let where = {};
            if (organization_id) {
                where = { organizationId: organization_id };
            }
            if (search) {
                where = {
                    ...where,
                    OR: [
                        { title: { contains: search, mode: 'insensitive' } },
                        { description: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }

            const validSortFields = {
                title: 'title',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.noticePeriodPolicy.count({
                where: { ...where, deletedAt: null },
            });

            const policies = await prisma.noticePeriodPolicy.findMany({
                where: { ...where, deletedAt: null },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const policyIds = policies.map(p => p.id);
            const employeeCounts = policyIds.length > 0
                ? await Promise.all(
                    policyIds.map(id => getEmployeeCount(id))
                )
                : [];

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                policies: policies.map((p, idx) => ({
                    ...mapPolicy(p),
                    employee_count: employeeCounts[idx] || 0,
                })),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Policies found successfully',
            });
        } catch (e) {
            console.error('ListPolicies Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdatePolicy: async (call, callback) => {
        try {
            const data = call.request;
            const errors = validatePolicyInput(data, true);
            if (errors.length > 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: errors.join(' '),
                });
            }

            if (!validObjectId(data.id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            const existing = await prisma.noticePeriodPolicy.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            // Check for duplicate title (excluding self)
            if (data.title !== undefined && data.title !== null) {
                const title = data.title.trim();
                const conflict = await prisma.noticePeriodPolicy.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                        deletedAt: null,
                        id: { not: data.id },
                        title: { equals: title, mode: 'insensitive' },
                    },
                });

                if (conflict) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: 'A policy with this title already exists in the organization.',
                    });
                }
            }

            const updateData = {
                updatedAt: new Date(),
            };

            if (data.title !== undefined && data.title !== null) {
                updateData.title = data.title.trim();
            }
            if (data.description !== undefined) {
                updateData.description = data.description?.trim() || null;
            }
            if (data.duration_value !== undefined) {
                updateData.durationValue = Number(data.duration_value);
            }
            if (data.duration_unit !== undefined) {
                updateData.durationUnit = data.duration_unit;
            }
            if (data.is_default !== undefined) {
                updateData.isDefault = data.is_default;
                if (data.is_default) {
                    await handleDefaultPolicy(existing.organizationId, data.id, prisma);
                }
            }

            const updated = await prisma.noticePeriodPolicy.update({
                where: { id: data.id },
                data: updateData,
            });

            const employeeCount = await getEmployeeCount(updated.id);

            callback(null, {
                policy: {
                    ...mapPolicy(updated),
                    employee_count: employeeCount,
                },
                message: 'Policy updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('UpdatePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeletePolicy: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            // Check if employees are assigned
            const employeeCount = await getEmployeeCount(policy.id);
            if (employeeCount > 0) {
                return callback({
                    code: grpc.status.FAILED_PRECONDITION,
                    message: `Cannot delete this policy because ${employeeCount} employee(s) are assigned to it.`,
                });
            }

            await prisma.noticePeriodPolicy.update({
                where: { id },
                data: {
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                    // Free the unique (organizationId, title) index
                    title: `${policy.title}__deleted__${Date.now()}`,
                },
            });

            callback(null, {
                success: true,
                message: 'Policy deleted successfully',
            });
        } catch (e) {
            console.error('DeletePolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    SetDefaultPolicy: async (call, callback) => {
        try {
            const { id, organization_id, is_default } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            if (is_default) {
                await handleDefaultPolicy(policy.organizationId || organization_id, id, prisma);
            }

            const updated = await prisma.noticePeriodPolicy.update({
                where: { id },
                data: { isDefault: is_default, updatedAt: new Date() },
            });

            callback(null, {
                policy: mapPolicy(updated),
                message: is_default ? 'Policy set as default' : 'Default policy unset',
                success: true,
            });
        } catch (e) {
            console.error('SetDefaultPolicy Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    // Employee assignment
    GetPolicyEmployees: async (call, callback) => {
        try {
            const { id, organization_id, page = 1, limit = 10, search = '' } = call.request;

            if (!validObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            const skip = (page - 1) * limit;

            // Fetch all assignments for this policy (small set) then apply search in JS for Mongo compatibility
            const rawAssignments = await prisma.noticePeriodPolicyEmployee.findMany({
                where: { policyId: id, ...(organization_id ? { organizationId: organization_id } : {}) },
                include: {
                    employee: {
                        include: {
                            designation: true,
                            departmentAssignments: {
                                where: { deletedAt: null },
                                include: { department: { include: { parent: true } } },
                            },
                        },
                    },
                },
            });
            const allAssignments = rawAssignments.filter(a => !a.deletedAt);

            let filtered = allAssignments.filter(a => a.employee && !a.employee.deletedAt)
            if (search) {
                const q = search.toLowerCase()
                filtered = filtered.filter(a => {
                    const e = a.employee
                    return (e.fullName || '').toLowerCase().includes(q) || (e.employeeCode || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q)
                })
            }
            const total = filtered.length
            const paged = filtered.slice(skip, skip + limit)
            const employees = paged.map(a => {
                const emp = a.employee;
                const deptAssignment = emp.departmentAssignments?.[0];
                const dept = deptAssignment?.department;
                let department = '';
                let sub_department = '';
                if (dept) {
                    if (dept.parent) {
                        department = dept.parent.name ?? '';
                        sub_department = dept.name ?? '';
                    } else {
                        department = dept.name ?? '';
                        sub_department = '';
                    }
                }
                return {
                    id: emp.id,
                    employee_code: emp.employeeCode ?? '',
                    full_name: emp.fullName ?? '',
                    email: emp.email ?? '',
                    designation: emp.designation?.name ?? '',
                    department,
                    sub_department,
                };
            });

            callback(null, {
                employees,
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: 'Employees found successfully',
            });
        } catch (e) {
            console.error('GetPolicyEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    AssignEmployees: async (call, callback) => {
        try {
            const { policy_id, organization_id, employee_ids } = call.request;

            if (!validObjectId(policy_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id',
                });
            }

            if (!employee_ids || employee_ids.length === 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'At least one employee_id is required.',
                });
            }

            // Verify policy exists and belongs to organization
            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id: policy_id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            // Verify all employees exist and belong to the same organization
            const employees = await prisma.organizationEmployees.findMany({
                where: { id: { in: employee_ids }, organizationId: organization_id || undefined, deletedAt: null },
                select: { id: true },
            });

            if (employees.length !== employee_ids.length) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'One or more employees not found or do not belong to the organization.',
                });
            }

            // Check existing assignments (filter deletedAt in JS due to Mongo null filter issue)
            const rawExisting = await prisma.noticePeriodPolicyEmployee.findMany({
                where: { policyId: policy_id, employeeId: { in: employee_ids } },
                select: { employeeId: true, deletedAt: true },
            });
            const existingAssignments = rawExisting.filter(a => !a.deletedAt);

            const existingEmployeeIds = new Set(existingAssignments.map(a => a.employeeId));
            const newEmployeeIds = employee_ids.filter(id => !existingEmployeeIds.has(id));

            if (newEmployeeIds.length > 0) {
                await prisma.noticePeriodPolicyEmployee.createMany({
                    data: newEmployeeIds.map(employeeId => ({
                        organizationId: policy.organizationId,
                        policyId: policy_id,
                        employeeId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })),
                });
            }

            callback(null, {
                assigned_count: newEmployeeIds.length,
                success: true,
                message: `${newEmployeeIds.length} employee(s) assigned to policy`,
            });
        } catch (e) {
            console.error('AssignEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RemoveEmployee: async (call, callback) => {
        try {
            const { policy_id, organization_id, employee_id } = call.request;

            if (!validObjectId(policy_id) || !validObjectId(employee_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid policy id or employee id',
                });
            }

            // Verify policy exists
            const policy = await prisma.noticePeriodPolicy.findFirst({
                where: { id: policy_id, organizationId: organization_id || undefined, deletedAt: null },
            });

            if (!policy) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Policy not found',
                });
            }

            // Soft delete the assignment (update all matching, filter in JS then update by id)
            const toRemove = await prisma.noticePeriodPolicyEmployee.findMany({ where: { policyId: policy_id, employeeId: employee_id } });
            for (const r of toRemove.filter(x => !x.deletedAt)) {
                await prisma.noticePeriodPolicyEmployee.update({ where: { id: r.id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            }

            callback(null, {
                success: true,
                message: 'Employee removed from policy',
            });
        } catch (e) {
            console.error('RemoveEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('notice-period-policy-service');
    const server = new grpc.Server();
    server.addService(policyProto.NoticePeriodPolicyService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[notice-period-policy-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[notice-period-policy-service] Received ${signal}, shutting down...`);
        try {
            server.tryShutdown(() => console.log('[notice-period-policy-service] gRPC stopped.'));
            await prisma.$disconnect();
            console.log('[notice-period-policy-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[notice-period-policy-service] Shutdown error:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[notice-period-policy-service] Fatal error:', err);
    process.exit(1);
});
