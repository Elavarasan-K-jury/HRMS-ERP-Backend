import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { sendOtpEmail } from '@jury-hrms/mailer';
import { signAccessToken, signRefreshToken, verifyToken, getAccessExpiresIn } from '@jury-hrms/auth/jwt.js';
import { success } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.ADMIN_SERVICE_PORT || 5060;
const adminProto = loadProto('admin');

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000); // default 5 min

/* ----------------------------- helpers ----------------------------- */

function toApiAdmin(a) {
    return {
        id: a.id,
        email: a.email,
        phone: a.phone,
        created_at: a.createdAt?.toISOString() || '',
        updated_at: a.updatedAt?.toISOString() || '',
        deleted_at: a.deletedAt?.toISOString() || '',
        is_super_admin: a.isSuperAdmin || false,
    };
}

function toRole(r) {
    return {
        id: r.id,
        organization_id: r.organizationId || '',
        name: r.name,
        description: r.description || '',
        is_system: r.isSystem || false,
        is_active: r.isActive ?? true,
        created_at: r.createdAt?.toISOString() || '',
        updated_at: r.updatedAt?.toISOString() || '',
    };
}

function toPermission(p) {
    return {
        id: p.id,
        key: p.key,
        name: p.name,
        group: p.group,
        description: p.description || '',
        is_active: p.isActive ?? true,
        created_at: p.createdAt?.toISOString() || '',
        updated_at: p.updatedAt?.toISOString() || '',
    };
}

function toModule(m) {
    return {
        id: m.id,
        key: m.key,
        name: m.name,
        icon: m.icon || '',
        scope: m.scope || 'organization',
        sort_order: m.sortOrder ?? 0,
        is_active: m.isActive ?? true,
        parent_id: m.parentId || '',
        children: (m.children || []).map(toModule),
        actions: (m.actions && m.actions.length) ? m.actions : DEFAULT_MODULE_ACTIONS,
        created_at: m.createdAt?.toISOString() || '',
        updated_at: m.updatedAt?.toISOString() || '',
    };
}

const MODULE_ACTIONS = ['create', 'view', 'edit', 'delete', 'manage'];
const DEFAULT_MODULE_ACTIONS = [...MODULE_ACTIONS];

function toAuditLog(l) {
    return {
        id: l.id,
        admin_id: l.adminId || '',
        organization_id: l.organizationId || '',
        action: l.action || '',
        entity_type: l.entityType || '',
        entity_id: l.entityId || '',
        changes: l.changes ? JSON.stringify(l.changes) : '',
        ip_address: l.ipAddress || '',
        user_agent: l.userAgent || '',
        created_at: l.createdAt?.toISOString() || '',
    };
}

function toSystemConfig(c) {
    return {
        key: c.key,
        value: JSON.stringify(c.value),
        description: c.description || '',
        updated_by_id: c.updatedById || '',
        created_at: c.createdAt?.toISOString() || '',
        updated_at: c.updatedAt?.toISOString() || '',
    };
}

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

function getAuthenticationType({ email }) {
    return normEmail(email) ? 'Basic' : 'Mobile OTP';
}

async function findAdminByEmailOrPhone({ email, phone }) {
    const e = normEmail(email);
    const p = normPhone(phone);
    if (e) return await prisma.admins.findFirst({ where: { email: e, deletedAt: null } });
    if (p) return await prisma.admins.findFirst({ where: { phone: p, deletedAt: null } });
    return null;
}

/* ----------------------------- audit helper ----------------------------- */

// Create/refresh permissions for the given module actions. Never deletes —
// used on module creation and when actions are simply added/extended.
async function syncModulePermissions(moduleName, moduleKey, actions = MODULE_ACTIONS) {
    try {
        for (const action of actions) {
            const key = `${moduleKey}.${action}`;
            const name = `${moduleName} — ${action.charAt(0).toUpperCase()}${action.slice(1)}`;
            await prisma.adminPermission.upsert({
                where: { key },
                update: { name, group: moduleName, description: `${moduleName} ${action} access`, deletedAt: null },
                create: { key, name, group: moduleName, description: `${moduleName} ${action} access`, deletedAt: null },
            });
        }
    } catch (e) {
        console.error('[module] Failed to sync module permissions:', e.message);
    }
}

// Make `actions` authoritative for a module: upsert perms for the selected
// actions and soft-delete perms (+ their role joins) for deselected ones.
// Uses an explicit key loop — never regex `startsWith` on user input.
async function reconcileModulePermissions(moduleName, moduleKey, actions = []) {
    const selected = new Set(actions);
    const toKeep = [...MODULE_ACTIONS].filter(a => selected.has(a));
    const toRemove = [...MODULE_ACTIONS].filter(a => !selected.has(a));

    await syncModulePermissions(moduleName, moduleKey, toKeep);

    if (!toRemove.length) return;
    const staleKeys = toRemove.map(a => `${moduleKey}.${a}`);
    try {
        const stalePerms = await prisma.adminPermission.findMany({ where: { key: { in: staleKeys } } });
        const staleIds = stalePerms.map(p => p.id);
        if (staleIds.length) {
            await prisma.adminRolePermissions.updateMany({
                where: { permissionId: { in: staleIds }, deletedAt: null },
                data: { deletedAt: new Date() },
            });
            await prisma.adminPermission.updateMany({
                where: { id: { in: staleIds }, deletedAt: null },
                data: { deletedAt: new Date() },
            });
        }
    } catch (e) {
        console.error('[module] Failed to reconcile removed permissions:', e.message);
    }
}

async function createAuditLog({ adminId, organizationId, action, entityType, entityId, changes, ipAddress, userAgent }) {
    try {
        await prisma.adminAuditLog.create({
            data: {
                adminId,
                organizationId: organizationId || null,
                action,
                entityType,
                entityId: entityId || null,
                changes: changes || {},
                ipAddress: ipAddress || '',
                userAgent: userAgent || '',
                createdAt: new Date(),
                deletedAt: null,
            },
        });
    } catch (e) {
        console.error('[audit] Failed to create audit log:', e.message);
    }
}

/* ---------------------------- implementation ---------------------------- */

const impl = {
    /* =================== AUTH =================== */

    RequestLoginOtp: async (call, cb) => {
        try {
            const { email, phone, purpose = 'login' } = call.request;
            const authentication_type = getAuthenticationType({ email });

            const admin = await findAdminByEmailOrPhone({ email, phone });
            console.log('server.js @ Line 56:', admin);
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            const otp = genOtp();

            await prisma.otps.create({
                data: {
                    adminId: admin.id,
                    otp,
                    purpose,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            // Always send OTP to the admin's email
            sendOtpEmail(admin.email, otp, OTP_TTL_MS / 60000);

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
            let organizationId = '';
            if (payload.scope == 'admin') {
                user = await prisma.admins.findFirst({ where: { id: payload.sub, deletedAt: null, accessToken: token } });
                if (!user) {
                    return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid or expired token' });
                }
                // First org-scoped role assignment (drives post-login org redirect)
                const assignment = await prisma.adminRoleAssignments.findFirst({
                    where: { adminId: user.id, deletedAt: null, organizationId: { not: null } },
                    orderBy: { createdAt: 'asc' },
                });
                organizationId = assignment?.organizationId || '';
            }

            cb(null, {
                success: true,
                message: 'Token verified successfully',
                sub: payload.sub || '',
                user: JSON.stringify({
                    id: user?.id || '',
                    email: user?.email || '',
                    phone: user?.phone || '',
                    is_super_admin: user?.isSuperAdmin || false,
                    organization_id: organizationId,
                }) || '',
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
            const { email, phone, otp } = call.request;
            const authentication_type = getAuthenticationType({ email });

            const admin = await findAdminByEmailOrPhone({ email, phone });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            // Get the latest (not soft-deleted) OTP
            const record = await prisma.otps.findFirst({
                where: { adminId: admin.id, deletedAt: null },
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
            await prisma.otps.update({
                where: { id: record.id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            // 👑 SUPER_ADMIN promotion on login (email or phone)
            const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
            const superAdminPhone = process.env.SUPER_ADMIN_PHONE;
            const matchesSuperAdmin = (
                (superAdminEmail && normEmail(admin.email) === normEmail(superAdminEmail)) ||
                (superAdminPhone && normPhone(admin.phone) === normPhone(superAdminPhone))
            );
            if (matchesSuperAdmin && !admin.isSuperAdmin) {
                await prisma.admins.update({
                    where: { id: admin.id },
                    data: { isSuperAdmin: true },
                });
                admin.isSuperAdmin = true;
            }

            // 🏅 Ensure super admin is assigned to the Super Admin system role so
            // they appear in role assignment lists (their access also comes from
            // the isSuperAdmin flag, but the row keeps the UI consistent).
            if (matchesSuperAdmin) {
                const superAdminRoleId = '000000000000000000000001';
                const existing = await prisma.adminRoleAssignments.findFirst({
                    where: { adminId: admin.id, roleId: superAdminRoleId, deletedAt: null },
                });
                if (!existing) {
                    await prisma.adminRoleAssignments.create({
                        data: { adminId: admin.id, roleId: superAdminRoleId, deletedAt: null },
                    });
                }
            }

            const access_token = await signAccessToken({ sub: admin.id, email: admin.email, scope: 'admin', authentication_type });
            const refresh_token = await signRefreshToken({ sub: admin.id, typ: 'refresh', authentication_type });

            await prisma.admins.update({
                where: { id: admin.id },
                data: { accessToken: access_token, refreshToken: refresh_token, updatedAt: new Date() },
            });

            cb(null, {
                success: true,
                message: 'OTP verified successfully',
                access_token,
                refresh_token,
                token_type: 'Bearer',
                authentication_type,
                expires_in: String(getAccessExpiresIn()),
                admin: toApiAdmin(admin),
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

            const admin = await prisma.admins.findFirst({ where: { id: payload.sub, deletedAt: null } });
            if (!admin || admin.refreshToken !== refresh_token) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Refresh token mismatch' });
            }

            // rotate tokens
            const authentication_type = payload.authentication_type || '';
            const newAccess = await signAccessToken({ sub: admin.id, email: admin.email, scope: 'admin', authentication_type });
            const newRefresh = await signRefreshToken({ sub: admin.id, typ: 'refresh', authentication_type });

            await prisma.admins.update({
                where: { id: admin.id },
                data: { accessToken: newAccess, refreshToken: newRefresh, updatedAt: new Date() },
            });

            cb(null, {
                success: true,
                message: 'Tokens refreshed successfully',
                access_token: newAccess,
                refresh_token: newRefresh,
                token_type: 'Bearer',
                authentication_type,
                expires_in: String(getAccessExpiresIn()),
                admin: toApiAdmin(admin),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== CRUD =================== */

    CreateAdmin: async (call, cb) => {
        try {
            const email = normEmail(call.request.email);
            const phone = normPhone(call.request.phone);

            if (!email || !phone) {
                return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'email and phone are required' });
            }

            const exists = await prisma.admins.findFirst({
                where: { deletedAt: null, OR: [{ email }, { phone }] },
            });
            if (exists) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Admin already exists' });

            // First admin becomes super admin (unless SUPER_ADMIN_EMAIL or SUPER_ADMIN_PHONE is set)
            const superAdminEmail = normEmail(process.env.SUPER_ADMIN_EMAIL || '');
            const superAdminPhone = normPhone(process.env.SUPER_ADMIN_PHONE || '');
            const totalAdmins = await prisma.admins.count({ where: { deletedAt: null } });
            const shouldBeSuperAdmin = (superAdminEmail || superAdminPhone)
                ? (superAdminEmail && email === superAdminEmail) || (superAdminPhone && phone === superAdminPhone)
                : totalAdmins === 0;

            const admin = await prisma.admins.create({
                data: {
                    email,
                    phone,
                    accessToken: null,
                    refreshToken: null,
                    isSuperAdmin: shouldBeSuperAdmin,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            await createAuditLog({
                adminId: admin.id,
                organizationId: null,
                action: 'create',
                entityType: 'admin',
                entityId: admin.id,
                changes: { email, phone, isSuperAdmin: shouldBeSuperAdmin },
            });

            cb(null, {
                success: true,
                message: 'Admin created successfully',
                admin: toApiAdmin(admin)
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateAdmin: async (call, cb) => {
        try {
            const { id } = call.request;
            const email = call.request.email ? normEmail(call.request.email) : undefined;
            const phone = call.request.phone ? normPhone(call.request.phone) : undefined;
            const is_super_admin = call.request.is_super_admin;

            const admin = await prisma.admins.findFirst({ where: { id, deletedAt: null } });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            // Prevent duplicate email/phone
            if (email || phone) {
                const dup = await prisma.admins.findFirst({
                    where: {
                        deletedAt: null,
                        id: { not: id },
                        OR: [
                            email ? { email } : undefined,
                            phone ? { phone } : undefined
                        ].filter(Boolean),
                    },
                });
                if (dup) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Email or phone already in use' });
            }

            const updated = await prisma.admins.update({
                where: { id },
                data: {
                    email: email ?? admin.email,
                    phone: phone ?? admin.phone,
                    ...(is_super_admin !== undefined ? { isSuperAdmin: is_super_admin } : {}),
                    updatedAt: new Date(),
                },
            });

            await createAuditLog({
                adminId: id,
                organizationId: null,
                action: 'update',
                entityType: 'admin',
                entityId: id,
                changes: { email, phone, is_super_admin },
            });

            cb(null, {
                success: true,
                message: 'Admin updated successfully',
                admin: toApiAdmin(updated)
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetAdmin: async (call, cb) => {
        try {
            const { id } = call.request;
            const admin = await prisma.admins.findFirst({ where: { id, deletedAt: null } });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });
            cb(null, {
                success: true,
                message: 'Admin found successfully',
                admin: toApiAdmin(admin)
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListAdmins: async (call, cb) => {
        try {
            const { page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc', organization_id } = call.request;
            const skip = (page - 1) * limit;

            const fieldMap = { email: 'email', phone: 'phone', created_at: 'createdAt' };
            const orderByField = fieldMap[sort_by] || 'createdAt';
            const order = (sort_order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

            const where = {
                deletedAt: null,
                ...(organization_id
                    ? {
                          AND: [
                              { isSuperAdmin: false },
                              {
                                  id: {
                                      in: await prisma.adminRoleAssignments
                                          .findMany({
                                              where: { organizationId: organization_id },
                                              select: { adminId: true },
                                          })
                                          .then((r) => r.map((x) => x.adminId)),
                                  },
                              },
                          ],
                      }
                    : {}),
                OR: search
                    ? [
                        { email: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } },
                    ]
                    : undefined,
            };

            const total = await prisma.admins.count({ where });
            const rows = await prisma.admins.findMany({
                where,
                orderBy: { [orderByField]: order },
                skip,
                take: limit,
            });

            cb(null, {
                success: true,
                message: 'Admins found successfully',
                admins: rows.map(toApiAdmin),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteAdmin: async (call, cb) => {
        try {
            const { id } = call.request;
            const admin = await prisma.admins.findFirst({ where: { id, deletedAt: null } });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            await prisma.admins.update({
                where: { id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            await createAuditLog({
                adminId: id,
                organizationId: null,
                action: 'delete',
                entityType: 'admin',
                entityId: id,
            });

            cb(null, {
                success: true,
                message: 'Admin soft-deleted successfully'
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Roles =================== */

    CreateRole: async (call, cb) => {
        try {
            const { organization_id, name, description } = call.request;
            if (!name) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Role name is required' });

            const role = await prisma.adminRoles.create({
                data: {
                    organizationId: organization_id || null,
                    name,
                    description: description || '',
                    isSystem: false,
                    isActive: true,
                    deletedAt: null,
                },
            });

            await createAuditLog({
                adminId: call.request.admin_id || null,
                organizationId: organization_id || null,
                action: 'create',
                entityType: 'role',
                entityId: role.id,
                changes: { name, description, isSystem: false },
            });

            cb(null, { success: true, message: 'Role created successfully', role: toRole(role) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateRole: async (call, cb) => {
        try {
            const { id, name, description, is_active } = call.request;
            const existing = await prisma.adminRoles.findFirst({ where: { id, deletedAt: null } });
            if (!existing) return cb({ code: grpc.status.NOT_FOUND, message: 'Role not found' });
            if (existing.isSystem) return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Cannot modify system role' });

            const role = await prisma.adminRoles.update({
                where: { id },
                data: {
                    ...(name !== undefined ? { name } : {}),
                    ...(description !== undefined ? { description } : {}),
                    ...(is_active !== undefined ? { isActive: is_active } : {}),
                },
            });

            await createAuditLog({
                adminId: call.request.admin_id || null,
                organizationId: role.organizationId,
                action: 'update',
                entityType: 'role',
                entityId: id,
                changes: { name, description, is_active },
            });

            cb(null, { success: true, message: 'Role updated successfully', role: toRole(role) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetRole: async (call, cb) => {
        try {
            const { id } = call.request;
            const role = await prisma.adminRoles.findFirst({ where: { id, deletedAt: null } });
            if (!role) return cb({ code: grpc.status.NOT_FOUND, message: 'Role not found' });
            cb(null, { success: true, message: 'Role found', role: toRole(role) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListRoles: async (call, cb) => {
        try {
            const { organization_id, page = 1, limit = 10 } = call.request;
            const skip = (page - 1) * limit;
            const where = { deletedAt: null, ...(organization_id ? { organizationId: organization_id } : {}) };

            const total = await prisma.adminRoles.count({ where });
            const rows = await prisma.adminRoles.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } });

            cb(null, {
                success: true, message: 'Roles found',
                roles: rows.map(toRole), total, page, limit,
                total_pages: Math.ceil(total / limit),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteRole: async (call, cb) => {
        try {
            const { id } = call.request;
            const role = await prisma.adminRoles.findFirst({ where: { id, deletedAt: null } });
            if (!role) return cb({ code: grpc.status.NOT_FOUND, message: 'Role not found' });
            if (role.isSystem) return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Cannot delete system role' });

            await prisma.adminRoles.update({ where: { id }, data: { deletedAt: new Date() } });

            await createAuditLog({
                adminId: call.request.admin_id || null,
                organizationId: role.organizationId,
                action: 'delete',
                entityType: 'role',
                entityId: id,
            });

            cb(null, { success: true, message: 'Role deleted successfully' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Permissions =================== */

    ListPermissions: async (call, cb) => {
        try {
            const { group, page = 1, limit = 100 } = call.request;
            const skip = (page - 1) * limit;
            const where = { deletedAt: null, ...(group ? { group } : {}) };

            const total = await prisma.adminPermission.count({ where });
            const rows = await prisma.adminPermission.findMany({ where, skip, take: limit, orderBy: { group: 'asc' } });

            cb(null, {
                success: true, message: 'Permissions found',
                permissions: rows.map(toPermission), total, page, limit,
                total_pages: Math.ceil(total / limit),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Modules =================== */

    ListModules: async (call, cb) => {
        try {
            const { scope, parent_id } = call.request;
            const page = Number(call.request.page) > 0 ? Number(call.request.page) : 1;
            const limit = Number(call.request.limit) > 0 ? Number(call.request.limit) : 100;
            const skip = (page - 1) * limit;
            const where = {
                deletedAt: null,
                ...(scope ? { scope } : {}),
                ...(parent_id ? { parentId: parent_id } : {}),
            };

            const total = await prisma.adminModule.count({ where });
            const rows = await prisma.adminModule.findMany({
                where: { deletedAt: null },
                include: { children: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
                orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }],
            });

            // Build a 2-level tree (top-level → children) for the modules UI.
            const topLevel = rows.filter(r => !r.parentId);
            const childrenMap = {};
            for (const r of rows) if (r.parentId) (childrenMap[r.parentId] = childrenMap[r.parentId] || []).push(r);
            const tree = topLevel.map(m => ({ ...m, children: (childrenMap[m.id] || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) }));

            let result = tree;
            if (scope) result = result.filter(m => (m.scope === 'super_admin' ? 'super_admin' : 'organization') === scope);
            if (parent_id) result = result.filter(m => m.id === parent_id);

            cb(null, {
                success: true, message: 'Modules found',
                modules: result.map(toModule), total: result.length, page, limit,
                total_pages: Math.ceil(result.length / limit),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    CreateModule: async (call, cb) => {
        try {
            const { key, name, icon, scope = 'organization', sort_order = 0, is_active = true, parent_id = '' } = call.request;
            if (!key || !name) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Module key and name are required' });

            let parent = null;
            if (parent_id) {
                parent = await prisma.adminModule.findFirst({ where: { id: parent_id, deletedAt: null } });
                if (!parent) return cb({ code: grpc.status.NOT_FOUND, message: 'Parent module not found' });
                if (parent.parentId) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Sub-modules cannot have children' });
            }

            // Sub-modules get a full dotted key (parentkey.childkey) so their
            // permissions nest naturally (e.g. payroll.salary_components.view).
            let normalizedKey = key.trim().toLowerCase();
            if (parent) {
                if (normalizedKey.startsWith(parent.key + '.')) normalizedKey = normalizedKey.slice(parent.key.length + 1);
                normalizedKey = `${parent.key}.${normalizedKey}`;
            }

            const exists = await prisma.adminModule.findFirst({ where: { key: normalizedKey, deletedAt: null } });
            if (exists) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Module already exists' });

            // Permission actions to enable. Absent/empty -> full default set.
            const rawActions = Array.isArray(call.request.actions) ? call.request.actions : [];
            const actions = rawActions.length ? [...new Set(rawActions)] : DEFAULT_MODULE_ACTIONS;

            const module = await prisma.adminModule.create({
                data: {
                    key: normalizedKey,
                    name,
                    icon: icon || '',
                    scope: parent ? parent.scope : scope,
                    sortOrder: sort_order,
                    isActive: is_active,
                    parentId: parent ? parent.id : null,
                    actions,
                    deletedAt: null,
                },
            });

            await syncModulePermissions(module.name, normalizedKey, actions);

            cb(null, { success: true, message: 'Module created successfully', module: toModule(module) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateModule: async (call, cb) => {
        try {
            const { id, key, name, icon, scope, sort_order, is_active, parent_id } = call.request;
            const module = await prisma.adminModule.findFirst({ where: { id, deletedAt: null } });
            if (!module) return cb({ code: grpc.status.NOT_FOUND, message: 'Module not found' });

            // Parent changes: move module under a new parent (re-key permissions).
            let newParentId = module.parentId;
            let newKey = module.key;
            if (parent_id && parent_id !== module.parentId) {
                const newParent = await prisma.adminModule.findFirst({ where: { id: parent_id, deletedAt: null } });
                if (!newParent) return cb({ code: grpc.status.NOT_FOUND, message: 'Parent module not found' });
                if (newParent.parentId) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'Sub-modules cannot have children' });
                newParentId = newParent.id;
                const base = key !== undefined && key ? key.trim().toLowerCase() : module.parentId
                    ? module.key.split('.').pop()
                    : module.key;
                newKey = `${newParent.key}.${base}`;
            } else if (key !== undefined) {
                let k = key.trim().toLowerCase();
                if (module.parentId) {
                    const parent = await prisma.adminModule.findFirst({ where: { id: module.parentId, deletedAt: null } });
                    const parentKey = parent ? parent.key : module.key.split('.').slice(0, -1).join('.');
                    if (!k.startsWith(parentKey + '.')) k = `${parentKey}.${k}`;
                }
                newKey = k;
            }

            if (newKey !== module.key) {
                const dup = await prisma.adminModule.findFirst({ where: { key: newKey, deletedAt: null, id: { not: id } } });
                if (dup) return cb({ code: grpc.status.ALREADY_EXISTS, message: 'Module key already in use' });
            }

            const updated = await prisma.adminModule.update({
                where: { id },
                data: {
                    ...(newKey !== module.key ? { key: newKey } : {}),
                    ...(name !== undefined ? { name } : {}),
                    ...(icon !== undefined ? { icon } : {}),
                    ...(scope !== undefined && !module.parentId ? { scope } : {}),
                    ...(sort_order !== undefined ? { sortOrder: sort_order } : {}),
                    ...(is_active !== undefined ? { isActive: is_active } : {}),
                    ...(newParentId !== module.parentId ? { parentId: newParentId } : {}),
                    ...(call.request.reconcile_actions === true && Array.isArray(call.request.actions)
                        ? { actions: [...new Set(call.request.actions)] }
                        : {}),
                },
            });

            // When actions were explicitly sent, make them authoritative (adds
            // missing perms, soft-deletes deselected ones). Otherwise just refresh
            // the module's current action set's permissions (e.g. on rename/re-key).
            if (call.request.reconcile_actions === true) {
                await reconcileModulePermissions(
                    updated.name,
                    updated.key,
                    Array.isArray(call.request.actions) ? call.request.actions : []
                );
            } else {
                const actions = (updated.actions && updated.actions.length) ? updated.actions : DEFAULT_MODULE_ACTIONS;
                await syncModulePermissions(updated.name, updated.key, actions);
            }

            cb(null, { success: true, message: 'Module updated successfully', module: toModule(updated) });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteModule: async (call, cb) => {
        try {
            const { id } = call.request;
            const module = await prisma.adminModule.findFirst({ where: { id, deletedAt: null } });
            if (!module) return cb({ code: grpc.status.NOT_FOUND, message: 'Module not found' });

            // Soft-delete the module and any sub-modules beneath it.
            const childIds = (await prisma.adminModule.findMany({ where: { parentId: id, deletedAt: null }, select: { id: true } })).map(c => c.id);
            const affectedIds = [id, ...childIds];

            await prisma.adminModule.updateMany({ where: { id: { in: affectedIds }, deletedAt: null }, data: { deletedAt: new Date() } });

            // Soft-delete permissions created for these modules.
            const permKeys = [];
            for (const mid of affectedIds) {
                const m = mid === id ? module : await prisma.adminModule.findFirst({ where: { id: mid } });
                if (!m) continue;
                for (const action of MODULE_ACTIONS) permKeys.push(`${m.key}.${action}`);
            }
            if (permKeys.length) {
                await prisma.adminPermission.updateMany({ where: { key: { in: permKeys }, deletedAt: null }, data: { deletedAt: new Date() } });
            }

            cb(null, { success: true, message: 'Module deleted successfully' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Role ↔ Permission =================== */

    AssignPermissionToRole: async (call, cb) => {
        try {
            const { role_id, permission_id } = call.request;
            if (!role_id || !permission_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'role_id and permission_id are required' });

            const existing = await prisma.adminRolePermissions.findFirst({
                where: { roleId: role_id, permissionId: permission_id, deletedAt: null },
            });
            if (existing) return cb({ success: true, message: 'Permission already assigned' });

            await prisma.adminRolePermissions.create({ data: { roleId: role_id, permissionId: permission_id, deletedAt: null } });
            cb(null, { success: true, message: 'Permission assigned to role' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RemovePermissionFromRole: async (call, cb) => {
        try {
            const { role_id, permission_id } = call.request;
            if (!role_id || !permission_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'role_id and permission_id are required' });

            await prisma.adminRolePermissions.updateMany({
                where: { roleId: role_id, permissionId: permission_id, deletedAt: null },
                data: { deletedAt: new Date() },
            });
            cb(null, { success: true, message: 'Permission removed from role' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListRolePermissions: async (call, cb) => {
        try {
            const { role_id } = call.request;
            if (!role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'role_id is required' });

            const rows = await prisma.adminRolePermissions.findMany({
                where: { roleId: role_id, deletedAt: null },
                include: { permission: true },
            });

            const permissions = rows.map(r => toPermission(r.permission));
            const permission_ids = rows.map(r => r.permissionId);

            cb(null, { success: true, message: 'Role permissions found', permission_ids, permissions });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Admin ↔ Role =================== */

    AssignRole: async (call, cb) => {
        try {
            const { admin_id, role_id, organization_id } = call.request;
            if (!admin_id || !role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'admin_id and role_id are required' });

            const existing = await prisma.adminRoleAssignments.findFirst({
                where: { adminId: admin_id, roleId: role_id, deletedAt: null },
            });
            if (existing) return cb({ success: true, message: 'Role already assigned' });

            await prisma.adminRoleAssignments.create({
                data: { adminId: admin_id, roleId: role_id, organizationId: organization_id || null, deletedAt: null },
            });

            await createAuditLog({
                adminId: admin_id,
                organizationId: organization_id || null,
                action: 'assign',
                entityType: 'role_assignment',
                entityId: `${admin_id}:${role_id}`,
                changes: { role_id, organization_id },
            });

            cb(null, { success: true, message: 'Role assigned to admin' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UnassignRole: async (call, cb) => {
        try {
            const { admin_id, role_id, organization_id } = call.request;
            if (!admin_id || !role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'admin_id and role_id are required' });

            const where = {
                adminId: admin_id, roleId: role_id, deletedAt: null,
            };
            if (organization_id) where.organizationId = organization_id;

            const res = await prisma.adminRoleAssignments.updateMany({
                where,
                data: { deletedAt: new Date() },
            });
            if (!res.count) {
                return cb({ success: true, message: 'No active assignment found to unassign' });
            }

            await createAuditLog({
                adminId: admin_id,
                organizationId: organization_id || null,
                action: 'unassign',
                entityType: 'role_assignment',
                entityId: `${admin_id}:${role_id}`,
            });

            cb(null, { success: true, message: 'Role unassigned from admin' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListAdminRoles: async (call, cb) => {
        try {
            const { admin_id } = call.request;
            if (!admin_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'admin_id is required' });

            const rows = await prisma.adminRoleAssignments.findMany({
                where: { adminId: admin_id, deletedAt: null },
                include: { role: true },
            });

            const roles = rows.map(r => toRole(r.role));
            cb(null, { success: true, message: 'Admin roles found', roles });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListRoleAdmins: async (call, cb) => {
        try {
            const { role_id } = call.request;
            if (!role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'role_id is required' });

            const rows = await prisma.adminRoleAssignments.findMany({
                where: { roleId: role_id, deletedAt: null },
                include: { admin: true },
                orderBy: { createdAt: 'asc' },
            });

            const admins = rows.map(r => toApiAdmin(r.admin));
            cb(null, { success: true, message: 'Role admins found', admins });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Employee ↔ Role =================== */

    AssignEmployeeRole: async (call, cb) => {
        try {
            const { employee_id, role_id, organization_id } = call.request;
            if (!employee_id || !role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'employee_id and role_id are required' });

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
            if (!employee) return cb({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });

            const existing = await prisma.employeeRoleAssignments.findFirst({
                where: { employeeId: employee_id, roleId: role_id, deletedAt: null },
            });
            if (existing) return cb({ success: true, message: 'Role already assigned' });

            await prisma.employeeRoleAssignments.create({
                data: { employeeId: employee_id, roleId: role_id, organizationId: organization_id || null, deletedAt: null },
            });
            cb(null, { success: true, message: 'Role assigned to employee' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UnassignEmployeeRole: async (call, cb) => {
        try {
            const { employee_id, role_id, organization_id } = call.request;
            if (!employee_id || !role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'employee_id and role_id are required' });

            const where = {
                employeeId: employee_id, roleId: role_id, deletedAt: null,
            };
            if (organization_id) where.organizationId = organization_id;

            const res = await prisma.employeeRoleAssignments.updateMany({
                where,
                data: { deletedAt: new Date() },
            });
            if (!res.count) {
                return cb({ success: true, message: 'No active assignment found to unassign' });
            }
            cb(null, { success: true, message: 'Role unassigned from employee' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListRoleEmployees: async (call, cb) => {
        try {
            const { role_id } = call.request;
            if (!role_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'role_id is required' });

            const rows = await prisma.employeeRoleAssignments.findMany({
                where: { roleId: role_id, deletedAt: null },
                include: { employee: true },
                orderBy: { createdAt: 'asc' },
            });

            const employees = rows.map(r => ({
                id: r.employee?.id || '',
                organization_id: r.employee?.organizationId || '',
                email: r.employee?.email || '',
                phone: r.employee?.phone || '',
            }));
            cb(null, { success: true, message: 'Role employees found', employees });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListEmployeeRoles: async (call, cb) => {
        try {
            const { employee_id } = call.request;
            if (!employee_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'employee_id is required' });

            const rows = await prisma.employeeRoleAssignments.findMany({
                where: { employeeId: employee_id, deletedAt: null },
                include: { role: true },
            });

            const roles = rows.map(r => toRole(r.role));
            cb(null, { success: true, message: 'Employee roles found', roles });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== RBAC — Resolve Permissions =================== */

    GetAdminPermissions: async (call, cb) => {
        try {
            const { admin_id } = call.request;
            if (!admin_id) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'admin_id is required' });

            const admin = await prisma.admins.findFirst({ where: { id: admin_id, deletedAt: null } });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            // Super admin has all permissions — no need to query roles
            if (admin.isSuperAdmin) {
                const allPerms = await prisma.adminPermission.findMany({ where: { deletedAt: null, isActive: true } });
                return cb(null, {
                    success: true, message: 'Permissions resolved',
                    permission_keys: allPerms.map(p => p.key),
                    is_super_admin: true,
                });
            }

            // Resolve via role assignments
            const assignments = await prisma.adminRoleAssignments.findMany({
                where: { adminId: admin_id, deletedAt: null },
                include: {
                    role: {
                        include: { permissions: { where: { deletedAt: null }, include: { permission: true } } },
                    },
                },
            });

            const keys = new Set();
            for (const a of assignments) {
                if (a.role?.isActive && !a.role.deletedAt) {
                    for (const rp of a.role.permissions) {
                        if (rp.permission?.isActive && !rp.permission.deletedAt) {
                            keys.add(rp.permission.key);
                        }
                    }
                }
            }

            cb(null, {
                success: true, message: 'Permissions resolved',
                permission_keys: Array.from(keys),
                is_super_admin: false,
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== Audit Log =================== */

    ListAuditLogs: async (call, cb) => {
        try {
            const { admin_id, organization_id, action, entity_type, start_date, end_date, page = 1, limit = 10 } = call.request;
            const skip = (page - 1) * limit;
            const where = { deletedAt: null };

            if (admin_id) where.adminId = admin_id;
            if (organization_id) where.organizationId = organization_id;
            if (action) where.action = action;
            if (entity_type) where.entityType = entity_type;
            if (start_date || end_date) {
                where.createdAt = {};
                if (start_date) where.createdAt.gte = new Date(start_date);
                if (end_date) where.createdAt.lte = new Date(end_date);
            }

            const total = await prisma.adminAuditLog.count({ where });
            const rows = await prisma.adminAuditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } });

            cb(null, {
                success: true, message: 'Audit logs found',
                logs: rows.map(toAuditLog), total, page, limit,
                total_pages: Math.ceil(total / limit),
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* =================== System Config =================== */

    GetSystemConfig: async (call, cb) => {
        try {
            const { key } = call.request;
            if (!key) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'key is required' });

            const config = await prisma.systemConfig.findFirst({ where: { key, deletedAt: null } });
            if (!config) return cb({ code: grpc.status.NOT_FOUND, message: 'Config not found' });

            cb(null, { ...toSystemConfig(config), success: true, message: 'Config found' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateSystemConfig: async (call, cb) => {
        try {
            const { key, value, description, admin_id } = call.request;
            if (!key || !value) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'key and value are required' });

            let parsed;
            try { parsed = JSON.parse(value); } catch { parsed = value; }

            const config = await prisma.systemConfig.upsert({
                where: { key },
                update: { value: parsed, description: description || undefined, updatedById: admin_id || undefined },
                create: { key, value: parsed, description: description || '', updatedById: admin_id || null },
            });

            await createAuditLog({
                adminId: admin_id || null,
                organizationId: null,
                action: 'update',
                entityType: 'system_config',
                entityId: key,
                changes: { value: parsed, description },
            });

            cb(null, { success: true, message: 'Config updated successfully' });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ----------------------- graceful main() ----------------------- */

async function main() {
    await checkDbConnection('-service');
    const server = new grpc.Server();

    // ✅ Bind the right service!
    server.addService(adminProto.AdminService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[auth-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[auth-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[auth-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[auth-service] gRPC server stopped.');
                }
            });
            await prisma.$disconnect();
            console.log('[auth-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[auth-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[auth-service] Fatal error:', err);
    process.exit(1);
});
