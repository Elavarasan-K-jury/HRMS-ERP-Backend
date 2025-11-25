import { SignJWT, jwtVerify } from 'jose';

const ENC = new TextEncoder();
const JWT_SECRET = (process.env.JWT_SECRET || 'dev-secret');
const JWT_ACCESS_EXPIRES_IN = Number(process.env.JWT_ACCESS_EXPIRES_IN || 10000);   // 15m
const JWT_REFRESH_EXPIRES_IN = Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800); // 7d

export async function signAccessToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + JWT_ACCESS_EXPIRES_IN)
        .sign(ENC.encode(JWT_SECRET));
}

export async function signRefreshToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + JWT_REFRESH_EXPIRES_IN)
        .sign(ENC.encode(JWT_SECRET));
}

export async function verifyToken(token) {
    const { payload } = await jwtVerify(token, ENC.encode(JWT_SECRET), { algorithms: ['HS256'] });
    return payload;
}

export const ACCESS_EXPIRES_IN = JWT_ACCESS_EXPIRES_IN;
