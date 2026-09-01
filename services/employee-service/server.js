import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { sendOtpEmail, sendOnboardEmail } from '@jury-hrms/mailer';
import dotenv from 'dotenv';
dotenv.config();
import { signAccessToken, signRefreshToken, verifyToken, getAccessExpiresIn } from '@jury-hrms/auth/jwt.js';

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000); // default 5 min

const PORT = Number(process.env.EMP_SERVICE_PORT || 5053);
const employeeProto = loadProto('employee');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */

function genOtp() {
    // Keep the predictable OTP for local/development testing only. Production
    // always uses a randomly generated six-digit OTP.
    const env = (process.env.NODE_ENV || process.env.ENVIRONMENT || 'development').toLowerCase();
    if (env !== 'production') return '123456';
    return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

function normEmail(email) {
    return (email || '').trim().toLowerCase();
}
function normPhone(phone) {
    return (phone || '').trim();
}

// Parse a JSON-stringified address (from gRPC) into an object for Prisma.
// Returns null for empty/invalid input so Prisma stores a null JSON field.
function parseAddressJson(str) {
    if (!str || typeof str !== 'string' || !str.trim()) return null;
    try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function getAuthenticationType({ email }) {
    return normEmail(email) ? 'Basic' : 'Mobile OTP';
}

async function findEmployeeByEMailOrPhone({ email, phone }) {
    const e = normEmail(email);
    const p = normPhone(phone);
    const activeEmployee = { deletedAt: null, isActive: true };
    if (e) return await prisma.organizationEmployees.findFirst({ where: { ...activeEmployee, email: e } });
    if (p) return await prisma.organizationEmployees.findFirst({ where: { ...activeEmployee, phone: p } });
    return null;
}

// 📝 Record an employee login attempt (SUCCESS or FAILED) for the audit trail
// shown in Admin → Employee → Login (Login History / Failed Logins).
async function logLogin({ employee, email, phone, status, issue, authenticationType, ipAddress, userAgent }) {
    try {
        await prisma.loginLogs.create({
            data: {
                employeeId: employee?.id || null,
                organizationId: employee?.organizationId || null,
                status,
                issue: issue || null,
                authenticationType: authenticationType || null,
                email: email ? normEmail(email) : employee?.email || null,
                phone: phone ? normPhone(phone) : employee?.phone || null,
                ipAddress: ipAddress || null,
                userAgent: userAgent || null,
                deletedAt: null,
            },
        });
    } catch (e) {
        console.error('[login-logs] Failed to record login attempt:', e.message);
    }
}

async function getDepartmentWithChildren(departmentId) {
    const ids = departmentId.split(',').map(s => s.trim()).filter(Boolean)
    const allIds = []
    for (const id of ids) {
        allIds.push(id)
        const children = await prisma.organizationDepartments.findMany({
            where: { parentId: id, deletedAt: null },
            select: { id: true }
        })
        for (const child of children) {
            const descendants = await getDepartmentWithChildren(child.id)
            allIds.push(...descendants)
        }
    }
    return [...new Set(allIds)]
}

function mapNumberSeries(series) {
    if (!series) return null;
    const number = String(series.nextNumber ?? 1).padStart(series.digits || 1, '0');
    return {
        id: series.id,
        organization_id: series.organizationId,
        name: series.name,
        prefix: series.prefix || '',
        digits: series.digits,
        suffix: series.suffix || '',
        next_number: series.nextNumber,
        is_active: series.isActive,
        policy_type: series.policyType ?? 'PROBATION',
        preview: `${series.prefix || ''}${number}${series.suffix || ''}`,
        created_at: formatDate(series.createdAt),
        updated_at: formatDate(series.updatedAt),
    };
}
// Compute the probation end date from the joining date + applied policy.
// Returns null when there is no joining date or no policy.
function computeProbationEndDate({ joining_date }, policy) {
    if (!joining_date || !policy) return null;
    const start = new Date(joining_date + 'T00:00:00');
    if (Number.isNaN(start.getTime())) return null;
    const end = calculateProbationEndDate(
        start,
        policy.durationValue,
        policy.durationUnit,
        policy.endDateAfterCompletion ?? false,
    );
    return end || null;
}
const impl = {
    CreateEmployee: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.designation_id || !data.phone || (!data.category_id && !data.is_permanent)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, designation_id, category_id, and phone are required. (category can be skipped for permanent employees)',
                });
            }

            const organizationExists = await prisma.organizations.findFirst({
                where: { id: data.organization_id, deletedAt: null },
            });

            if (!organizationExists) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            const addedEmployees = await prisma.organizationEmployees.count({
                where: {
                    deletedAt: null,
                    organizationId: data.organization_id,
                }
            })

            if (organizationExists.maxEmployees <= addedEmployees) {
                return callback({
                    code: grpc.status.OUT_OF_RANGE,
                    message: 'Employee adding limit exceeded. Contact support.',
                });
            }
            const admins = await prisma.organizationEmployees.count({
                where: {
                    deletedAt: null,
                    organizationId: data.organization_id,
                    isAdmin: true
                }
            })

            if (organizationExists.maxAdminAccounts <= admins) {
                return callback({
                    code: grpc.status.OUT_OF_RANGE,
                    message: 'Admins adding limit exceeded. Contact support.',
                });
            }

            // Validate designation if provided
            let designationExists = null
            if (data.designation_id) {
                designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                    include: { band: true },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
            }

            // Band is synchronized from the Designation's mapped Band. The
            // frontend-supplied band_id must match, otherwise reject.
            const effectiveBandId = designationExists?.bandId || null
            if (data.band_id && data.band_id !== effectiveBandId) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Band must match the band mapped to the selected designation.',
                });
            }

            let categoryExists = null;
            if (data.category_id) {
                categoryExists = await prisma.employeeCategories.findFirst({
                    where: {
                        id: data.category_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!categoryExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Category not found in organization.',
                    });
                }
            }

            let probationPolicyExists = null;
            if (data.probation_policy_id) {
                probationPolicyExists = await prisma.probationPolicies.findFirst({
                    where: {
                        id: data.probation_policy_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!probationPolicyExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Probation policy not found in organization.',
                    });
                }
            }

            if (data.pay_grade_id) {
                const payGradeExists = await prisma.payGrades.findFirst({
                    where: {
                        id: data.pay_grade_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!payGradeExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Pay grade not found in the employee\'s organization.',
                    });
                }
            }

            // Validate notice period policy if provided
            let noticePeriodPolicyExists = null;
            if (data.notice_period_policy_id) {
                noticePeriodPolicyExists = await prisma.noticePeriodPolicy.findFirst({
                    where: {
                        id: data.notice_period_policy_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!noticePeriodPolicyExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Notice period policy not found in organization.',
                    });
                }
            }

            const emailExists = await prisma.organizationEmployees.findFirst({
                where: {
                    organizationId: data.organization_id,
                    email: data.email,
                    deletedAt: null,
                },
            });

            if (emailExists) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Employee with this email already exists in organization.',
                });
            }

            if (data.email == organizationExists.email) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: 'Employee with this email already exists in organization.',
                });
            }


            let series = null;
            if (data.number_series_id) {
                series = await prisma.employeeNumberSeries.findFirst({
                    where: {
                        id: data.number_series_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                        isActive: true,
                    },
                });
                if (!series) {
                    return callback({ code: grpc.status.NOT_FOUND, message: 'Employee number series not found or inactive.' });
                }
            } else {
                series = await prisma.employeeNumberSeries.findFirst({
                    where: {
                        organizationId: data.organization_id,
                        deletedAt: null,
                        isActive: true,
                    },
                    orderBy: { createdAt: 'asc' },
                });
            }

            let employeeCode = null;
            if (series) {
                const number = String(series.nextNumber).padStart(series.digits || 1, '0');
                employeeCode = `${series.prefix || ''}${number}${series.suffix || ''}`;
                await prisma.employeeNumberSeries.update({
                    where: { id: series.id },
                    data: { nextNumber: series.nextNumber + 1 },
                });
            }
            if (data.employee_code && String(data.employee_code).trim()) {
                employeeCode = String(data.employee_code).trim();
            }


            const mappedData = {
                organizationId: data.organization_id,
                categoryId: data.category_id || null,
                designationId: data.designation_id || null,
                employeeCode,
                managerId: data.manager_id || null,
                branchId: data.branch_id || null,
                locationId: data.location_id || null,
                firstName: data.first_name || null,
                lastName: data.last_name || null,
                fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                email: data.email || null,
                phone: data.phone,
                isAdmin: data.is_admin || false,
                isActive: data.is_active !== undefined ? data.is_active : true,
                altPhone: data.alt_phone || null,
                gender: data.gender ? data.gender.toUpperCase() : 'OTHER',
                dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth + 'T00:00:00') : new Date(),
                joiningDate: data.joining_date ? new Date(data.joining_date + 'T00:00:00') : null,
                displayName: data.display_name || null,
                maritalStatus: data.marital_status || null,
                bloodGroup: data.blood_group || null,
                physicallyHandicapped: Boolean(data.physically_handicapped),
                nationality: data.nationality || null,
                personalEmail: data.personal_email || null,
                professionalSummary: data.professional_summary || null,
                currentAddress: parseAddressJson(data.current_address),
                permanentAddress: parseAddressJson(data.permanent_address),
                isPermanent: data.is_permanent || false,
                workerType: data.worker_type || null,
                probationPolicyId: data.probation_policy_id || null,
                probationStartDate: data.probation_start_date
                    ? new Date(data.probation_start_date + 'T00:00:00')
                    : ((data.probation_policy_id && data.joining_date)
                        ? new Date(data.joining_date + 'T00:00:00')
                        : null),
                probationEndDate: data.probation_end_date
                    ? new Date(data.probation_end_date + 'T00:00:00')
                    : computeProbationEndDate(data, probationPolicyExists),
                probationExtendedByMonths: 0,
                profileImage: data.profile_image || null,
                profileImageFileId: data.profile_image_file_id || null,
                costCenterId: data.cost_center_id || null,
                payGradeId: data.pay_grade_id || null,
                bandId: effectiveBandId,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };


            const employee = await prisma.organizationEmployees.create({
                data: mappedData,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                },
            });

            await prisma.organizations.update({
                where: { id: data.organization_id },
                data: { totalEmployee: organizationExists.totalEmployee + 1, activeEmployee: organizationExists.activeEmployee + 1 },
            });

            // Create notice period policy assignment if provided
            if (data.notice_period_policy_id && noticePeriodPolicyExists) {
                try {
                    // Hard-delete any stale record (including soft-deleted) to avoid unique constraint
                    await prisma.noticePeriodPolicyEmployee.deleteMany({
                        where: { policyId: data.notice_period_policy_id, employeeId: employee.id },
                    });
                    await prisma.noticePeriodPolicyEmployee.create({
                        data: {
                            organizationId: data.organization_id,
                            policyId: data.notice_period_policy_id,
                            employeeId: employee.id,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    });
                } catch (npErr) {
                    console.error('Failed to create notice period policy assignment (non-fatal):', npErr.message);
                }
            }

            if (data.email) {
                try {
                    await sendOnboardEmail(
                        data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                        data.email,
                        `${designationExists.name} (${designationExists.level})`,
                        'https://juryhrms-employee.jurysoftprojects.com/',
                        'Jurysoft Global',
                        'info@jurysoft.com'
                    );
                } catch (emailErr) {
                    console.error('Onboard email failed (non-fatal):', emailErr.message);
                }
            }

            // Re-fetch employee with all includes so junction data is up-to-date
            const finalEmployee = await prisma.organizationEmployees.findFirst({
                where: { id: employee.id },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                },
            });

            callback(null, {
                employee: mapEmployee(finalEmployee || employee),
                message: 'Employee created successfully',
                success: true
            });
        } catch (e) {
            console.error('CreateEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid employee id',
                });
            }

            const emp = await prisma.organizationEmployees.findFirst({
                where: { id, deletedAt: null },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
            });

            if (!emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            callback(null, {
                employee: mapEmployee(emp),
                message: 'Employee found successfully',
                success: true
            });
        } catch (e) {
            console.error('GetEmployee Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },
    GetEmployeeData: async (call, callback) => {
        try {
            const { id } = call.request;

            const emp = await prisma.organizationEmployees.findFirst({
                where: { id, deletedAt: null },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
            });

            if (!emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            callback(null, {
                employee: mapEmployee(emp),
                message: 'Employee found successfully',
                success: true
            });
        } catch (e) {
            console.error('GetEmployee Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    ListAllEmployees: async (call, callback) => {
        try {
            const {
                organization_id,
                department_id,
                location_id,
                probation_policy_id,
                only_active,
            } = call.request;


            let where = {
                deletedAt: null
            };

            // Handle organization filter
            if (organization_id && organization_id !== '') {
                where = {
                    ...where,
                    organizationId: organization_id,
                };
            }

            // Filter employees assigned to a specific probation policy
            if (probation_policy_id && probation_policy_id !== '') {
                where = {
                    ...where,
                    probationPolicyId: probation_policy_id,
                };
            }

            // Only return active employees
            if (only_active === true) {
                where = {
                    ...where,
                    isActive: true,
                };
            }

            // Handle department filter (include sub-departments)
            if (department_id && department_id !== '') {
                const deptIds = await getDepartmentWithChildren(department_id)
                where = {
                    ...where,
                    departmentAssignments: {
                        some: {
                            departmentId: { in: deptIds },
                        },
                    },
                };
            }

            // Handle location filter
            if (location_id && location_id !== '') {
                const locationIds = location_id.split(',').map(l => l.trim()).filter(Boolean);
                where = {
                    ...where,
                    locationId: locationIds.length === 1 ? locationIds[0] : { in: locationIds },
                };
            }

            const employees = await prisma.organizationEmployees.findMany({
                where,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
            });

            callback(null, {
                employees: employees.map(mapEmployee),
                message: 'All employees found successfully',
                success: true
            });
        } catch (e) {
            console.error('List All Employees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetOrgChart: async (call, callback) => {
        try {
            const { organization_id, department_id, branch_id } = call.request;

            if (!organization_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id is required'
                });
            }

            // 1. Fetch all employees with relations
            const empWhere = { organizationId: organization_id, deletedAt: null };
            if (branch_id) {
                const branchIds = branch_id.split(',').map(b => b.trim()).filter(Boolean);
                if (branchIds.length === 1) {
                    empWhere.branchId = branchIds[0];
                } else {
                    empWhere.branchId = { in: branchIds };
                }
            }
            const employees = await prisma.organizationEmployees.findMany({
                where: empWhere,
                include: {
                    designation: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } }
                    }
                }
            });

            if (!employees.length) {
                return callback(null, {
                    organization_id,
                    department_id: department_id || '',
                    roots: [],
                    success: true,
                    message: 'No employees found'
                });
            }

            // 2. Fetch all departments for head-of badge info
            const departments = await prisma.organizationDepartments.findMany({
                where: { organizationId: organization_id, deletedAt: null },
                select: { id: true, name: true, departmentHeadId: true }
            });

            // Build a map: employeeId -> array of department names they head
            const deptHeadMap = {};
            departments.forEach(d => {
                if (d.departmentHeadId) {
                    if (!deptHeadMap[d.departmentHeadId]) deptHeadMap[d.departmentHeadId] = [];
                    deptHeadMap[d.departmentHeadId].push(d.name);
                }
            });

            // 3. Helper to format date (yyyy-mm-dd)
            function fmtDate(d) {
                if (!d) return '';
                const dt = typeof d === 'string' ? new Date(d) : d;
                return dt.toISOString().split('T')[0];
            }

            // 4. Build node map using managerId
            const nodeMap = {};

            employees.forEach(emp => {
                const assignments = emp.departmentAssignments || [];
                const primaryDept = assignments.length > 0
                    ? (assignments[0].department?.parent
                        ? `${assignments[0].department.parent.name} >> ${assignments[0].department.name}`
                        : assignments[0].department?.name || '')
                    : '';

                nodeMap[emp.id] = {
                    id: emp.id,
                    full_name: emp.fullName,
                    email: emp.email || '',
                    phone: emp.phone || '',
                    employee_code: emp.employeeCode || '',
                    designation: emp.designation?.name || '',
                    department: primaryDept,
                    category: emp.category?.name || '',
                    organization_id: emp.organizationId,
                    manager_id: emp.managerId || '',
                    profile_image: emp.profileImage || '',
                    profile_image_file_id: emp.profileImageFileId || '',
                    date_of_birth: fmtDate(emp.dateOfBirth),
                    gender: emp.gender || '',
                    department_head_of: deptHeadMap[emp.id] || [],
                    reportees: []
                };
            });

            // 5. If department filter is active, scope to employees in that department (include sub-departments)
            let filteredIds = null;
            if (department_id) {
                const deptIds = await getDepartmentWithChildren(department_id)
                filteredIds = new Set();
                employees.forEach(emp => {
                    const hasDept = emp.departmentAssignments.some(a => deptIds.includes(a.departmentId));
                    if (hasDept) filteredIds.add(emp.id);
                });
            }

            // 6. Build parent-child edges
            Object.values(nodeMap).forEach(node => {
                if (node.manager_id && nodeMap[node.manager_id]) {
                    nodeMap[node.manager_id].reportees.push(node);
                }
            });

            // 7. Determine roots (manager_id == null or manager not in map)
            let roots = Object.values(nodeMap).filter(n => !n.manager_id || !nodeMap[n.manager_id]);

            // 8. If department filter, filter the tree
            if (filteredIds) {
                function pruneTree(node) {
                    const keptChildren = node.reportees
                        .map(pruneTree)
                        .filter(Boolean);

                    const nodeInFilter = filteredIds.has(node.id);
                    const hasVisibleChildren = keptChildren.length > 0;

                    if (nodeInFilter || hasVisibleChildren) {
                        node.reportees = keptChildren;
                        return node;
                    }
                    return null;
                }

                roots = roots.map(pruneTree).filter(Boolean);

                // If a root was pruned, find new roots among remaining nodes
                if (roots.length === 0) {
                    const allNodes = Object.values(nodeMap);
                    const kept = new Set();
                    allNodes.forEach(n => { if (filteredIds.has(n.id)) kept.add(n.id); });

                    // Build new roots from filtered set (those whose manager is not in filter)
                    const filteredNodes = allNodes.filter(n => kept.has(n.id));
                    const managerInFilter = (mid) => mid && kept.has(mid);
                    roots = filteredNodes
                        .filter(n => !n.manager_id || !managerInFilter(n.manager_id))
                        .map(n => ({ ...n, reportees: [] }));

                    // Rebuild edges within filtered set
                    const filteredMap = {};
                    roots.forEach(r => filteredMap[r.id] = r);
                    filteredNodes.forEach(n => {
                        if (n.manager_id && filteredMap[n.manager_id]) {
                            filteredMap[n.manager_id].reportees.push(n);
                        }
                    });
                }
            }

            // 9. Recursive clean
            function cleanNode(node) {
                return {
                    id: node.id,
                    full_name: node.full_name,
                    email: node.email,
                    phone: node.phone,
                    employee_code: node.employee_code,
                    designation: node.designation,
                    department: node.department,
                    category: node.category,
                    organization_id: node.organization_id,
                    manager_id: node.manager_id,
                    profile_image: node.profile_image,
                    date_of_birth: node.date_of_birth,
                    gender: node.gender,
                    department_head_of: node.department_head_of,
                    reportees: node.reportees.map(cleanNode)
                };
            }

            callback(null, {
                organization_id,
                department_id: department_id || '',
                roots: roots.map(cleanNode),
                success: true,
                message: 'Org chart built successfully'
            });
        } catch (e) {
            console.error('GetOrgChart Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListEmployees: async (call, callback) => {
        try {
            const {
                organization_id,
                category_id,
                designation_id,
                department_id,
                branch_id,
                location_id,
                page = 1,
                limit = 10,
                search = '',
                sort_by = 'created_at',
                sort_order = 'desc',
            } = call.request;


            const skip = (page - 1) * limit;
            let where = {
                deletedAt: null
            };

            // Handle organization filter
            if (organization_id && organization_id !== '') {
                where = {
                    ...where,
                    organizationId: organization_id,
                };
            }

            // Handle category filter (comma-separated multi-select)
            if (category_id && category_id !== '') {
                const catIds = category_id.split(',').map(c => c.trim()).filter(Boolean);
                where = {
                    ...where,
                    categoryId: catIds.length === 1 ? catIds[0] : { in: catIds },
                };
            }

            // Handle designation filter
            if (designation_id && designation_id !== '') {
                where = {
                    ...where,
                    designationId: designation_id,
                };
            }

            // Handle department filter (include sub-departments)
            if (department_id && department_id !== '') {
                const deptIds = await getDepartmentWithChildren(department_id)
                where = {
                    ...where,
                    departmentAssignments: {
                        some: {
                            departmentId: { in: deptIds },
                        },
                    },
                };
            }

            // Handle branch filter
            if (branch_id && branch_id !== '') {
                const branchIds = branch_id.split(',').map(b => b.trim()).filter(Boolean);
                where = {
                    ...where,
                    branchId: branchIds.length === 1 ? branchIds[0] : { in: branchIds },
                };
            }

            // Handle location filter
            if (location_id && location_id !== '') {
                const locationIds = location_id.split(',').map(l => l.trim()).filter(Boolean);
                where = {
                    ...where,
                    locationId: locationIds.length === 1 ? locationIds[0] : { in: locationIds },
                };
            }

            // Handle search
            if (search && search !== '') {
                where = {
                    ...where,
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } },
                    ],
                };
            }


            const validSortFields = {
                first_name: 'firstName',
                last_name: 'lastName',
                full_name: 'fullName',
                email: 'email',
                created_at: 'createdAt',
                updated_at: 'updatedAt',
            };

            const sortField = validSortFields[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizationEmployees.count({ where });
            const employees = await prisma.organizationEmployees.findMany({
                where,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } },
                            reporting: true
                        }
                    }
                },
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const employeesList = await Promise.all(employees.map(mapEmployee))

            const totalPages = Math.ceil(total / limit);

            callback(null, {
                employees: employeesList,
                total,
                page,
                limit,
                total_pages: totalPages,
                message: 'Employees found successfully',
                success: true
            });
        } catch (e) {
            console.error('ListEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateEmployee: async (call, callback) => {
        try {
            const data = call.request;
            const existing = await prisma.organizationEmployees.findFirst({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }

            const organizationExists = await prisma.organizations.findFirst({
                where: { id: data.organization_id || existing.organizationId, deletedAt: null },
            });

            if (!organizationExists) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Organization not found',
                });
            }

            if (data.is_admin) {
                const admins = await prisma.organizationEmployees.count({
                    where: {
                        deletedAt: null,
                        organizationId: data.organization_id,
                        isAdmin: true,
                        id: {
                            not: data.id
                        }
                    }
                })

                if (organizationExists.maxAdminAccounts <= admins) {
                    return callback({
                        code: grpc.status.OUT_OF_RANGE,
                        message: 'Admins adding limit exceeded. Contact support.',
                    });
                }
            }

            // Validate designation if provided
            let targetDesignation = existing.designationId
                ? await prisma.organizationDesignations.findFirst({
                    where: { id: existing.designationId, deletedAt: null },
                    include: { band: true },
                })
                : null
            if (data.designation_id && data.designation_id !== existing.designationId) {
                const designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                    include: { band: true },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
                targetDesignation = designationExists;
            }

            // Band is synchronized from the Designation's mapped Band. The
            // frontend-supplied band_id must match, otherwise reject.
            const effectiveBandId = targetDesignation?.bandId || null
            if (data.band_id && data.band_id !== effectiveBandId) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Band must match the band mapped to the selected designation.',
                });
            }
            let nextEmployeeCode = data.employee_code && String(data.employee_code).trim()
                ? String(data.employee_code).trim()
                : null

            let series = null;
            if (data.number_series_id) {
                series = await prisma.employeeNumberSeries.findFirst({
                    where: {
                        id: data.number_series_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                        isActive: true,
                    },
                });
            } else if (!nextEmployeeCode && (!existing.employeeCode || data.force_code_regeneration)) {
                series = await prisma.employeeNumberSeries.findFirst({
                    where: {
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                        isActive: true,
                    },
                    orderBy: { createdAt: 'asc' },
                });
            }

            if (!nextEmployeeCode && series) {
                const number = String(series.nextNumber).padStart(series.digits || 1, '0');
                nextEmployeeCode = `${series.prefix || ''}${number}${series.suffix || ''}`;
                await prisma.employeeNumberSeries.update({
                    where: { id: series.id },
                    data: { nextNumber: series.nextNumber + 1 },
                });
            }


            // Validate probation policy if provided
            let probationPolicyExists = null;
            if (data.probation_policy_id) {
                probationPolicyExists = await prisma.probationPolicies.findFirst({
                    where: {
                        id: data.probation_policy_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!probationPolicyExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Probation policy not found in organization.',
                    });
                }
            }

            // Validate pay grade if provided – must belong to the employee's organization
            if (data.pay_grade_id) {
                const payGradeExists = await prisma.payGrades.findFirst({
                    where: {
                        id: data.pay_grade_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!payGradeExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Pay grade not found in the employee\'s organization.',
                    });
                }
            }

            // Validate notice period policy if provided
            let noticePeriodPolicyExists = null;
            if (data.notice_period_policy_id) {
                noticePeriodPolicyExists = await prisma.noticePeriodPolicy.findFirst({
                    where: {
                        id: data.notice_period_policy_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!noticePeriodPolicyExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Notice period policy not found in organization.',
                    });
                }
            }

            const joiningDate = data.joining_date
                ? new Date(data.joining_date + 'T00:00:00')
                : (data.joining_date === '' ? null : existing.joiningDate);

            // Explicitly provided probation dates take priority; otherwise derive
            // from joining date + policy.
            const explicitStart = data.probation_start_date
                ? new Date(data.probation_start_date + 'T00:00:00')
                : (data.probation_start_date === '' ? null : null);
            const explicitEnd = data.probation_end_date
                ? new Date(data.probation_end_date + 'T00:00:00')
                : (data.probation_end_date === '' ? null : null);

            // Recompute probation end date when policy or joining date changes.
            const effectivePolicy = probationPolicyExists || existing.probationPolicy;
            const rebuildEndDate = Boolean(data.probation_policy_id || data.joining_date != null);

            const isPermanent =
                data.is_permanent !== undefined && data.is_permanent !== null
                    ? Boolean(data.is_permanent)
                    : existing.isPermanent;

            const updateData = {
                organizationId: data.organization_id || existing.organizationId,
                categoryId: data.category_id != null
                    ? (data.category_id || null)
                    : (data.is_permanent != null && data.is_permanent ? null : existing.categoryId),
                designationId: data.designation_id || existing.designationId,
                bandId: effectiveBandId,
                employeeCode: nextEmployeeCode || existing.employeeCode || null,
                managerId: data.manager_id || existing.managerId,
                branchId: data.branch_id || existing.branchId,
                locationId: data.location_id || existing.locationId,
                firstName: data.first_name ?? existing.firstName,
                lastName: data.last_name ?? existing.lastName,
                fullName: data.full_name || `${data.first_name || existing.firstName || ''} ${data.last_name || existing.lastName || ''}`.trim(),
                email: data.email ?? existing.email,
                isAdmin: data.is_admin != null ? Boolean(data.is_admin) : existing.isAdmin,
                isActive: data.is_active != null ? data.is_active : existing.isActive,
                phone: data.phone ?? existing.phone,
                altPhone: data.alt_phone ?? existing.altPhone,
                gender: data.gender ? data.gender.toUpperCase() : existing.gender,
                dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth + 'T00:00:00') : existing.dateOfBirth,
                joiningDate,
                displayName: data.display_name != null ? (data.display_name || null) : existing.displayName,
                maritalStatus: data.marital_status != null ? (data.marital_status || null) : existing.maritalStatus,
                bloodGroup: data.blood_group != null ? (data.blood_group || null) : existing.bloodGroup,
                physicallyHandicapped: data.physically_handicapped != null ? Boolean(data.physically_handicapped) : existing.physicallyHandicapped,
                nationality: data.nationality != null ? (data.nationality || null) : existing.nationality,
                personalEmail: data.personal_email != null ? (data.personal_email || null) : existing.personalEmail,
                professionalSummary: data.professional_summary != null ? (data.professional_summary || null) : existing.professionalSummary,
                currentAddress: data.current_address != null
                    ? parseAddressJson(data.current_address)
                    : existing.currentAddress,
                permanentAddress: data.permanent_address != null
                    ? parseAddressJson(data.permanent_address)
                    : existing.permanentAddress,
                profileImage: data.profile_image != null
                    ? (data.profile_image || null)
                    : existing.profileImage,
                profileImageFileId: data.profile_image_file_id != null
                    ? (data.profile_image_file_id || null)
                    : existing.profileImageFileId,
                costCenterId: data.cost_center_id != null
                    ? (data.cost_center_id || null)
                    : existing.costCenterId,
                payGradeId: data.pay_grade_id != null
                    ? (data.pay_grade_id || null)
                    : existing.payGradeId,
                isPermanent,
                workerType: data.worker_type !== undefined && data.worker_type !== null
                    ? (data.worker_type || null)
                    : existing.workerType,
                probationPolicyId: data.probation_policy_id && data.probation_policy_id !== ''
                    ? data.probation_policy_id
                    : existing.probationPolicyId,
                probationStartDate: data.probation_start_date !== undefined && data.probation_start_date !== null
                    ? (data.probation_start_date === '' ? null : explicitStart)
                    : existing.probationStartDate,
                probationEndDate: explicitEnd
                    ? explicitEnd
                    : (rebuildEndDate
                        ? (joiningDate && effectivePolicy
                            ? calculateProbationEndDate(
                                joiningDate,
                                effectivePolicy.durationValue,
                                effectivePolicy.durationUnit,
                                effectivePolicy.endDateAfterCompletion ?? false,
                            )
                            : null)
                        : existing.probationEndDate),
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationEmployees.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                },
            });

            // Handle notice period policy assignment change
            if (data.notice_period_policy_id !== undefined) {
                try {
                    // Use findMany without deletedAt filter (Prisma deletedAt:null filter is broken for this model on Mongo) then filter in JS
                    const allAssignments = await prisma.noticePeriodPolicyEmployee.findMany({ where: { employeeId: data.id } });
                    const activeAssignments = allAssignments.filter(m => !m.deletedAt);
                    const currentAssignment = activeAssignments[0] || null;
                    const currentPolicyId = currentAssignment?.policyId || null;
                    const newPolicyId = data.notice_period_policy_id || null;

                    if (currentPolicyId !== newPolicyId) {
                            // Deactivate ALL active mappings (fix multiple active due to previous bug)
                            if (activeAssignments.length > 0) {
                                for (const a of activeAssignments) {
                                    await prisma.noticePeriodPolicyEmployee.update({
                                        where: { id: a.id },
                                        data: { deletedAt: new Date(), updatedAt: new Date() },
                                    });
                                }
                            }
                            // Create new mapping (hard-delete any stale record first to avoid unique constraint)
                            if (newPolicyId && noticePeriodPolicyExists) {
                                await prisma.noticePeriodPolicyEmployee.deleteMany({
                                    where: { policyId: newPolicyId, employeeId: data.id },
                                });
                                await prisma.noticePeriodPolicyEmployee.create({
                                    data: {
                                        organizationId: data.organization_id || existing.organizationId,
                                        policyId: newPolicyId,
                                        employeeId: data.id,
                                        createdAt: new Date(),
                                        updatedAt: new Date(),
                                    },
                                });
                            }
                        }
                } catch (npErr) {
                    console.error('Failed to update notice period policy assignment (non-fatal):', npErr.message, npErr.stack);
                }
            }

            // Re-fetch employee with all includes so junction data is up-to-date
            const finalEmployee = await prisma.organizationEmployees.findFirst({
                where: { id: data.id },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    noticePeriodPolicies: {
                        include: { policy: true },
                    },
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                },
            });

            callback(null, {
                employee: mapEmployee(finalEmployee || updated),
                message: 'Employee updated successfully',
                success: true
            });
        } catch (e) {
            console.error('UpdateEmployee Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteEmployee: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Invalid employee id',
                });
            }

            const emp = await prisma.organizationEmployees.findFirst({
                where: { id }
            });

            if (!emp) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee not found'
                });
            }
            if (emp.deletedAt) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: 'Employee already deleted'
                });
            }

            await prisma.organizationEmployees.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            callback(null, {
                success: true,
                message: 'Employee deleted successfully'
            });
        } catch (e) {
            console.error('DeleteEmployee Error:', e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message,
            });
        }
    },

    // 🔄 Extend an employee's probation by N months (respects policy max).
    ExtendProbation: async (call, callback) => {
        try {
            const { id, organization_id, months, admin_id, ip_address, user_agent } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            }
            if (!Number.isInteger(months) || months <= 0) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'months must be a positive integer' });
            }

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const emp = await prisma.organizationEmployees.findFirst({
                where,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } },
                    },
                },
            });

            if (!emp) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }
            if (!emp.probationPolicy) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'Employee has no probation policy assigned' });
            }

            const policy = emp.probationPolicy;
            const currentExtended = emp.probationExtendedByMonths ?? 0;
            const totalAfter = currentExtended + months;

            if (policy.maxDurationValue > 0 && totalAfter > policy.maxDurationValue) {
                return callback({
                    code: grpc.status.OUT_OF_RANGE,
                    message: `Cannot extend beyond policy maximum of ${policy.maxDurationValue} ${policy.maxDurationUnit}`,
                });
            }

            // Base end = persisted end date (may already be extended) or derived.
            let baseEnd = emp.probationEndDate;
            if (!baseEnd) {
                const start = emp.probationStartDate || effectiveJoiningDate(emp);
                baseEnd = calculateProbationEndDate(
                    start,
                    policy.durationValue,
                    policy.durationUnit,
                    policy.endDateAfterCompletion ?? false,
                );
            }

            const newEnd = baseEnd ? addCalendarMonths(baseEnd, months) : null;

            const updated = await prisma.organizationEmployees.update({
                where: { id },
                data: {
                    probationEndDate: newEnd,
                    probationExtendedByMonths: currentExtended + months,
                    updatedAt: new Date(),
                },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } },
                    },
                },
            });

            try {
                await prisma.adminAuditLog.create({
                    data: {
                        adminId: admin_id || null,
                        organizationId: emp.organizationId,
                        action: 'EXTEND',
                        entityType: 'employee_probation',
                        entityId: id,
                        changes: { added_months: months, previous_end: baseEnd?.toISOString() ?? null, new_end: newEnd?.toISOString() ?? null },
                        ipAddress: ip_address || '',
                        userAgent: user_agent || '',
                        createdAt: new Date(),
                        deletedAt: null,
                    },
                });
            } catch (auditErr) {
                console.error('[ExtendProbation] Audit log failed (non-fatal):', auditErr.message);
            }

            callback(null, {
                employee: mapEmployee(updated),
                message: 'Probation extended successfully',
                success: true,
            });
        } catch (e) {
            console.error('ExtendProbation Error:', e);
            if (e.code && e.message) return callback(e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    // 🔁 Change the probation policy assigned to an employee.
    ChangeProbationPolicy: async (call, callback) => {
        try {
            const { id, organization_id, probation_policy_id, admin_id, ip_address, user_agent } = call.request;

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            }

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const emp = await prisma.organizationEmployees.findFirst({
                where,
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } },
                    },
                },
            });

            if (!emp) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }

            let policy = null;
            if (probation_policy_id) {
                policy = await prisma.probationPolicies.findFirst({
                    where: {
                        id: probation_policy_id,
                        organizationId: emp.organizationId,
                        deletedAt: null,
                    },
                });
                if (!policy) {
                    return callback({ code: grpc.status.NOT_FOUND, message: 'Probation policy not found in organization.' });
                }
            }

            const start = emp.probationStartDate || emp.joiningDate;
            const newEnd = start && policy
                ? calculateProbationEndDate(
                      start,
                      policy.durationValue,
                      policy.durationUnit,
                      policy.endDateAfterCompletion ?? false,
                  )
                : null;

            const updated = await prisma.organizationEmployees.update({
                where: { id },
                data: {
                    probationPolicyId: probation_policy_id || null,
                    ...(policy
                        ? {
                              probationEndDate: newEnd,
                          }
                        : {
                              probationEndDate: null,
                          }),
                    updatedAt: new Date(),
                },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: { department: { include: { parent: true } } },
                    },
                },
            });

            try {
                await prisma.adminAuditLog.create({
                    data: {
                        adminId: admin_id || null,
                        organizationId: emp.organizationId,
                        action: 'CHANGE',
                        entityType: 'employee_probation',
                        entityId: id,
                        changes: { from: emp.probationPolicyId ?? null, to: probation_policy_id || null },
                        ipAddress: ip_address || '',
                        userAgent: user_agent || '',
                        createdAt: new Date(),
                        deletedAt: null,
                    },
                });
            } catch (auditErr) {
                console.error('[ChangeProbationPolicy] Audit log failed (non-fatal):', auditErr.message);
            }

            callback(null, {
                employee: mapEmployee(updated),
                message: 'Probation policy updated successfully',
                success: true,
            });
        } catch (e) {
            console.error('ChangeProbationPolicy Error:', e);
            if (e.code && e.message) return callback(e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListEmployeeNumberSeries: async (call, cb) => {
        try {
            const { organization_id } = call.request;
            if (!organization_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required' });
            const series = await prisma.employeeNumberSeries.findMany({
                where: { organizationId: organization_id, deletedAt: null },
                orderBy: { createdAt: 'asc' },
            });
            cb(null, { series: series.map(mapNumberSeries), success: true, message: 'Employee number series listed successfully.' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    CreateEmployeeNumberSeries: async (call, cb) => {
        try {
            const { organization_id, name, prefix = '', digits = 4, suffix = '', next_number = 1, policy_type = 'PROBATION' } = call.request;
            if (!organization_id || !name?.trim()) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id and name are required' });
            }
            const normalizedDigits = Number(digits) || 4;
            const normalizedNextNumber = Number(next_number) || 1;
            if (normalizedDigits < 1 || normalizedDigits > 10) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'digits must be between 1 and 10' });
            }
            if (normalizedNextNumber < 1) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'next_number must be at least 1' });
            }
            const organization = await prisma.organizations.findFirst({ where: { id: organization_id, deletedAt: null } });
            if (!organization) return cb({ code: grpc.status.NOT_FOUND, message: 'Organization not found' });
            const POLICY_TYPES = ['PROBATION', 'INTERNSHIP', 'TRAINEE', 'CONTRACT', 'PERMANENT'];
            if (!POLICY_TYPES.includes(policy_type)) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: `policy_type must be one of ${POLICY_TYPES.join(', ')}` });
            }
            const duplicate = await prisma.employeeNumberSeries.findFirst({
                where: { organizationId: organization_id, name: name.trim(), deletedAt: null },
            });
            if (duplicate) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'A number series with this name already exists.' });
            const created = await prisma.employeeNumberSeries.create({
                data: {
                    organizationId: organization_id,
                    name: name.trim(),
                    prefix: prefix || '',
                    digits: normalizedDigits,
                    suffix: suffix || '',
                    nextNumber: normalizedNextNumber,
                    policyType: policy_type,
                    isActive: true,
                    deletedAt: null,
                },
            });
            cb(null, { series: mapNumberSeries(created), success: true, message: 'Employee number series created successfully.' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateEmployeeNumberSeries: async (call, cb) => {
        try {
            const { id, organization_id, name, prefix, digits, suffix, next_number, is_active, policy_type } = call.request;
            if (!id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'id is required' });

            const existing = await prisma.employeeNumberSeries.findFirst({
                where: { id, organizationId: organization_id, deletedAt: null },
            });
            if (!existing) return cb({ code: grpc.status.NOT_FOUND, message: 'Number series not found' });

            const normalizedDigits = Number(digits);
            const normalizedNextNumber = Number(next_number);

            const POLICY_TYPES = ['PROBATION', 'INTERNSHIP', 'TRAINEE', 'CONTRACT', 'PERMANENT'];
            if (policy_type !== undefined && !POLICY_TYPES.includes(policy_type)) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: `policy_type must be one of ${POLICY_TYPES.join(', ')}` });
            }

            const duplicate = name && name.trim()
                ? await prisma.employeeNumberSeries.findFirst({
                      where: {
                          organizationId: organization_id,
                          name: name.trim(),
                          deletedAt: null,
                          id: { not: id },
                      },
                  })
                : null;
            if (duplicate) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'A number series with this name already exists.' });

            const updated = await prisma.employeeNumberSeries.update({
                where: { id },
                data: {
                    name: (name && name.trim()) ? name.trim() : existing.name,
                    prefix: (prefix !== undefined && prefix !== '') ? prefix : existing.prefix,
                    digits: normalizedDigits > 0 ? normalizedDigits : existing.digits,
                    suffix: (suffix !== undefined && suffix !== '') ? suffix : existing.suffix,
                    nextNumber: normalizedNextNumber >= 1 ? normalizedNextNumber : existing.nextNumber,
                    isActive: is_active !== undefined ? is_active : existing.isActive,
                    policyType: (policy_type !== undefined && policy_type !== '') ? policy_type : existing.policyType,
                },
            });
            cb(null, { series: mapNumberSeries(updated), success: true, message: 'Employee number series updated successfully.' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RequestLoginOtp: async (call, cb) => {
        try {
            const { email, phone, purpose = 'login', ip_address, user_agent } = call.request;
            const authentication_type = getAuthenticationType({ email });

            const employee = await findEmployeeByEMailOrPhone({ email, phone });

            if (!employee) {
                await logLogin({ email, phone, status: 'FAILED', issue: 'Employee not found', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });
                return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }

            const otp = genOtp();

            await prisma.otps.create({
                data: {
                    employeeId: employee.id,
                    otp,
                    purpose,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            // Always send OTP to the admin's email
            sendOtpEmail(employee.email, otp, OTP_TTL_MS / 60000);

            cb(null, { message: 'OTP sent to registered email', success: true, authentication_type });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    VerifyToken: async (call, cb) => {
        try {
            const { token } = call.request;

            if (!token) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Token is required' });
            }

            const payload = await verifyToken(token).catch(() => null);
            if (!payload) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid or expired token' });
            }

            let user = null;
            let permissionResolve = { permission_keys: [], module_keys: [] };
            if (payload.scope == 'employee') {
                user = await prisma.organizationEmployees.findFirst({
                    where: {
                        id: payload.sub,
                        deletedAt: null,
                        isActive: true,
                    },
include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    manager: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
                });
                if (!user) {
                    return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid or expired token' });
                }
                permissionResolve = await resolveEmployeePermissions(user.id, user.organizationId);
            }

            cb(null, {
                success: true,
                message: 'Token verified successfully',
                sub: payload.sub || '',
                user: mapEmployee(user),
                permission_keys: permissionResolve.permission_keys,
                module_keys: permissionResolve.module_keys,
                email: payload.email || '',
                scope: payload.scope || '',
                typ: payload.typ || 'access',
                authentication_type: payload.authentication_type || '',
                iat: payload.iat ? String(payload.iat) : '',
                exp: payload.exp ? String(payload.exp) : '',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },


    VerifyLoginOtp: async (call, cb) => {
        try {
            const { email, phone, otp, ip_address, user_agent } = call.request;
            const authentication_type = getAuthenticationType({ email });

            const employee = await findEmployeeByEMailOrPhone({ email, phone });
            if (!employee) {
                await logLogin({ email, phone, status: 'FAILED', issue: 'Employee not found', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });
                return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }

            // Get the latest (not soft-deleted) OTP
            const record = await prisma.otps.findFirst({
                where: { employeeId: employee.id, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            if (!record) {
                await logLogin({ employee, status: 'FAILED', issue: 'OTP not found', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'OTP not found' });
            }

            const age = Date.now() - new Date(record.createdAt).getTime();
            if (age > OTP_TTL_MS) {
                // mark expired/consumed to avoid re-use
                await prisma.otps.update({
                    where: { id: record.id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });
                await logLogin({ employee, status: 'FAILED', issue: 'OTP expired', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'OTP expired' });
            }

            if (record.otp !== otp) {
                await logLogin({ employee, status: 'FAILED', issue: 'Invalid OTP', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid OTP' });
            }

            // consume OTP
            // await prisma.otps.update({
            //     where: { id: record.id },
            //     data: { deletedAt: new Date(), updatedAt: new Date() },
            // });

            const access_token = await signAccessToken({ sub: employee.id, email: employee.email, scope: 'employee', authentication_type });
            const refresh_token = await signRefreshToken({ sub: employee.id, typ: 'refresh', authentication_type });

            await prisma.organizationEmployees.update({
                where: { id: employee.id },
                data: { accessToken: access_token, refreshToken: refresh_token, updatedAt: new Date() },
            });

            const empData = await prisma.organizationEmployees.findFirst({
                where: {
                    id: employee.id,
                    deletedAt: null,
                    isActive: true,
                },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
            });


            const permissionResolve = await resolveEmployeePermissions(
                empData.id,
                empData.organizationId
            );

            await logLogin({ employee, status: 'SUCCESS', authenticationType: authentication_type, ipAddress: ip_address, userAgent: user_agent });

            cb(null, {
                success: true,
                message: 'OTP verified successfully',
                access_token,
                refresh_token,
                token_type: 'Bearer',
                authentication_type,
                expires_in: String(getAccessExpiresIn()),
                employee: mapEmployee(empData),
                permission_keys: permissionResolve.permission_keys,
                module_keys: permissionResolve.module_keys,
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListLoginLogs: async (call, cb) => {
        try {
            const { organization_id, status, issue } = call.request;
            const page = Math.max(1, Number(call.request.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(call.request.limit) || 20));

            const where = {
                deletedAt: null,
                ...(organization_id ? { organizationId: organization_id } : {}),
                ...(status ? { status } : {}),
                ...(issue ? { issue } : {}),
            };

            const [total, rows] = await Promise.all([
                prisma.loginLogs.count({ where }),
                prisma.loginLogs.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * limit,
                    take: limit,
                    include: {
                        employee: {
                            include: {
                                organization: true,
                                designation: true,
                                departmentAssignments: {
                                    where: { deletedAt: null },
                                    include: {
                                        department: { include: { parent: { include: { parent: true } } } }
                                    }
                                },
                            }
                        }
                    },
                }),
            ]);

            const logs = rows.map((log) => {
                const deptInfo = primaryDepartmentInfo(log.employee);
                return {
                    id: log.id,
                    employee_id: log.employeeId || '',
                    employee_code: log.employee?.employeeCode || '',
                    employee_name: log.employee?.fullName || '',
                    email: log.email || '',
                    phone: log.phone || '',
                    organization_id: log.organizationId || '',
                    status: log.status || '',
                    issue: log.issue || '',
                    authentication_type: log.authenticationType || '',
                    ip_address: log.ipAddress || '',
                    user_agent: log.userAgent || '',
                    timestamp: log.createdAt ? log.createdAt.toISOString() : '',
                    created_at: log.createdAt ? formatDate(log.createdAt) : '',
                    department: deptInfo.department,
                    sub_department: deptInfo.subDepartment,
                    designation: log.employee?.designation?.name || '',
                    business_unit: log.employee?.organization?.name || deptInfo.businessUnit,
                    branch_id: log.employee?.branchId || '',
                    location_id: log.employee?.locationId || '',
                };
            });

            cb(null, {
                logs,
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: 'Login logs fetched successfully',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RefreshTokens: async (call, cb) => {
        try {
            const { refresh_token } = call.request;
            const payload = await verifyToken(refresh_token).catch(() => null);
            if (!payload || payload.typ !== 'refresh') {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid refresh token' });
            }

            const employee = await prisma.organizationEmployees.findFirst({
                where: { id: payload.sub, deletedAt: null, isActive: true },
            });
            if (!employee || employee.refreshToken !== refresh_token) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Refresh token mismatch' });
            }

            // rotate tokens
            const authentication_type = payload.authentication_type || '';
            const newAccess = await signAccessToken({ sub: employee.id, email: employee.email, scope: 'employee', authentication_type });
            const newRefresh = await signRefreshToken({ sub: employee.id, typ: 'refresh', authentication_type });

            await prisma.organizationEmployees.update({
                where: { id: employee.id },
                data: { accessToken: newAccess, refreshToken: newRefresh, updatedAt: new Date() },
            });

            const empData = await prisma.organizationEmployees.findFirst({
                where: {
                    id: employee.id,
                    deletedAt: null,
                    isActive: true,
                },
                include: {
                    organization: true,
                    category: true,
                    costCenter: true,
                    payGrade: true,
                    band: true,
                    probationPolicy: true,
                    designation: true,
                    location: true,
                    branch: true,
                    manager: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: { include: { parent: true } }
                        }
                    }
                }
            });

                        const permissionResolve = await resolveEmployeePermissions(
                empData.id,
                empData.organizationId
            );

            cb(null, {
                success: true,
                message: 'Tokens refreshed successfully',
                access_token: newAccess,
                refresh_token: newRefresh,
                token_type: 'Bearer',
                authentication_type,
                expires_in: String(getAccessExpiresIn()),
                employee: mapEmployee(empData),
                permission_keys: permissionResolve.permission_keys,
                module_keys: permissionResolve.module_keys,
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

function formatDate(date) {
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

function formatLoginRegistrationDate(date) {
    if (!date) return null;
    return new Date(date).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

// Calendar-aware probation end date (mirrors probation-policy-service).
// end_date_after_completion = true  → start + duration (day after completion)
// end_date_after_completion = false → start + duration - 1 day (last day)
function addCalendarMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    const totalMonths = d.getMonth() + months;
    const targetYear = d.getFullYear() + Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    d.setFullYear(targetYear, targetMonth, 1);
    d.setDate(Math.min(day, new Date(targetYear, targetMonth + 1, 0).getDate()));
    return d;
}

function calculateProbationEndDate(startDate, durationValue, durationUnit, endDateAfterCompletion) {
    const start = new Date(startDate);
    let base;
    switch (durationUnit) {
        case 'MONTHS':
            base = addCalendarMonths(start, durationValue);
            break;
        case 'WEEKS':
            base = new Date(start.getTime());
            base.setDate(base.getDate() + durationValue * 7);
            break;
        case 'DAYS':
            base = new Date(start.getTime());
            base.setDate(base.getDate() + durationValue);
            break;
        default:
            return null;
    }
    const end = endDateAfterCompletion ? base : new Date(Math.max(base.getTime() - 86400000, start.getTime()));
    return end;
}

// 👉 Derived probation: joining date + employee's probation policy → dates.
// - probationStartDate (defaults to joining date) drives the start.
// - probationEndDate is persisted at assignment time and extended via
//   ExtendProbation; when missing it is derived from the policy duration.
// Probation-aware employment status: permanent worker currently on probation shows PROBATION,
// completed probation (or permanent) shows PERMANENT, otherwise the category employment type.
function deriveEmploymentStatus(emp) {
    if (!emp) return 'PROBATION';
    const probation = deriveProbation(emp);
    if (probation?.in_progress) return 'PROBATION';
    if (emp?.isPermanent || probation?.status === 'Completed') return 'PERMANENT';
    return emp?.category?.employmentType || 'PROBATION';
}

function deriveProbation(emp) {
    const policy = emp?.probationPolicy;
    if (!policy) return null;
    const start = emp.probationStartDate || effectiveJoiningDate(emp);
    if (!start) return null;
    let end = emp.probationEndDate;
    if (!end) {
        end = calculateProbationEndDate(
            start,
            policy.durationValue,
            policy.durationUnit,
            policy.endDateAfterCompletion ?? false,
        );
    }
    const extendedByMonths = emp.probationExtendedByMonths ?? 0;
    const isOverdue = end && end.getTime() < Date.now();
    const extended = extendedByMonths > 0;
    return {
        policy_id: policy.id || '',
        policy_name: policy.name || '',
        policy_type: policy.policyType ?? 'PROBATION',
        duration_value: policy.durationValue ?? null,
        duration_unit: policy.durationUnit || '',
        end_date_after_completion: policy.endDateAfterCompletion ?? false,
        joining_date: new Date(start).toISOString(),
        start_date: new Date(start).toISOString(),
        end_date: end ? end.toISOString() : null,
        status: isOverdue ? 'Completed' : (extended ? 'Extended' : 'In Progress'),
        in_progress: !isOverdue,
        extended,
        extended_by_months: extendedByMonths,
        max_duration_value: policy.maxDurationValue ?? 0,
        max_duration_unit: policy.maxDurationUnit || 'MONTHS',
    };
}

// 🏢 Derive department, sub-department and (top-most ancestor) business unit for
// an employee from their primary department assignment.
function primaryDepartmentInfo(emp) {
    if (!emp) return { department: '', subDepartment: '', businessUnit: '' };
    const assignment = (emp.departmentAssignments || []).find((a) => a.department);
    const dept = assignment?.department;
    if (!dept) {
        const fallbackDept = emp.designation?.department;
        const fb = fallbackDept || null;
        if (!fb) return { department: '', subDepartment: '', businessUnit: '' };
        return {
            department: fb.parent ? fb.parent.name || '' : fb.name || '',
            subDepartment: fb.parent ? fb.name || '' : '',
            businessUnit: topDepartmentName(fb),
        };
    }
    return {
        department: dept.parent ? dept.parent.name || '' : dept.name || '',
        subDepartment: dept.parent ? dept.name || '' : '',
        businessUnit: topDepartmentName(dept),
    };
}

function topDepartmentName(dept) {
    let current = dept;
    while (current?.parent) current = current.parent;
    return current?.name || '';
}

function buildLocationLabel(emp) {
    const loc = emp?.location;
    if (!loc) return '';
    const base = loc.name ||
        loc.formattedAddress ||
        [loc.city, loc.state, loc.country].filter(Boolean).join(', ') ||
        'Location';

    if (loc.entityType === 'branch') {
        const branchName = emp?.branch?.name;
        return branchName ? `${branchName} — ${base}` : base;
    }
    if (loc.entityType === 'organization') {
        return `Organization${loc.isHeadquarters ? ' (HQ)' : ''} — ${base}`;
    }
    return base;
}

// Effective joining date: prefer the employee's own joiningDate, but fall
// back to the earliest department-assignment start date so the dates always
// show (employees may have been onboarded via department assignment only).
function effectiveJoiningDate(emp) {
    if (emp?.joiningDate) return emp.joiningDate;
    const assignments = emp?.departmentAssignments || [];
    const start = assignments
        .map(a => a?.startDate)
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0];
    return start || null;
}

function mapEmployee(emp) {
    return {
        id: emp?.id ?? '',
        organization_id: emp?.organizationId ?? '',
        category_id: emp?.categoryId ?? '',
        designation_id: emp?.designationId ?? '',
        department_id:
            emp?.departmentAssignments?.[0]?.departmentId ??
            emp?.designation?.departmentId ??
            '',

        // Flat department / sub-department names for quick display
        department_name:
            emp?.departmentAssignments?.[0]?.department?.name ??
            emp?.designation?.department?.name ??
            '',
        sub_department_name:
            emp?.departmentAssignments?.[0]?.department?.parent?.name ??
            emp?.designation?.department?.parent?.name ??
            '',

        // Location name
        location_name: emp?.location ? buildLocationLabel(emp) : '',

        // Reporting manager (manager relationship → who they report to)
        reporting_manager: emp?.manager
            ? {
                id: emp.manager.id ?? '',
                full_name: emp.manager.fullName ?? '',
                employee_code: emp.manager.employeeCode ?? '',
            }
            : null,

        employee_code: emp?.employeeCode ?? '',
        manager_id: emp?.managerId ?? '',
        branch_id: emp?.branchId ?? '',
        location_id: emp?.locationId ?? '',
        profile_image: emp?.profileImage ?? '',
        profile_image_file_id: emp?.profileImageFileId ?? '',
        cost_center_id: emp?.costCenterId ?? '',
        cost_center_name: emp?.costCenter?.name ?? '',
        pay_grade_id: emp?.payGradeId ?? '',
        pay_grade_name: emp?.payGrade?.name ?? '',
        band_id: emp?.bandId ?? '',
        band_name: emp?.band?.name ?? '',

        // ====================== NOTICE PERIOD POLICY ======================
        ...(() => {
            const active = (emp?.noticePeriodPolicies || []).find(p => !p.deletedAt) || emp?.noticePeriodPolicies?.[0];
            return {
                notice_period_policy_id: active?.policyId ?? '',
                notice_period_policy_name: active?.policy?.title ?? '',
                notice_period_duration_value: active?.policy?.durationValue ?? '',
                notice_period_duration_unit: active?.policy?.durationUnit ?? '',
            };
        })(),

        first_name: emp?.firstName ?? '',
        last_name: emp?.lastName ?? '',
        full_name: emp?.fullName ?? '',
        email: emp?.email ?? '',
        phone: emp?.phone ?? '',
        alt_phone: emp?.altPhone ?? '',
        gender: emp?.gender ?? '',

        // ====================== PERSONAL / PROFILE ======================
        display_name: emp?.displayName ?? '',
        marital_status: emp?.maritalStatus ?? '',
        blood_group: emp?.bloodGroup ?? '',
        physically_handicapped: emp?.physicallyHandicapped ?? false,
        nationality: emp?.nationality ?? '',
        personal_email: emp?.personalEmail ?? '',
        professional_summary: emp?.professionalSummary ?? '',
        current_address: emp?.currentAddress
            ? (typeof emp.currentAddress === 'string' ? emp.currentAddress : JSON.stringify(emp.currentAddress))
            : '',
        permanent_address: emp?.permanentAddress
            ? (typeof emp.permanentAddress === 'string' ? emp.permanentAddress : JSON.stringify(emp.permanentAddress))
            : '',

        admin_of_organization: emp?.isAdmin || false,
        is_active: emp?.isActive ?? true,
        login_status: emp?.isActive === false ? 'Disabled' : 'Registered',
        login_registered_at: emp?.createdAt ? formatLoginRegistrationDate(emp.createdAt) : null,

        date_of_birth: emp?.dateOfBirth
            ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            })
            : '',

        joining_date: effectiveJoiningDate(emp)
            ? new Date(effectiveJoiningDate(emp)).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            })
            : '',

        // ====================== PROBATION (direct assignment) ======================
        probation_policy_id: emp?.probationPolicyId ?? '',
        probation_start_date: emp?.probationStartDate
            ? new Date(emp.probationStartDate).toISOString()
            : '',
        probation_end_date: emp?.probationEndDate
            ? new Date(emp.probationEndDate).toISOString()
            : '',
        probation_extended_by_months: emp?.probationExtendedByMonths ?? 0,

        is_permanent: emp?.isPermanent ?? false,
        worker_type: emp?.workerType || (emp?.isPermanent ? 'PERMANENT' : ''),

        // Derived employment status: PERMANENT | PROBATION | INTERNSHIP | TRAINEE | CONTRACT
        // Probation-aware: a permanent worker currently in probation shows PROBATION.
        employment_status: deriveEmploymentStatus(emp),

        created_at: emp?.createdAt ? formatDate(emp.createdAt) : null,
        updated_at: emp?.updatedAt ? formatDate(emp.updatedAt) : null,
        deleted_at: emp?.deletedAt ? formatDate(emp.deletedAt) : null,

        // ====================== PROBATION (derived) ======================
        probation: deriveProbation(emp),

        // ====================== ORGANIZATION ======================
        organization: emp?.organization
            ? {
                id: emp.organization.id ?? '',
                name: emp.organization.name ?? '',
                domain: emp.organization.domain ?? '',
                gst_number: emp.organization.GSTNumber ?? '',
                email: emp.organization.email ?? '',
                contact_person_name: emp.organization.contactPersonName ?? '',
                contact_person_number: emp.organization.contactPersonNumber ?? '',
                note: emp.organization.note ?? '',
                industry: emp.organization.industry ?? '',
                size: emp.organization.size ?? 0,

                address: emp.organization.address
                    ? JSON.stringify(emp.organization.address)
                    : '',

                created_at: emp.organization.createdAt
                    ? formatDate(emp.organization.createdAt)
                    : null,
                updated_at: emp.organization.updatedAt
                    ? formatDate(emp.organization.updatedAt)
                    : null,
                deleted_at: emp.organization.deletedAt
                    ? formatDate(emp.organization.deletedAt)
                    : null,

                max_employees: emp.organization.maxEmployees ?? 0,
                max_storage_in_gb: emp.organization.maxStorageInGB ?? 0,
                max_api_rate_per_minute: emp.organization.maxApiRatePerMin ?? 0,
                max_payroll_runs_per_month: emp.organization.maxPayrollRunsPerMonth ?? 0,
                max_leave_policies: emp.organization.maxLeavePolicies ?? 0,
                max_admin_accounts: emp.organization.maxAdminAccounts ?? 0,
            }
            : null,

        // ====================== CATEGORY ======================
        category: emp?.category
            ? {
                id: emp.category.id ?? '',
                organization_id: emp.category.organizationId ?? '',
                name: emp.category.name ?? '',
                employment_type: emp.category.employmentType ?? '',
                description: emp.category.description ?? '',
                is_active: emp.category.isActive ?? true,

                created_at: emp.category.createdAt
                    ? formatDate(emp.category.createdAt)
                    : null,
                updated_at: emp.category.updatedAt
                    ? formatDate(emp.category.updatedAt)
                    : null,
                deleted_at: emp.category.deletedAt
                    ? formatDate(emp.category.deletedAt)
                    : null,
            }
            : null,

        // ====================== DESIGNATION ======================
        designation: emp?.designation
            ? {
                id: emp.designation.id ?? '',
                organization_id: emp.designation.organizationId ?? '',
                department_id: emp.designation.departmentId ?? '',
                name: emp.designation.name ?? '',
                level: emp.designation.level ?? '',
                description: emp.designation.description ?? '',

                created_at: emp.designation.createdAt
                    ? formatDate(emp.designation.createdAt)
                    : null,
                updated_at: emp.designation.updatedAt
                    ? formatDate(emp.designation.updatedAt)
                    : null,
                deleted_at: emp.designation.deletedAt
                    ? formatDate(emp.designation.deletedAt)
                    : null,
            }
            : null,

        // ====================== BAND ======================
        band: emp?.band
            ? {
                id: emp.band.id ?? '',
                organization_id: emp.band.organizationId ?? '',
                name: emp.band.name ?? '',
                description: emp.band.description ?? '',
                order: emp.band.order ?? 0,
            }
            : null,

        // ============== DEPARTMENTS (ARRAY) ==============
        departments: emp?.departmentAssignments?.length
            ? emp.departmentAssignments.map(a => ({
                // Assignment-level fields
                id: a?.id ?? '',
                department_id: a?.departmentId ?? '',
                reporting_to: a?.reportingTo ?? null,
                start_date: a?.startDate ? formatDate(a.startDate) : null,
                end_date: a?.endDate ? formatDate(a.endDate) : null,
                created_at: a?.createdAt ? formatDate(a.createdAt) : null,
                updated_at: a?.updatedAt ? formatDate(a.updatedAt) : null,
                deleted_at: a?.deletedAt ? formatDate(a.deletedAt) : null,

                // Department object
                department: a?.department
                    ? {
                        id: a.department.id ?? '',
                        organization_id: a.department.organizationId ?? '',
                        name: a.department.name ?? '',
                        code: a.department.code ?? '',
                        description: a.department.description ?? '',
                        note: a.department.note ?? '',
                        parent_id: a.department.parentId ?? null,
                        parent: a.department.parent
                            ? { id: a.department.parent.id, name: a.department.parent.name }
                            : null,

                        department_head_id: a.department.departmentHeadId ?? '',
                        department_head_start_date:
                            a.department.departmentHeadStartDate
                                ? formatDate(a.department.departmentHeadStartDate)
                                : null,

                        created_at: a.department.createdAt
                            ? formatDate(a.department.createdAt)
                            : null,
                        updated_at: a.department.updatedAt
                            ? formatDate(a.department.updatedAt)
                            : null,
                        deleted_at: a.department.deletedAt
                            ? formatDate(a.department.deletedAt)
                            : null
                    }
                    : null
            }))
            : [],

    }
}



/* ------------------------------------------------------------------ */
/* 🧩 Employee Permissions & Modules                                  */
/* ------------------------------------------------------------------ */

// Resolve the set of permission keys a given employee has through their
// role assignments (employee → roles → role_permissions → permission.key),
// restricted to the employee's organization. Returns both the raw
// permission keys and the distinct org module keys those permissions map to.
async function resolveEmployeePermissions(employeeId, organizationId) {
    const permissionKeys = new Set();
    const moduleKeys = new Set();

    if (!employeeId) return { permission_keys: [], module_keys: [] };

    const assignments = await prisma.employeeRoleAssignments.findMany({
        where: {
            employeeId,
            deletedAt: null,
            ...(organizationId ? { organizationId } : {}),
        },
        include: {
            role: {
                include: {
                    permissions: {
                        where: { deletedAt: null },
                        include: { permission: true },
                    },
                },
            },
        },
    });

    for (const a of assignments) {
        const role = a.role;
        if (!role?.isActive || role.deletedAt) continue;
        for (const rp of role.permissions || []) {
            const perm = rp.permission;
            if (!perm?.isActive || perm.deletedAt || !perm.key) continue;
            permissionKeys.add(perm.key);
            const idx = perm.key.lastIndexOf('.');
            const moduleKey = idx > 0 ? perm.key.slice(0, idx) : perm.group || '';
            if (moduleKey) moduleKeys.add(moduleKey);
        }
    }

    return {
        permission_keys: Array.from(permissionKeys),
        module_keys: Array.from(moduleKeys),
    };
}

async function main() {
    await checkDbConnection('employee-service');
    const server = new grpc.Server();
    server.addService(employeeProto.EmployeeService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[employee-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[employee-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[employee-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[employee-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[employee-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[employee-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[employee-service] Fatal error:', err);
    process.exit(1);
});
