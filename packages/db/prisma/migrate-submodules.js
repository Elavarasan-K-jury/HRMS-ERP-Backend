import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '../client.js';

// Sub-modules catalog. Each entry's parent is identified by the parent module
// key (must already exist, e.g. the org "payroll" module).
// Sub-module permission keys become e.g. "payroll.salary_components.view".
const SUB_MODULES = [
  {
    parentKey: 'payroll',
    items: [
      { key: 'salary_components', name: 'Salary Components', icon: 'ion:git-branch', sortOrder: 1 },
      { key: 'salary_groups', name: 'Salary Groups', icon: 'heroicons:document-currency-rupee', sortOrder: 2 },
      { key: 'payroll_run', name: 'Payroll Run', icon: 'ion:wallet', sortOrder: 3 },
      { key: 'payslips', name: 'Payslips', icon: 'ion:receipt-outline', sortOrder: 4 },
      { key: 'bonuses', name: 'Bonuses', icon: 'ion:gift-outline', sortOrder: 5 },
      { key: 'payroll_settings', name: 'Payroll Settings', icon: 'ion:cog', sortOrder: 6 },
    ],
  },
  {
    parentKey: 'leave',
    items: [
      { key: 'policies', name: 'Leave Policies', icon: 'ion:document-text-outline', sortOrder: 1 },
      { key: 'requests', name: 'Leave Requests', icon: 'ion:calendar-outline', sortOrder: 2 },
      { key: 'balances', name: 'Leave Balances', icon: 'ion:calculator-outline', sortOrder: 3 },
    ],
  },
  {
    parentKey: 'employees',
    items: [
      { key: 'list', name: 'Employees', icon: 'ion:people', sortOrder: 1 },
      { key: 'categories', name: 'Employee Categories', icon: 'ion:albums-outline', sortOrder: 2 },
      { key: 'probation_policies', name: 'Probation Policies', icon: 'ion:hourglass-outline', sortOrder: 3 },
    ],
  },
];

const ACTIONS = ['create', 'view', 'edit', 'delete', 'manage'];

async function main() {
  console.log('Seeding sub-modules...');
  let created = 0;
  for (const group of SUB_MODULES) {
    // If the module key provided doesn't exist, try name fallback.
    let parent = await prisma.adminModule.findFirst({ where: { key: group.parentKey, deletedAt: null } });
    if (!parent && group.name) {
      parent = await prisma.adminModule.findFirst({ where: { name: group.name, deletedAt: null } });
    }
    if (!parent) {
      console.log(`  ⚠ parent module not found for "${group.parentKey}" — skipping`);
      continue;
    }

    for (const sub of group.items) {
      const fullKey = `${parent.key}.${sub.key}`;
      let mod = await prisma.adminModule.findFirst({ where: { key: fullKey, deletedAt: null } });
      if (mod) {
        mod = await prisma.adminModule.update({
          where: { id: mod.id },
          data: { name: sub.name, icon: sub.icon || '', sortOrder: sub.sortOrder, parentId: parent.id, actions: ACTIONS, deletedAt: null },
        });
      } else {
        mod = await prisma.adminModule.create({
          data: {
            key: fullKey,
            name: sub.name,
            icon: sub.icon || '',
            scope: parent.scope,
            sortOrder: sub.sortOrder,
            isActive: true,
            parentId: parent.id,
            actions: ACTIONS,
            deletedAt: null,
          },
        });
      }

      for (const action of ACTIONS) {
        const key = `${fullKey}.${action}`;
        const name = `${sub.name} — ${action[0].toUpperCase()}${action.slice(1)}`;
        await prisma.adminPermission.upsert({
          where: { key },
          update: { name, group: sub.name, description: `${sub.name} ${action} access`, deletedAt: null },
          create: { key, name, group: sub.name, description: `${sub.name} ${action} access`, deletedAt: null },
        });
      }
      created++;
      console.log(`  ✓ ${fullKey} (${sub.name})`);
    }
  }
  console.log(`Done. Upserted ${created} sub-modules.`);
}

main().finally(() => prisma.$disconnect());