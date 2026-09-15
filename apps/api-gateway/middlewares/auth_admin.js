import { verifyToken } from '@jury-hrms/auth/jwt.js';

const AUTH_EXCLUDED_PATHS = [
  '/admin/login/request-otp',
  '/admin/login/verify',
  '/admin/token/refresh',
  '/auth/verify-token',
  '/',
  '/doc',
  '/swagger',
  '/health',
  '/uploads/',
  '/employee-documents/my',
];

export const authAdmin = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for public endpoints
  if (AUTH_EXCLUDED_PATHS.some(p => p === '/' ? path === p : path.startsWith(p))) {
    return await next();
  }

  // Token may come from the Authorization header or the ?token= query param
  // (browser <img>/<video> tags cannot send Authorization headers cross-origin).
  let token = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const q = new URL(c.req.url).searchParams.get('token');
    if (q) token = q;
  }

  if (!token) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  try {
    const payload = await verifyToken(token);
    if (payload.scope !== 'admin') {
      return c.json({ error: 'Invalid token scope' }, 403);
    }

    c.set('adminId', payload.sub);
    c.set('adminEmail', payload.email || '');
    c.set('tokenScope', payload.scope || 'admin');
    c.set('adminToken', token);
    return await next();
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};