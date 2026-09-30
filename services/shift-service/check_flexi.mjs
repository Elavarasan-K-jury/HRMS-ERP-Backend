import { prisma } from '@jury-hrms/db/client.js';
const id = '6ab4ab3144c86533a5421487';
const row = await prisma.shifts.findUnique({ where: { id } });
console.log(JSON.stringify(row, null, 2));
const count = await prisma.shifts.count({ where: { organizationId: '6a69e65fe80f3dd717545124', deletedAt: null } });
console.log('active count', count);
await prisma.$disconnect();
