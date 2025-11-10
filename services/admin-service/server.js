import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import { sendOtpEmail } from '@jury-hrms/mailer';
import { signAccessToken, signRefreshToken, verifyToken, ACCESS_EXPIRES_IN } from '@jury-hrms/auth/jwt.js';
import { success } from 'zod';

const PORT = process.env.ADMIN_SERVICE_PORT || 50053;
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

async function findAdminByEmailOrPhone({ email, phone }) {
    const e = normEmail(email);
    const p = normPhone(phone);
    if (e) return prisma.admins.findFirst({ where: { email: e, deletedAt: null } });
    if (p) return prisma.admins.findFirst({ where: { phone: p, deletedAt: null } });
    return null;
}

/* ---------------------------- implementation ---------------------------- */

const impl = {
    /* =================== AUTH =================== */

    RequestLoginOtp: async (call, cb) => {
        try {
            const { email, phone, purpose = 'login' } = call.request;

            const admin = await findAdminByEmailOrPhone({ email, phone });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            const otp = genOtp();

            await prisma.adminOtps.create({
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
            if (payload.scope == 'admin') {
                user = await prisma.admins.findFirst({ where: { id: payload.sub, deletedAt: null, accessToken: token } });
                if (!user) {
                    return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid or expired token' });
                }
            }

            cb(null, {
                success: true,
                message: 'Token verified successfully',
                sub: payload.sub || '',
                user: JSON.stringify({
                    id: user?.id || '',
                    email: user?.email || '',
                    phone: user?.phone || '',
                }) || '',
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

            const admin = await findAdminByEmailOrPhone({ email, phone });
            if (!admin) return cb({ code: grpc.status.NOT_FOUND, message: 'Admin not found' });

            // Get the latest (not soft-deleted) OTP
            const record = await prisma.adminOtps.findFirst({
                where: { adminId: admin.id, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            if (!record) return cb({ code: grpc.status.INVALID_ARGUMENT, message: 'OTP not found' });

            const age = Date.now() - new Date(record.createdAt).getTime();
            if (age > OTP_TTL_MS) {
                // mark expired/consumed to avoid re-use
                await prisma.adminOtps.update({
                    where: { id: record.id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'OTP expired' });
            }

            if (record.otp !== otp) {
                return cb({ code: grpc.status.PERMISSION_DENIED, message: 'Invalid OTP' });
            }

            // consume OTP
            await prisma.adminOtps.update({
                where: { id: record.id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            const access_token = await signAccessToken({ sub: admin.id, email: admin.email, scope: 'admin' });
            const refresh_token = await signRefreshToken({ sub: admin.id, typ: 'refresh' });

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
                expires_in: String(ACCESS_EXPIRES_IN),
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
            const newAccess = await signAccessToken({ sub: admin.id, email: admin.email, scope: 'admin' });
            const newRefresh = await signRefreshToken({ sub: admin.id, typ: 'refresh' });

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
                expires_in: String(ACCESS_EXPIRES_IN),
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

            const admin = await prisma.admins.create({
                data: {
                    email,
                    phone,
                    accessToken: null,
                    refreshToken: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
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
                    updatedAt: new Date(),
                },
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
            const { page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc' } = call.request;
            const skip = (page - 1) * limit;

            const fieldMap = { email: 'email', phone: 'phone', created_at: 'createdAt' };
            const orderByField = fieldMap[sort_by] || 'createdAt';
            const order = (sort_order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

            const where = {
                deletedAt: null,
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

            cb(null, {
                success: true,
                message: 'Admin soft-deleted successfully'
            });
        } catch (e) {
            cb({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ----------------------- graceful main() ----------------------- */

async function main() {
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
