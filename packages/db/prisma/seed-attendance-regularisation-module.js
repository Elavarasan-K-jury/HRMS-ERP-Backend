/**
 * Seed: attendance_regularisation module + permissions.
 * Run: node packages/db/prisma/seed-attendance-regularisation-module.js
 */
import { prisma } from '../client.js';

async function main() {
    console.log('=== Seeding attendance_regularisation module ===');

    const MODULE_KEY = 'attendance_regularisation';

    // Upsert module
    const mod = await prisma.adminModule.upsert({
        where: { key: MODULE_KEY },
        update: {},
        create: {
            key: MODULE_KEY,
            name: 'Attendance Regularisation',
            description: 'Manage attendance regularisation requests, approvals, and bulk actions',
        },
    });
    console.log(`Module: ${mod.key} (${mod.id})`);

    // Upsert permissions
    const perms = [
        { key: 'attendance_regularisation.view', name: 'View Regularisations', description: 'View regularisation requests and their status' },
        { key: 'attendance_regularisation.manage', name: 'Manage Regularisations', description: 'Submit, approve, reject, and bulk-regularise attendance' },
    ];

    for (const p of perms) {
        const perm = await prisma.adminPermission.upsert({
            where: { key: p.key },
            update: {},
            create: {
                key: p.key,
                name: p.name,
                description: p.description,
                moduleId: mod.id,
            },
        });
        console.log(`Permission: ${perm.key} (${perm.id})`);
    }

    console.log('\n=== Done ===');
}

main()
    .catch((e) => { console.error('Fatal:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
