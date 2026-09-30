import { verifyToken } from '@jury-hrms/auth/jwt.js';

// Dual-scope auth for routes shared by the admin portal and the employee portal
// (e.g. GET /shift-assignments?employee_id=... is used by both).
// Accepts either an admin or an employee token, sets the matching context keys.
export const authAdminOrEmployee = async (c, next) => {
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
    const scope = payload.scope;

    if (scope === 'admin') {
      c.set('adminId', payload.sub);
      c.set('adminEmail', payload.email || '');
      c.set('tokenScope', 'admin');
      c.set('adminToken', token);
      return await next();
    }

    if (scope === 'employee') {
      c.set('employeeId', payload.sub);
      c.set('employeeEmail', payload.email || '');
      c.set('tokenScope', 'employee');
      c.set('employeeToken', token);
      return await next();
    }

    return c.json({ error: 'Invalid token scope' }, 403);
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};
