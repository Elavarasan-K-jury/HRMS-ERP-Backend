import { prisma } from '@jury-hrms/db/client.js';
const id = '6ab4ab3144c86533a5421487';
const row = await prisma.shifts.findUnique({ where: { id } });
if (row && row.deletedAt) {
  await prisma.shifts.update({ where: { id }, data: { deletedAt: null, updatedAt: new Date() } });
  console.log('RESTORED FLEXI deletedAt -> null (was', row.deletedAt.toISOString(), ')');
} else {
  console.log('FLEXI already active or missing', row ? 'active' : 'missing');
}
await prisma.$disconnect();
