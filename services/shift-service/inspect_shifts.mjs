import { prisma } from '@jury-hrms/db/client.js';
const rows = await prisma.shifts.findMany({
  where: { organizationId: '6a69e65fe80f3dd717545124', deletedAt: null },
  select: { id: true, name: true },
  orderBy: { createdAt: 'desc' },
  take: 100,
});
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
