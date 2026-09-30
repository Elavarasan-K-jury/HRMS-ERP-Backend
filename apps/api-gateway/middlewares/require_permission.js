import { adminClient } from '../grpc/admin.client.js';

const PERMISSIONS_CACHE = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute

export function requirePermission(...requiredKeys) {
  return async (c, next) => {
    const adminId = c.get('adminId');
    if (!adminId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const permissions = await getAdminPermissions(adminId);

      // Super admin has every permission
      if (permissions.is_super_admin) {
        return await next();
      }

      const hasAny = requiredKeys.some(k => permissions.keys.includes(k));
      if (!hasAny) {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }

      await next();
    } catch (err) {
      console.error('[requirePermission] Error:', err.message);
      return c.json({ error: 'Failed to verify permissions' }, 500);
    }
  };
}

// Exported for trusted organization-context resolution (Phase 3D): reuses the
// existing super-admin/permission semantics + 60s cache. No behavior change.
export async function getAdminPermissions(adminId) {
  const cached = PERMISSIONS_CACHE.get(adminId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached;
  }

  const result = await new Promise((resolve, reject) => {
    adminClient.GetAdminPermissions({ admin_id: adminId }, (err, resp) => {
      if (err) return reject(err);
      resolve(resp);
    });
  });

  const data = {
    keys: result.permission_keys || [],
    is_super_admin: result.is_super_admin || false,
    ts: Date.now(),
  };

  PERMISSIONS_CACHE.set(adminId, data);
  return data;
}

/**
 * Check if an admin has a specific permission key.
 * Returns true if granted, false otherwise.
 * Used for conditional RBAC checks (e.g., viewing others' data).
 */
export async function checkPermission(adminId, requiredKey) {
  if (!adminId) return false;
  try {
    const permissions = await getAdminPermissions(adminId);
    return permissions.is_super_admin || permissions.keys.includes(requiredKey);
  } catch {
    return false;
  }
}
