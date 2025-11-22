import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';

const PORT = process.env.ORG_SERVICE_PORT || 50051;
const organizationProto = loadProto('organization');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */
const impl = {
    DepartmentHierarchy: async (call, callback) => {
        try {
            const { department_id, organization_id } = call.request;

            if (!organization_id || !department_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id and department_id are required",
                });
            }

            // 1. Fetch department with head info
            const department = await prisma.organizationDepartments.findUnique({
                where: { id: department_id },
                select: {
                    departmentHeadId: true,
                    createdAt: true
                }
            });

            // 2. Fetch all employees assigned to this department
            const assignments = await prisma.employeeDepartments.findMany({
                where: {
                    departmentId: department_id,
                    deletedAt: null,
                    employee: {
                        deletedAt: null
                    }
                },
                include: {
                    employee: {
                        include: {
                            designation: true,
                            category: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                }
            });

            // 3. Fetch department head (if not in assignments)
            let departmentHead = null;
            if (department?.departmentHeadId) {
                departmentHead = await prisma.organizationEmployees.findUnique({
                    where: {
                        id: department.departmentHeadId,
                        deletedAt: null
                    },
                    include: {
                        designation: true,
                        category: true
                    }
                });
            }

            // 4. Build employee map
            const employeeMap = {};

            // Add head first (if exists)
            if (departmentHead) {
                employeeMap[departmentHead.id] = {
                    id: departmentHead.id,
                    full_name: departmentHead.fullName,
                    email: departmentHead.email,
                    phone: departmentHead.phone,
                    employee_code: departmentHead.employeeCode,
                    designation: departmentHead.designation?.name || null,
                    category: departmentHead.category?.name || null,
                    organization_id: departmentHead.organizationId,
                    profile: departmentHead.profilePicture || null,
                    reportingTo: null,
                    reportees: [],
                    isHead: true
                };
            }

            // Add all employees from department assignments
            assignments.forEach(a => {
                const emp = a.employee;

                // Skip if already added (head)
                if (employeeMap[emp.id]) {
                    if (a.reportingTo) {
                        employeeMap[emp.id].reportingTo = a.reportingTo;
                    }
                    return;
                }

                employeeMap[emp.id] = {
                    id: emp.id,
                    full_name: emp.fullName,
                    email: emp.email,
                    phone: emp.phone,
                    employee_code: emp.employeeCode,
                    designation: emp.designation?.name || null,
                    category: emp.category?.name || null,
                    organization_id: emp.organizationId,
                    profile: emp.profilePicture || null,
                    reportingTo: a.reportingTo,
                    reportees: [],
                    isHead: false
                };
            });

            // 5. If no employees, return empty hierarchy
            if (Object.keys(employeeMap).length === 0) {
                return callback(null, {
                    type: "DEPARTMENT_REPORTING_HIERARCHY",
                    department_id,
                    hierarchy: null
                });
            }

            // 6. Determine actual head
            let headId = null;

            if (department?.departmentHeadId && employeeMap[department.departmentHeadId]) {
                headId = department.departmentHeadId;
            } else {
                const firstEmployee = assignments[0]?.employeeId;

                if (firstEmployee && employeeMap[firstEmployee]) {
                    headId = firstEmployee;
                    employeeMap[firstEmployee].isHead = true;
                    employeeMap[firstEmployee].reportingTo = null;
                } else {
                    const noReportingTo = Object.values(employeeMap).find(e => !e.reportingTo);
                    if (noReportingTo) {
                        headId = noReportingTo.id;
                        noReportingTo.isHead = true;
                    }
                }
            }

            // 7. Build initial parent-child relationships
            Object.values(employeeMap).forEach(emp => {
                if (emp.reportingTo && employeeMap[emp.reportingTo]) {
                    employeeMap[emp.reportingTo].reportees.push(emp);
                }
            });

            // 7b. Attach orphan employees (no reportingTo and not head)
            Object.values(employeeMap).forEach(emp => {
                // Skip head always
                if (emp.id === headId) return;

                // If this employee has NO parent AND is not head
                const hasParent = emp.reportingTo && employeeMap[emp.reportingTo];

                if (!hasParent) {
                    emp.reportingTo = headId;
                    employeeMap[headId].reportees.push(emp);
                }
            });


            // 8. Recursive builder (tree)
            function buildTree(node) {
                return {
                    ...node,
                    reportees: node.reportees.map(buildTree)
                };
            }

            // 9. Final hierarchy
            const head = employeeMap[headId];

            if (!head) {
                return callback(null, {
                    type: "DEPARTMENT_REPORTING_HIERARCHY",
                    department_id,
                    hierarchy: null,
                    employees: Object.values(employeeMap)
                });
            }

            const hierarchy = buildTree(head);

            function cleanNode(node) {
                return {
                    id: node.id,
                    full_name: node.full_name,
                    email: node.email,
                    phone: node.phone,
                    employee_code: node.employee_code,
                    designation: node.designation,
                    category: node.category,
                    reportees: node.reportees.map(cleanNode)
                };
            }

            return callback(null, {
                type: "DEPARTMENT_REPORTING_HIERARCHY",
                department_id,
                head_id: headId,
                hierarchy: cleanNode(hierarchy),
            });

        } catch (e) {
            console.error("DepartmentHierarchy Error:", e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message
            });
        }
    },

    OrganizationHierarchy: async (call, callback) => {
        try {
            const { organization_id } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id is required",
                });
            }

            // -- Designation Level Ordering (your provided list) --
            const LEVEL_ORDER = [
                "board_level",
                "executive_level",
                "senior_management",
                "managerial_level",
                "lead_level",
                "senior_level",
                "intermediate_level",
                "junior_level",
                "entry_level",
            ];

            const LEVEL_LABELS = {
                entry_level: "Entry Level",
                junior_level: "Junior Level",
                intermediate_level: "Intermediate / Associate Level",
                senior_level: "Senior / Specialist Level",
                lead_level: "Lead / Supervisor Level",
                managerial_level: "Managerial Level",
                senior_management: "Senior Management",
                executive_level: "Executive Level",
                board_level: "Board / Governance Level",
            };

            // 🟦 Base filters
            const baseFilters = {
                deletedAt: null,
            };

            // 🟩 Fetch all designations for the org
            const designations = await prisma.organizationDesignations.findMany({
                where: {
                    organizationId: organization_id,
                    ...baseFilters,
                },
                orderBy: { name: "asc" },
            });

            // 🟧 Fetch all employees in the org
            const employees = await prisma.organizationEmployees.findMany({
                where: {
                    organizationId: organization_id,
                    ...baseFilters,
                },
                include: {
                    designation: true,
                    departmentAssignments: {
                        include: {
                            department: true,
                        },
                    },
                    category: true,
                },
            });

            // org-wide, no department filter
            const filteredEmployees = employees;

            // 🟨 Build hierarchy based on your LEVEL_ORDER
            const hierarchy = LEVEL_ORDER.map((levelValue) => {
                const label = LEVEL_LABELS[levelValue];

                const levelDesignations = designations.filter(
                    (d) => d.level === levelValue
                );

                const levelEmployees = filteredEmployees.filter(
                    (emp) => emp.designation?.level === levelValue
                );

                return {
                    level: levelValue,
                    label,
                    designationCount: levelDesignations.length,
                    employeeCount: levelEmployees.length,
                    designations: levelDesignations.map((d) => ({
                        id: d.id,
                        name: d.name,
                        department_id: d.departmentId,
                        description: d.description || "",
                    })),
                    employees: levelEmployees.map((e) => ({
                        id: e.id,
                        full_name: e.fullName,
                        email: e.email,
                        phone: e.phone,
                        employee_code: e.employeeCode,
                        department: e.departmentAssignments[0]?.department?.name || null,
                        category: e.category?.name || null,
                        designation: e.designation?.name || null,
                    })),
                };
            });

            // match proto: OrganizationHierarchyResponse { organization_id, levels }
            return callback(null, {
                organization_id,
                levels: hierarchy,
            });
        } catch (e) {
            console.log("OrganizationHierarchy Error:", e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message || "Internal error",
            });
        }
    },


    /* ------------------------------------------------------------------ */
    /* 🟢 Create Organization                                             */
    /* ------------------------------------------------------------------ */
    CreateOrganization: async (call, callback) => {
        try {
            const data = call.request;

            const domainExists = await prisma.organizations.findUnique({
                where: { domain: data.domain },
            });

            const mappedData = {
                name: data.name,
                domain: data.domain,
                GSTNumber: data.gst_number ?? null,
                email: data.email ?? null,
                contactPersonName: data.contact_person_name ?? null,
                contactPersonNumber: data.contact_person_number ?? null,
                note: data.note ?? null,
                industry: data.industry ?? null,
                size: data.size ?? null,
                address:
                    typeof data.address === 'string'
                        ? JSON.parse(data.address)
                        : data.address ?? null,

                // ✅ new fields
                maxEmployees: data.max_employees ?? 20,
                maxStorageInGB: data.max_storage_in_gb ?? 10,
                maxApiRatePerMin: data.max_api_rate_per_minute ?? 1000,
                maxPayrollRunsPerMonth: data.max_payroll_runs_per_month ?? 1,
                maxLeavePolicies: data.max_leave_policies ?? 5,
                maxAdminAccounts: data.max_admin_accounts ?? 3,

                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            };

            if (domainExists && domainExists.deletedAt === null) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Domain already exists',
                });
            }

            // Restore soft-deleted org if domain matches
            if (domainExists && domainExists.deletedAt !== null) {
                const restored = await prisma.organizations.update({
                    where: { id: domainExists.id },
                    data: mappedData,
                });
                return callback(null, {
                    organization: mapOrg(restored),
                    success: true,
                    message: 'Organization restored successfully',
                });
            }

            const org = await prisma.organizations.create({ data: mappedData });
            callback(null, {
                organization: mapOrg(org),
                success: true,
                message: 'Organization created successfully',
            });
        } catch (e) {
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟣 Get Organization by ID                                           */
    /* ------------------------------------------------------------------ */
    GetOrganization: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id))
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid organization id',
                });

            const org = await prisma.organizations.findUnique({
                where: { id, deletedAt: null },
            });

            if (!org)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            callback(null, { organization: mapOrg(org), success: true });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔵 List Organizations                                               */
    /* ------------------------------------------------------------------ */
    ListOrganizations: async (call, callback) => {
        try {
            const {
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'createdAt',
                sort_order = 'desc',
            } = call.request;

            const skip = (page - 1) * limit;

            const where = {
                deletedAt: null,
                OR: search
                    ? [
                        { name: { contains: search, mode: 'insensitive' } },
                        { domain: { contains: search, mode: 'insensitive' } },
                        { industry: { contains: search, mode: 'insensitive' } },
                    ]
                    : undefined,
            };

            const validSortFields = {
                name: 'name',
                domain: 'domain',
                industry: 'industry',
                size: 'size',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const sortOrder = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizations.count({ where });

            const orgs = await prisma.organizations.findMany({
                where,
                orderBy: { [sortField]: sortOrder },
                skip,
                take: limit,
            });

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                organizations: orgs.map(mapOrg),
                total,
                page,
                limit,
                total_pages: totalPages,
                success: true,
                message: 'Organizations fetched successfully',
            });
        } catch (e) {
            console.log('server.js @ Line 173:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟠 Update Organization                                              */
    /* ------------------------------------------------------------------ */
    UpdateOrganization: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.organizations.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            const updated = await prisma.organizations.update({
                where: { id: data.id },
                data: {
                    name: data.name ?? existing.name,
                    domain: data.domain ?? existing.domain,
                    GSTNumber: data.gst_number ?? existing.GSTNumber,
                    email: data.email ?? existing.email,
                    contactPersonName:
                        data.contact_person_name ?? existing.contactPersonName,
                    contactPersonNumber:
                        data.contact_person_number ?? existing.contactPersonNumber,
                    note: data.note ?? existing.note,
                    industry: data.industry ?? existing.industry,
                    size: data.size ?? existing.size,
                    address:
                        typeof data.address === 'string'
                            ? JSON.parse(data.address)
                            : data.address ?? existing.address,

                    // ✅ updated fields
                    maxEmployees: data.max_employees ?? existing.maxEmployees,
                    maxStorageInGB: data.max_storage_in_gb ?? existing.maxStorageInGB,
                    maxApiRatePerMin:
                        data.max_api_rate_per_minute ?? existing.maxApiRatePerMin,
                    maxPayrollRunsPerMonth:
                        data.max_payroll_runs_per_month ??
                        existing.maxPayrollRunsPerMonth,
                    maxLeavePolicies:
                        data.max_leave_policies ?? existing.maxLeavePolicies,
                    maxAdminAccounts:
                        data.max_admin_accounts ?? existing.maxAdminAccounts,

                    updatedAt: new Date(),
                },
            });

            callback(null, {
                organization: mapOrg(updated),
                success: true,
                message: 'Organization updated successfully',
            });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔴 Soft Delete Organization                                        */
    /* ------------------------------------------------------------------ */
    DeleteOrganization: async (call, callback) => {
        try {
            const { id } = call.request;
            const org = await prisma.organizations.findUnique({
                where: { id, deletedAt: null },
            });

            if (!org)
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });

            await prisma.organizations.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Organization soft-deleted successfully',
            });
        } catch (e) {
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ------------------------------------------------------------------ */
/* 🧭 Mapper                                                          */
/* ------------------------------------------------------------------ */
function mapOrg(org) {
    return {
        id: org.id,
        name: org.name,
        domain: org.domain,
        gst_number: org.GSTNumber ?? '',
        email: org.email ?? '',
        contact_person_name: org.contactPersonName ?? '',
        contact_person_number: org.contactPersonNumber ?? '',
        note: org.note ?? '',
        industry: org.industry ?? '',
        size: org.size ?? 0,
        address: org.address ? JSON.stringify(org.address) : '',
        created_at: org.createdAt?.toISOString() ?? '',
        updated_at: org.updatedAt?.toISOString() ?? '',
        deleted_at: org.deletedAt?.toISOString() ?? '',

        // ✅ new fields
        max_employees: org.maxEmployees ?? 20,
        max_storage_in_gb: org.maxStorageInGB ?? 10,
        max_api_rate_per_minute: org.maxApiRatePerMin ?? 1000,
        max_payroll_runs_per_month: org.maxPayrollRunsPerMonth ?? 1,
        max_leave_policies: org.maxLeavePolicies ?? 5,
        max_admin_accounts: org.maxAdminAccounts ?? 3,
    };
}

/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    await checkDbConnection('organization-service');
    const server = new grpc.Server();

    server.addService(organizationProto.OrganizationService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[organization-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[organization-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[organization-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[organization-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[organization-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[organization-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[organization-service] Fatal error:', err);
    process.exit(1);
});
