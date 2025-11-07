import { success, z, ZodError } from 'zod';
import { adminClient } from '../grpc/admin.client.js'; // generate like your other clients

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
                    content: { 'application/json': { schema: z.object({ message: z.string() }) } }
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
                            message: z.string()
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
}
