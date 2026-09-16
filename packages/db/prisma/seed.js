import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '../client.js';

const PERMISSIONS = [
  // Super Admin
  { key: 'super.admin.manage',   name: 'Manage Admins',        group: 'Super Admin', description: 'Create/delete admins, assign roles globally' },
  { key: 'super.organization.manage', name: 'Manage Organizations', group: 'Super Admin', description: 'Create/edit/delete any organization' },

  // Admin Management
  { key: 'admin.manage', name: 'Manage Organization Admins', group: 'Admin Management', description: 'Manage admins within own organization' },

  // Employees
  { key: 'employees.view',   name: 'View Employees',   group: 'Employees', description: 'View employee list and profiles' },
  { key: 'employees.create', name: 'Create Employees', group: 'Employees', description: 'Add new employees' },
  { key: 'employees.edit',   name: 'Edit Employees',   group: 'Employees', description: 'Update employee details' },
  { key: 'employees.delete', name: 'Delete Employees', group: 'Employees', description: 'Soft-delete employees' },

  // Departments
  { key: 'departments.view',   name: 'View Departments',   group: 'Departments', description: 'View department tree and details' },
  { key: 'departments.manage', name: 'Manage Departments', group: 'Departments', description: 'Create/edit/delete departments' },

  // Designations
  { key: 'designations.view',   name: 'View Designations',   group: 'Designations', description: 'View designation list' },
  { key: 'designations.manage', name: 'Manage Designations', group: 'Designations', description: 'Create/edit/delete designations' },

  // Branches
  { key: 'branches.view',   name: 'View Branches',   group: 'Branches', description: 'View branch list' },
  { key: 'branches.manage', name: 'Manage Branches', group: 'Branches', description: 'Create/edit/delete branches' },

  // Attendance
  { key: 'attendance.view',   name: 'View Attendance',   group: 'Attendance', description: 'View attendance records and reports' },
  { key: 'attendance.manage', name: 'Manage Attendance', group: 'Attendance', description: 'Mark attendance, approve regularisations' },

  // Leave
  { key: 'leave.view',    name: 'View Leaves',    group: 'Leave', description: 'View leave requests and balances' },
  { key: 'leave.approve', name: 'Approve Leaves', group: 'Leave', description: 'Approve/reject leave requests' },

  // Payroll
  { key: 'payroll.view',   name: 'View Payroll',   group: 'Payroll', description: 'View payroll data and payslips' },
  { key: 'payroll.manage', name: 'Manage Payroll', group: 'Payroll', description: 'Run payroll, manage salary structures' },

  // Reports
  { key: 'reports.view', name: 'View Reports', group: 'Reports', description: 'Access analytics and report pages' },

  // Settings
  { key: 'settings.access', name: 'Access Settings', group: 'Settings', description: 'Access organization settings pages' },

  // Hierarchy / Org Chart
  { key: 'hierarchy.view', name: 'View Hierarchy', group: 'Hierarchy', description: 'View organization chart' },
];

async function main() {
  console.log('Seeding RBAC permissions...');

  // Upsert all permissions
  const created = [];
  for (const perm of PERMISSIONS) {
    const p = await prisma.adminPermission.upsert({
      where: { key: perm.key },
      update: { name: perm.name, group: perm.group, description: perm.description, deletedAt: null },
      create: { ...perm, deletedAt: null },
    });
    created.push(p);
  }
  console.log(`  ✓ ${created.length} permissions synced`);

  // Upsert system roles

  // 1. Super Admin (global, all permissions)
  const allPermIds = created.map(p => p.id);
  const superAdminRole = await prisma.adminRoles.upsert({
    where: { id: '000000000000000000000001' },
    update: { name: 'Super Admin', description: 'Full system access across all organizations' },
    create: {
      id: '000000000000000000000001',
      name: 'Super Admin',
      description: 'Full system access across all organizations',
      isSystem: true,
    },
  });

  // Clear and re-assign all permissions to super admin
  await prisma.adminRolePermissions.deleteMany({ where: { roleId: superAdminRole.id } });
  await prisma.adminRolePermissions.createMany({
    data: allPermIds.map(permissionId => ({ roleId: superAdminRole.id, permissionId, deletedAt: null })),
  });
  console.log('  ✓ Super Admin role synced with all permissions');

  // 2. Admin (org-scoped, excluding super.*)
  const adminPermKeys = PERMISSIONS.filter(p => !p.key.startsWith('super.')).map(p => p.key);
  const adminPermIds = created.filter(p => adminPermKeys.includes(p.key)).map(p => p.id);

  const adminRole = await prisma.adminRoles.upsert({
    where: { id: '000000000000000000000002' },
    update: { name: 'Admin', description: 'Full organization-level access' },
    create: {
      id: '000000000000000000000002',
      name: 'Admin',
      description: 'Full organization-level access',
      isSystem: true,
    },
  });

  await prisma.adminRolePermissions.deleteMany({ where: { roleId: adminRole.id } });
  await prisma.adminRolePermissions.createMany({
    data: adminPermIds.map(permissionId => ({ roleId: adminRole.id, permissionId, deletedAt: null })),
  });
  console.log('  ✓ Admin role synced');

  // 3. HR Manager (HR-related permissions only)
  const hrPermKeys = [
    'employees.view', 'employees.create', 'employees.edit',
    'departments.view',
    'designations.view',
    'bands.view',
    'branches.view',
    'attendance.view', 'attendance.manage',
    'leave.view', 'leave.approve',
    'hierarchy.view',
    'reports.view',
  ];
  const hrPermIds = created.filter(p => hrPermKeys.includes(p.key)).map(p => p.id);

  const hrRole = await prisma.adminRoles.upsert({
    where: { id: '000000000000000000000003' },
    update: { name: 'HR Manager', description: 'HR operations access' },
    create: {
      id: '000000000000000000000003',
      name: 'HR Manager',
      description: 'HR operations access',
      isSystem: true,
    },
  });

  await prisma.adminRolePermissions.deleteMany({ where: { roleId: hrRole.id } });
  await prisma.adminRolePermissions.createMany({
    data: hrPermIds.map(permissionId => ({ roleId: hrRole.id, permissionId, deletedAt: null })),
  });
  console.log('  ✓ HR Manager role synced');

  // Seed default SystemConfig entries
  const defaultConfigs = [
    { key: 'audit_log_retention_days', value: 90, description: 'Number of days to retain admin audit logs before cleanup' },
    { key: 'session_timeout_minutes',  value: 60, description: 'Admin session inactivity timeout in minutes' },
    { key: 'max_login_attempts',       value: 5,  description: 'Max failed login attempts before temporary lockout' },
  ];

  for (const cfg of defaultConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value, description: cfg.description },
      create: cfg,
    });
  }
  console.log('  ✓ Default system configs synced');

  console.log('\n✅ RBAC seed completed successfully');
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
