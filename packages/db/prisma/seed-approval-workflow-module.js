/**
 * Seed the Approval Workflow module + permissions into AdminModule / AdminPermission.
 *
 * Run once:
 *   node packages/db/prisma/seed-approval-workflow-module.js
 *
 * Creates:
 *   AdminModule   { key: "approval_workflow", name: "Approval Workflow" }
 *   AdminPermission { key: "approval_workflow.view", ... }
 *   AdminPermission { key: "approval_workflow.manage", ... }
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '../client.js';

const MODULE_KEY = 'approval_workflow';
const MODULE_NAME = 'Approval Workflow';
const MODULE_ICON = 'ion:checkmark-circle-outline';
const MODULE_SORT = 20;
const ACTIONS = ['view', 'manage'];

async function main() {
  console.log('Seeding Approval Workflow module...');

  let mod = await prisma.adminModule.findFirst({
    where: { key: MODULE_KEY, deletedAt: null },
  });

  if (!mod) {
    mod = await prisma.adminModule.create({
      data: {
        key: MODULE_KEY,
        name: MODULE_NAME,
        icon: MODULE_ICON,
        scope: 'organization',
        sortOrder: MODULE_SORT,
        isActive: true,
        parentId: null,
        actions: ACTIONS,
        deletedAt: null,
      },
    });
    console.log(`  ✓ Created AdminModule "${MODULE_KEY}" (${mod.id})`);
  } else {
    mod = await prisma.adminModule.update({
      where: { id: mod.id },
      data: { name: MODULE_NAME, icon: MODULE_ICON, actions: ACTIONS, deletedAt: null },
    });
    console.log(`  ↻ Updated existing AdminModule "${MODULE_KEY}" (${mod.id})`);
  }

  for (const action of ACTIONS) {
    const key = `${MODULE_KEY}.${action}`;
    const name = `${MODULE_NAME} — ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    await prisma.adminPermission.upsert({
      where: { key },
      update: { name, group: MODULE_NAME, description: `${MODULE_NAME} ${action} access`, deletedAt: null },
      create: { key, name, group: MODULE_NAME, description: `${MODULE_NAME} ${action} access`, deletedAt: null },
    });
    console.log(`  ✓ Permission: ${key}`);
  }

  console.log('Done.');
}

main().finally(() => prisma.$disconnect());
