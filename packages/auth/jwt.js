import { SignJWT, jwtVerify } from 'jose';

const ENC = new TextEncoder();

const jwtSecret = () => (process.env.JWT_SECRET || 'dev-secret');
const jwtAccessExpiresIn = () => Number(process.env.JWT_ACCESS_EXPIRES_IN || 10000);   // 15m
const jwtRefreshExpiresIn = () => Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800); // 7d

export async function signAccessToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + jwtAccessExpiresIn())
        .sign(ENC.encode(jwtSecret()));
}

export async function signRefreshToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + jwtRefreshExpiresIn())
        .sign(ENC.encode(jwtSecret()));
}

export async function verifyToken(token) {
    const { payload } = await jwtVerify(token, ENC.encode(jwtSecret()), { algorithms: ['HS256'] });
    return payload;
}

export const getAccessExpiresIn = () => jwtAccessExpiresIn();
