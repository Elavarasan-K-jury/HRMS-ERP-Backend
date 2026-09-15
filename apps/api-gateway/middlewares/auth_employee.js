import { verifyToken } from '@jury-hrms/auth/jwt.js';

export const authEmployee = async (c, next) => {
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
    if (payload.scope !== 'employee') {
      return c.json({ error: 'Invalid token scope' }, 403);
    }

    c.set('employeeId', payload.sub);
    c.set('employeeEmail', payload.email || '');
    c.set('tokenScope', payload.scope || 'employee');
    c.set('employeeToken', token);
    return await next();
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};
