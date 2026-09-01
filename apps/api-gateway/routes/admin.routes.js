import { success, z, ZodError } from 'zod';
import { adminClient } from '../grpc/admin.client.js';
import { requirePermission } from '../middlewares/require_permission.js';

export default function registerAdminRoutes(app) {
    // ===== Request OTP
    app.openapi(
        {
            method: 'post',
            path: '/admin/login/request-otp',
            tags: ['Admin Auth'],
            summary: 'Request login OTP (email-only delivery)',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                purpose: z.string().optional().default('login'),
                            })
                                .refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'OTP sent',
                    content: { 'application/json': { schema: z.object({ message: z.string(), authentication_type: z.enum(['Basic', 'Mobile OTP']) }) } }
                },
                404: { description: 'Admin not found' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.RequestLoginOtp(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    // ===== Verify Token
    app.openapi({
        method: 'post',
        path: '/auth/verify-token',
        tags: ['Admin Auth'],
        summary: 'Verify a JWT token and return decoded data',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({ token: z.string() })
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Token data',
                content: {
                    'application/json': {
                        schema: z.object({
                            sub: z.string(),
                            user: z.object(),
                            email: z.string().optional(),
                            scope: z.string().optional(),
                            typ: z.string(),
                            iat: z.string(),
                            exp: z.string(),
                            success: z.boolean(),
                            message: z.string(),
                            authentication_type: z.string().optional(),
                        })
                    }
                }
            }
        }
    }, async (c) => {
        try {
            const { token } = await c.req.json();
            const response = await new Promise((resolve, reject) => {
                adminClient.VerifyToken({ token }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json({
                ...response,
                success: true,
                message: 'Token verified successfully',
                user: response.user ? JSON.parse(response.user) : null
            }, 200);
        } catch (error) {
            return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
        }
    });

    // ===== Verify OTP
    app.openapi(
        {
            method: 'post',
            path: '/admin/login/verify',
            tags: ['Admin Auth'],
            summary: 'Verify OTP and get tokens',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                otp: z.string().regex(/^\d{6}$/)
                            }).refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Tokens', content: {
                        'application/json': {
                            schema: z.object({
                                access_token: z.string(),
                                refresh_token: z.string(),
                                token_type: z.string(),
                                expires_in: z.string(),
                                authentication_type: z.enum(['Basic', 'Mobile OTP']),
                                admin: z.object({
                                    id: z.string(),
                                    email: z.string(),
                                    phone: z.string(),
                                    created_at: z.string().optional(),
                                    updated_at: z.string().optional(),
                                    deleted_at: z.string().optional(),
                                })
                            })
                        }
                    }
                },
                403: { description: 'Invalid/expired OTP' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.VerifyLoginOtp(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                const code = error.code === 7 ? 403 : (error.code === 5 ? 404 : 500);
                return c.json({ error: error.message }, code);
            }
        }
    );

    // ===== Refresh tokens
    app.openapi(
        {
            method: 'post',
            path: '/admin/token/refresh',
            tags: ['Admin Auth'],
            summary: 'Issue new tokens using refresh token',
            request: {
                body: { content: { 'application/json': { schema: z.object({ refresh_token: z.string() }) } } }
            },
            responses: { 200: { description: 'Tokens' } }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.RefreshTokens(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 7 ? 403 : 500);
            }
        }
    );

    // ===== Create admin
    const createAdminSchema = z.object({
        email: z.string().email(),
        phone: z.string(),
    });

    app.openapi(
        {
            method: 'post',
            path: '/admins',
            tags: ['Admins'],
            summary: 'Create admin',
            request: {
                body: { content: { 'application/json': { schema: createAdminSchema } } }
            },
            responses: {
                201: {
                    description: 'Created', content: {
                        'application/json': {
                            schema: z.object({
                                admin: z.object({
                                    id: z.string(), email: z.string(), phone: z.string(),
                                    created_at: z.string().optional(), updated_at: z.string().optional()
                                })
                            })
                        }
                    }
                },
                409: { description: 'Already exists' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                createAdminSchema.parse(body);
                const resp = await new Promise((resolve, reject) => {
                    adminClient.CreateAdmin(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 201);
            } catch (error) {
                const code = error.code === 6 ? 409 : 500;
                return c.json({ error: error.message }, code);
            }
        }
    );

    // ===== Update admin
    const updateAdminSchema = z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
    });

    app.openapi(
        {
            method: 'put',
            path: '/admins/{id}',
            tags: ['Admins'],
            summary: 'Update admin',
            request: {
                params: z.object({ id: z.string() }),
                body: { content: { 'application/json': { schema: updateAdminSchema } } }
            },
            responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                updateAdminSchema.parse(body);
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UpdateAdmin({ id, ...body }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                const code = error.code === 5 ? 404 : 500;
                return c.json({ error: error.message }, code);
            }
        }
    );

    // ===== Get single
    app.openapi(
        {
            method: 'get',
            path: '/admins/{id}',
            tags: ['Admins'],
            summary: 'Get admin by id',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Ok' }, 404: { description: 'Not found' } }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.GetAdmin({ id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    // ===== List
    app.openapi(
        {
            method: 'get',
            path: '/admins',
            tags: ['Admins'],
            summary: 'List admins',
            request: {
                query: z.object({
                    page: z.string().optional().default('1').pipe(z.coerce.number()),
                    limit: z.string().optional().default('10').pipe(z.coerce.number()),
                    search: z.string().optional().default(''),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                    organization_id: z.string().optional(),
                })
            },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListAdmins(q, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // ===== Delete (soft)
    app.openapi(
        {
            method: 'delete',
            path: '/admins/{id}',
            tags: ['Admins'],
            summary: 'Soft delete admin',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.DeleteAdmin({ id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    /* =================== RBAC — Roles =================== */

    app.openapi(
        {
            method: 'post', path: '/admin/roles', tags: ['RBAC Roles'],
            summary: 'Create role',
            request: {
                body: { content: { 'application/json': { schema: z.object({ organization_id: z.string().optional(), name: z.string(), description: z.string().optional() }) } } }
            },
            responses: { 201: { description: 'Created' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.CreateRole(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 201);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'put', path: '/admin/roles/{id}', tags: ['RBAC Roles'],
            summary: 'Update role',
            request: {
                params: z.object({ id: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ name: z.string().optional(), description: z.string().optional(), is_active: z.boolean().optional() }) } } }
            },
            responses: { 200: { description: 'Updated' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UpdateRole({ id, ...body }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/roles/{id}', tags: ['RBAC Roles'],
            summary: 'Get role by id',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Ok' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.GetRole({ id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/roles', tags: ['RBAC Roles'],
            summary: 'List roles',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    page: z.string().optional().default('1').pipe(z.coerce.number()),
                    limit: z.string().optional().default('10').pipe(z.coerce.number()),
                })
            },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListRoles(q, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'delete', path: '/admin/roles/{id}', tags: ['RBAC Roles'],
            summary: 'Delete role',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Deleted' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.DeleteRole({ id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    /* =================== RBAC — Permissions =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/permissions', tags: ['RBAC Permissions'],
            summary: 'List all permission keys',
            request: {
                query: z.object({
                    group: z.string().optional(),
                    page: z.string().optional().default('1').pipe(z.coerce.number()),
                    limit: z.string().optional().default('100').pipe(z.coerce.number()),
                })
            },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListPermissions(q, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== RBAC — Role ↔ Permission =================== */

    app.openapi(
        {
            method: 'post', path: '/admin/roles/{roleId}/permissions', tags: ['RBAC Role Permissions'],
            summary: 'Assign permission to role',
            request: {
                params: z.object({ roleId: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ permission_id: z.string() }) } } }
            },
            responses: { 200: { description: 'Assigned' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const roleId = c.req.param('roleId');
                const { permission_id } = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.AssignPermissionToRole({ role_id: roleId, permission_id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'delete', path: '/admin/roles/{roleId}/permissions/{permissionId}', tags: ['RBAC Role Permissions'],
            summary: 'Remove permission from role',
            request: { params: z.object({ roleId: z.string(), permissionId: z.string() }) },
            responses: { 200: { description: 'Removed' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const roleId = c.req.param('roleId');
                const permissionId = c.req.param('permissionId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.RemovePermissionFromRole({ role_id: roleId, permission_id: permissionId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/roles/{roleId}/permissions', tags: ['RBAC Role Permissions'],
            summary: 'List permissions for a role',
            request: { params: z.object({ roleId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const roleId = c.req.param('roleId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListRolePermissions({ role_id: roleId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/roles/{roleId}/admins', tags: ['RBAC Role Admins'],
            summary: 'List admins assigned to a role',
            request: { params: z.object({ roleId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const roleId = c.req.param('roleId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListRoleAdmins({ role_id: roleId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== RBAC — Admin ↔ Role =================== */

    app.openapi(
        {
            method: 'post', path: '/admin/admins/{adminId}/roles', tags: ['RBAC Admin Roles'],
            summary: 'Assign role to admin',
            request: {
                params: z.object({ adminId: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ role_id: z.string(), organization_id: z.string().optional() }) } } }
            },
            responses: { 200: { description: 'Assigned' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const adminId = c.req.param('adminId');
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.AssignRole({ admin_id: adminId, ...body }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'delete', path: '/admin/admins/{adminId}/roles/{roleId}', tags: ['RBAC Admin Roles'],
            summary: 'Unassign role from admin',
            request: { params: z.object({ adminId: z.string(), roleId: z.string() }) },
            responses: { 200: { description: 'Removed' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const adminId = c.req.param('adminId');
                const roleId = c.req.param('roleId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UnassignRole({ admin_id: adminId, role_id: roleId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/admins/{adminId}/roles', tags: ['RBAC Admin Roles'],
            summary: 'List roles assigned to an admin',
            request: { params: z.object({ adminId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const adminId = c.req.param('adminId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListAdminRoles({ admin_id: adminId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== RBAC — Employee ↔ Role =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/roles/{roleId}/employees', tags: ['RBAC Role Employees'],
            summary: 'List employees assigned to a role',
            request: { params: z.object({ roleId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const roleId = c.req.param('roleId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListRoleEmployees({ role_id: roleId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'post', path: '/admin/employees/{employeeId}/roles', tags: ['RBAC Employee Roles'],
            summary: 'Assign role to employee',
            request: {
                params: z.object({ employeeId: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ role_id: z.string(), organization_id: z.string().optional() }) } } }
            },
            responses: { 200: { description: 'Assigned' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const employeeId = c.req.param('employeeId');
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.AssignEmployeeRole({ employee_id: employeeId, ...body }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'delete', path: '/admin/employees/{employeeId}/roles/{roleId}', tags: ['RBAC Employee Roles'],
            summary: 'Unassign role from employee',
            request: { params: z.object({ employeeId: z.string(), roleId: z.string() }) },
            responses: { 200: { description: 'Removed' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const employeeId = c.req.param('employeeId');
                const roleId = c.req.param('roleId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UnassignEmployeeRole({ employee_id: employeeId, role_id: roleId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'get', path: '/admin/employees/{employeeId}/roles', tags: ['RBAC Employee Roles'],
            summary: 'List roles assigned to an employee',
            request: { params: z.object({ employeeId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const employeeId = c.req.param('employeeId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListEmployeeRoles({ employee_id: employeeId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== RBAC — Resolve Admin Permissions =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/admins/{adminId}/permissions', tags: ['RBAC Admin Permissions'],
            summary: 'Get effective permissions for an admin',
            request: { params: z.object({ adminId: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const adminId = c.req.param('adminId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.GetAdminPermissions({ admin_id: adminId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== RBAC — Modules =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/modules', tags: ['RBAC Modules'],
            summary: 'List modules',
            request: {
                query: z.object({
                    scope: z.enum(['super_admin', 'organization']).optional(),
                    page: z.string().optional().default('1').pipe(z.coerce.number()),
                    limit: z.string().optional().default('100').pipe(z.coerce.number()),
                })
            },
            responses: { 200: { description: 'Ok' } },
            middleware: requirePermission('super.admin.manage', 'admin.manage')
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListModules(q, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    app.openapi(
        {
            method: 'post', path: '/admin/modules', tags: ['RBAC Modules'],
            summary: 'Create module',
            request: {
                body: { content: { 'application/json': { schema: z.object({ key: z.string(), name: z.string(), icon: z.string().optional(), scope: z.enum(['super_admin', 'organization']).optional().default('organization'), sort_order: z.number().optional().default(0), is_active: z.boolean().optional().default(true), parent_id: z.string().optional(), actions: z.array(z.string()).optional() }) } } }
            },
            responses: { 201: { description: 'Created' } },
            middleware: requirePermission('super.admin.manage')
        },
        async (c) => {
            try {
                const b = await c.req.json();
                const body = {
                    scope: b.scope || 'organization',
                    sort_order: b.sort_order ?? 0,
                    is_active: b.is_active ?? true,
                    ...b,
                };
                const resp = await new Promise((resolve, reject) => {
                    adminClient.CreateModule(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 201);
            } catch (error) {
                const code = error.code === 6 ? 409 : 500;
                return c.json({ error: error.message }, code);
            }
        }
    );

    app.openapi(
        {
            method: 'put', path: '/admin/modules/{id}', tags: ['RBAC Modules'],
            summary: 'Update module',
            request: {
                params: z.object({ id: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ key: z.string().optional(), name: z.string().optional(), icon: z.string().optional(), scope: z.enum(['super_admin', 'organization']).optional(), sort_order: z.number().optional(), is_active: z.boolean().optional(), parent_id: z.string().optional(), actions: z.array(z.string()).optional(), reconcile_actions: z.boolean().optional() }) } } }
            },
            responses: { 200: { description: 'Updated' } },
            middleware: requirePermission('super.admin.manage')
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UpdateModule({ id, ...body }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                const code = error.code === 5 ? 404 : 500;
                return c.json({ error: error.message }, code);
            }
        }
    );

    app.openapi(
        {
            method: 'delete', path: '/admin/modules/{id}', tags: ['RBAC Modules'],
            summary: 'Delete module',
            request: { params: z.object({ id: z.string() }) },
            responses: { 200: { description: 'Deleted' } },
            middleware: requirePermission('super.admin.manage')
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.DeleteModule({ id }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    /* =================== Audit Log =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/audit-logs', tags: ['Audit Log'],
            summary: 'List audit logs',
            request: {
                query: z.object({
                    admin_id: z.string().optional(),
                    organization_id: z.string().optional(),
                    action: z.string().optional(),
                    entity_type: z.string().optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    page: z.string().optional().default('1').pipe(z.coerce.number()),
                    limit: z.string().optional().default('10').pipe(z.coerce.number()),
                })
            },
            responses: { 200: { description: 'Ok' } },
            middleware: requirePermission('super.admin.manage')
        },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.ListAuditLogs(q, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* =================== System Config =================== */

    app.openapi(
        {
            method: 'get', path: '/admin/config/{key}', tags: ['System Config'],
            summary: 'Get system config by key',
            request: { params: z.object({ key: z.string() }) },
            responses: { 200: { description: 'Ok' } }
        },
        async (c) => {
            try {
                const key = c.req.param('key');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.GetSystemConfig({ key }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    app.openapi(
        {
            method: 'put', path: '/admin/config/{key}', tags: ['System Config'],
            summary: 'Update system config',
            request: {
                params: z.object({ key: z.string() }),
                body: { content: { 'application/json': { schema: z.object({ value: z.string(), description: z.string().optional() }) } } }
            },
            responses: { 200: { description: 'Updated' } },
            middleware: requirePermission('super.admin.manage')
        },
        async (c) => {
            try {
                const key = c.req.param('key');
                const body = await c.req.json();
                const adminId = c.get('adminId');
                const resp = await new Promise((resolve, reject) => {
                    adminClient.UpdateSystemConfig({ key, ...body, admin_id: adminId }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
