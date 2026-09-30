import { prisma } from '@jury-hrms/db/client.js';
const prefixes = ['P25 Effective Fixed', 'P25 Effective Flex'];
const rows = await prisma.shifts.findMany({
  where: { organizationId: '6a69e65fe80f3dd717545124', deletedAt: null },
  select: { id: true, name: true },
});
const targets = rows.filter(r => prefixes.some(p => (r.name || '').startsWith(p)));
for (const t of targets) {
  await prisma.shifts.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
  console.log('soft-deleted', t.id, t.name);
}
await prisma.$disconnect();
