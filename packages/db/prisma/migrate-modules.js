import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '../client.js';

// Real module catalog. scope: "super_admin" | "organization"
const MODULES = [
  // ---- Super Admin scope ----
  { key: 'organizations',   name: 'Organizations',   icon: 'ion:business',              scope: 'super_admin',  sortOrder: 1 },
  { key: 'discounts',       name: 'Discounts',       icon: 'heroicons:percent-badge',     scope: 'super_admin',  sortOrder: 2 },
  { key: 'admins',          name: 'Admins',          icon: 'ion:person-add-outline',      scope: 'super_admin',  sortOrder: 3 },
  { key: 'roles',           name: 'Roles & Permissions', icon: 'ion:key-outline',         scope: 'super_admin',  sortOrder: 4 },
  { key: 'audit',           name: 'Audit Logs',      icon: 'ion:document-text-outline',   scope: 'super_admin',  sortOrder: 5 },
  { key: 'modules',         name: 'Modules',         icon: 'ion:grid-outline',           scope: 'super_admin',  sortOrder: 6 },

  // ---- Organization scope ----
  { key: 'dashboard',       name: 'Dashboard',       icon: 'ion:pie-chart',              scope: 'organization', sortOrder: 1 },
  { key: 'departments',     name: 'Departments',     icon: 'lucide:git-fork',            scope: 'organization', sortOrder: 2 },
  { key: 'branches',        name: 'Branches',        icon: 'lucide:building-2',          scope: 'organization', sortOrder: 3 },
  { key: 'designations',    name: 'Designations',    icon: 'ion:briefcase-outline',      scope: 'organization', sortOrder: 4 },
  { key: 'hierarchy',       name: 'Hierarchy',       icon: 'ion:people-outline',         scope: 'organization', sortOrder: 5 },
  { key: 'employees',       name: 'Employees',       icon: 'ion:people',                 scope: 'organization', sortOrder: 6 },
  { key: 'attendance',      name: 'Attendance',      icon: 'ion:clock',                  scope: 'organization', sortOrder: 7 },
  { key: 'leave',           name: 'Leave',           icon: 'ion:calendar',               scope: 'organization', sortOrder: 8 },
  { key: 'payroll',         name: 'Payroll',         icon: 'ion:wallet',                 scope: 'organization', sortOrder: 9 },
  { key: 'reports',         name: 'Reports',         icon: 'ion:bar-chart',              scope: 'organization', sortOrder: 10 },
  { key: 'settings',        name: 'Settings',        icon: 'ion:cog',                    scope: 'organization', sortOrder: 11 },
];

const MODULE_ACTIONS = ['create', 'view', 'edit', 'delete', 'manage'];

// Legacy permission keys whose action is NOT view/edit/delete. We preserve these
// on their module so existing role grants (system + custom) keep working.
const LEGACY_PERMISSIONS = [
  // module_key , { action, name }
  ['employees', { action: 'create', name: 'Create Employees' }],
  ['attendance', { action: 'manage', name: 'Manage Attendance' }],
  ['leave', { action: 'approve', name: 'Approve Leaves' }],
  ['payroll', { action: 'manage', name: 'Manage Payroll' }],
  ['settings', { action: 'access', name: 'Access Settings' }],
  ['admins', { action: 'manage', name: 'Manage Admins' }],
];

async function main() {
  console.log('Migrating RBAC to module-based model...');

  const createdModules = [];
  for (const m of MODULES) {
    const mod = await prisma.adminModule.upsert({
      where: { key: m.key },
      update: { name: m.name, icon: m.icon, scope: m.scope, sortOrder: m.sortOrder, actions: MODULE_ACTIONS, deletedAt: null },
      create: { ...m, actions: MODULE_ACTIONS, deletedAt: null },
    });
    createdModules.push(mod);

    // view / edit / delete permissions
    for (const action of MODULE_ACTIONS) {
      const key = `${m.key}.${action}`;
      const name = `${m.name} — ${action[0].toUpperCase()}${action.slice(1)}`;
      await prisma.adminPermission.upsert({
        where: { key },
        update: { name, group: m.name, description: `${m.name} ${action} access`, deletedAt: null },
        create: { key, name, group: m.name, description: `${m.name} ${action} access`, deletedAt: null },
      });
    }
    console.log(`  ✓ module: ${m.key}`);
  }

  // Preserve legacy (non view/edit/delete) permissions linked to their module group
  for (const [moduleKey, legacy] of LEGACY_PERMISSIONS) {
    const mod = createdModules.find(x => x.key === moduleKey);
    const groupName = mod?.name || moduleKey;
    const key = `${moduleKey}.${legacy.action}`;
    await prisma.adminPermission.upsert({
      where: { key },
      update: { name: legacy.name, group: groupName, deletedAt: null },
      create: { key, name: legacy.name, group: groupName, deletedAt: null },
    });
    console.log(`  ✓ legacy permission: ${key}`);
  }

  // Ensure the old flat super.* keys remain mapped too (used by gateway middleware)
  for (const key of ['super.admin.manage', 'super.organization.manage']) {
    const existing = await prisma.adminPermission.findUnique({ where: { key } });
    if (!existing) {
      await prisma.adminPermission.create({
        data: {
          key,
          name: key.includes('admin') ? 'Manage Admins' : 'Manage Organizations',
          group: 'Super Admin',
          description: 'Super admin platform access',
          deletedAt: null,
        },
      });
      console.log(`  ✓ created: ${key}`);
    }
  }

  console.log(`✅ Module migration completed. ${createdModules.length} modules synced.`);
}

main()
  .catch(e => { console.error('❌ Module migration failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());