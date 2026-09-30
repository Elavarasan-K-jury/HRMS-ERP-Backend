import { prisma } from '@jury-hrms/db/client.js';
const prefixes = ['Effective Fixed Test', 'Effective Flex Test', 'Eff Edge', 'No Gross', 'Spoof Eff', 'Bad Break', 'API Fixed Persist', 'API Flex Persist', 'Bad Flex', 'Bad Days'];
const rows = await prisma.shifts.findMany({
  where: { organizationId: '6a69e65fe80f3dd717545124', deletedAt: null },
  select: { id: true, name: true },
});
const targets = rows.filter(r => prefixes.some(p => (r.name || '').startsWith(p)));
for (const t of targets) {
  await prisma.shifts.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
  console.log('soft-deleted', t.id, t.name);
}
const rest = await prisma.shifts.findMany({
  where: { organizationId: '6a69e65fe80f3dd717545124', deletedAt: null },
  select: { id: true, name: true },
});
console.log('remaining active:', JSON.stringify(rest));
await prisma.$disconnect();
