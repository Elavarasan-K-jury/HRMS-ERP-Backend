import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { sendOtpEmail } from '@jury-hrms/mailer';
import dotenv from 'dotenv';
dotenv.config();
import { signAccessToken, signRefreshToken, verifyToken, ACCESS_EXPIRES_IN } from '@jury-hrms/auth/jwt.js';

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000); // default 5 min

const PORT = Number(process.env.EMP_SERVICE_PORT || 5053);
const employeeProto = loadProto('employee');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */

function genOtp() {
    const env = process.env.ENVIRONMENT || 'DEVELOPMENT';
    if (env === 'DEVELOPMENT') return '123456';
    return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

function normEmail(email) {
    return (email || '').trim().toLowerCase();
}
function normPhone(phone) {
    return (phone || '').trim();
}

async function findEmployeeByEMailOrPhone({ email, phone }) {
    const e = normEmail(email);
    const p = normPhone(phone);
    if (e) return await prisma.organizationEmployees.findFirst({ where: { email: e, deletedAt: null } });
    if (p) return await prisma.organizationEmployees.findFirst({ where: { phone: p, deletedAt: null } });
    return null;
}
const impl = {
    CreateEmployee: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.organization_id || !data.designation_id || !data.category_id || !data.phone) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'organization_id, designation_id, category_id, and phone are required.',
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

            // Validate designation if provided
            if (data.designation_id) {
                const designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id,
                        deletedAt: null,
                    },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
            }

            const categoryExists = await prisma.employeeCategories.findFirst({
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


            const getEmployeeCode = () => {
                const totalEmployee = organizationExists.totalEmployee
                const employeeCode = `${categoryExists.idPrefix}-${totalEmployee + 1}`
                return employeeCode
            }


            const mappedData = {
                organizationId: data.organization_id,
                categoryId: data.category_id,
                designationId: data.designation_id || null,
                employeeCode: getEmployeeCode(),
                firstName: data.first_name || null,
                lastName: data.last_name || null,
                fullName: data.full_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                email: data.email || null,
                phone: data.phone,
                altPhone: data.alt_phone || null,
                gender: data.gender ? data.gender.toUpperCase() : null,
                dateOfBirth: new Date(data.date_of_birth),
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null
            };


            const employee = await prisma.organizationEmployees.create({
                data: mappedData,
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                },
            });
            await prisma.organizations.update({
                where: { id: data.organization_id },
                data: { totalEmployee: organizationExists.totalEmployee + 1, activeEmployee: organizationExists.activeEmployee + 1 },
            });

            callback(null, {
                employee: mapEmployee(employee),
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
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: true
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
                    designation: true,
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
                department_id
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

            // Handle department filter
            if (department_id && department_id !== '') {
                where = {
                    ...where,
                    departmentAssignments: {
                        some: {
                            departmentId: department_id,
                        },
                    },
                };
            }

            const employees = await prisma.organizationEmployees.findMany({
                where,
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

    ListEmployees: async (call, callback) => {
        try {
            const {
                organization_id,
                category_id,
                designation_id,
                department_id,
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

            // Handle category filter
            if (category_id && category_id !== '') {
                where = {
                    ...where,
                    categoryId: category_id,
                };
            }

            // Handle designation filter
            if (designation_id && designation_id !== '') {
                where = {
                    ...where,
                    designationId: designation_id,
                };
            }

            // Handle department filter through departmentAssignments
            if (department_id && department_id !== '') {
                where = {
                    ...where,
                    departmentId: department_id
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
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: true,
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

            // Validate designation if provided
            if (data.designation_id && data.designation_id !== existing.designationId) {
                const designationExists = await prisma.organizationDesignations.findFirst({
                    where: {
                        id: data.designation_id,
                        organizationId: data.organization_id || existing.organizationId,
                        deletedAt: null,
                    },
                });

                if (!designationExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: 'Designation not found in organization.',
                    });
                }
            }
            const getEmployeeCode = () => {
                const totalEmployee = organizationExists.totalEmployee
                const employeeCode = `${categoryExists.idPrefix}-${totalEmployee + 1}`
                return employeeCode
            }


            const updateData = {
                organizationId: data.organization_id ?? existing.organizationId,
                categoryId: data.category_id ?? existing.categoryId,
                designationId: data.designation_id ?? existing.designationId,
                employeeCode: existing.employeeCode || getEmployeeCode(),
                firstName: data.first_name ?? existing.firstName,
                lastName: data.last_name ?? existing.lastName,
                fullName: data.full_name || `${data.first_name || existing.firstName || ''} ${data.last_name || existing.lastName || ''}`.trim(),
                email: data.email ?? existing.email,
                phone: data.phone ?? existing.phone,
                altPhone: data.alt_phone ?? existing.altPhone,
                gender: data.gender ? data.gender.toUpperCase() : existing.gender,
                dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth) : existing.dateOfBirth,
                updatedAt: new Date(),
            };

            const updated = await prisma.organizationEmployees.update({
                where: { id: data.id },
                data: updateData,
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                },
            });

            callback(null, {
                employee: mapEmployee(updated),
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

    RequestLoginOtp: async (call, cb) => {
        try {
            const { email, phone, purpose = 'login' } = call.request;

            const employee = await findEmployeeByEMailOrPhone({ email, phone });

            if (!employee) return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

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

            cb(null, { message: 'OTP sent to registered email', success: true });
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
            if (payload.scope == 'employee') {
                user = await prisma.organizationEmployees.findFirst({
                    where: {
                        id: payload.sub,
                        deletedAt: null
                    },
                    include: {
                        organization: true,
                        category: true,
                        designation: true,
                        departmentAssignments: {
                            where: { deletedAt: null },
                            include: {
                                department: true
                            }
                        }
                    }
                });
                if (!user) {
                    return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid or expired token' });
                }
            }

            cb(null, {
                success: true,
                message: 'Token verified successfully',
                sub: payload.sub || '',
                user: mapEmployee(user),
                email: payload.email || '',
                scope: payload.scope || '',
                typ: payload.typ || 'access',
                iat: payload.iat ? String(payload.iat) : '',
                exp: payload.exp ? String(payload.exp) : '',
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },


    VerifyLoginOtp: async (call, cb) => {
        try {
            const { email, phone, otp } = call.request;

            const employee = await findEmployeeByEMailOrPhone({ email, phone });
            if (!employee) return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            // Get the latest (not soft-deleted) OTP
            const record = await prisma.otps.findFirst({
                where: { employeeId: employee.id, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            if (!record) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'OTP not found' });

            const age = Date.now() - new Date(record.createdAt).getTime();
            if (age > OTP_TTL_MS) {
                // mark expired/consumed to avoid re-use
                await prisma.otps.update({
                    where: { id: record.id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'OTP expired' });
            }

            if (record.otp !== otp) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid OTP' });
            }

            // consume OTP
            // await prisma.otps.update({
            //     where: { id: record.id },
            //     data: { deletedAt: new Date(), updatedAt: new Date() },
            // });

            const access_token = await signAccessToken({ sub: employee.id, email: employee.email, scope: 'employee' });
            const refresh_token = await signRefreshToken({ sub: employee.id, typ: 'refresh' });

            await prisma.organizationEmployees.update({
                where: { id: employee.id },
                data: { accessToken: access_token, refreshToken: refresh_token, updatedAt: new Date() },
            });

            const empData = await prisma.organizationEmployees.findFirst({
                where: {
                    id: employee.id,
                    deletedAt: null
                },
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: true
                        }
                    }
                }
            });


            cb(null, {
                success: true,
                message: 'OTP verified successfully',
                access_token,
                refresh_token,
                token_type: 'Bearer',
                expires_in: String(ACCESS_EXPIRES_IN),
                employee: mapEmployee(empData),
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

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: payload.sub, deletedAt: null } });
            if (!employee || employee.refreshToken !== refresh_token) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Refresh token mismatch' });
            }

            // rotate tokens
            const newAccess = await signAccessToken({ sub: employee.id, email: employee.email, scope: 'employee' });
            const newRefresh = await signRefreshToken({ sub: employee.id, typ: 'refresh' });

            await prisma.organizationEmployees.update({
                where: { id: employee.id },
                data: { accessToken: newAccess, refreshToken: newRefresh, updatedAt: new Date() },
            });

            const empData = await prisma.organizationEmployees.findFirst({
                where: {
                    id: employee.id,
                    deletedAt: null
                },
                include: {
                    organization: true,
                    category: true,
                    designation: true,
                    departmentAssignments: {
                        where: { deletedAt: null },
                        include: {
                            department: true
                        }
                    }
                }
            });

            cb(null, {
                success: true,
                message: 'Tokens refreshed successfully',
                access_token: newAccess,
                refresh_token: newRefresh,
                token_type: 'Bearer',
                expires_in: String(ACCESS_EXPIRES_IN),
                employee: mapEmployee(empData),
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

        employee_code: emp?.employeeCode ?? '',
        first_name: emp?.firstName ?? '',
        last_name: emp?.lastName ?? '',
        full_name: emp?.fullName ?? '',
        email: emp?.email ?? '',
        phone: emp?.phone ?? '',
        alt_phone: emp?.altPhone ?? '',
        gender: emp?.gender ?? '',

        date_of_birth: emp?.dateOfBirth
            ? new Date(emp.dateOfBirth).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            })
            : '',

        created_at: emp?.createdAt ? formatDate(emp.createdAt) : null,
        updated_at: emp?.updatedAt ? formatDate(emp.updatedAt) : null,
        deleted_at: emp?.deletedAt ? formatDate(emp.deletedAt) : null,

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
                code: emp.category.code ?? '',
                description: emp.category.description ?? '',
                id_prefix: emp.category.idPrefix ?? '',

                is_permanent: emp.category.isPermanent ?? false,
                benefits_applicable: emp.category.benefitsApplicable ?? false,
                is_active: emp.category.isActive ?? true,

                training_required: emp.category.trainingRequired ?? false,
                training_months: emp.category.trainingMonths ?? 0,

                probation_required: emp.category.probationRequired ?? false,
                probation_months: emp.category.probationMonths ?? 0,

                notice_required: emp.category.noticeRequired ?? false,
                notice_months: emp.category.noticeMonths ?? 0,

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