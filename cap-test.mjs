import dotenv from 'dotenv';
import { signAccessToken } from '@jury-hrms/auth/jwt.js';
import { prisma } from '@jury-hrms/db/client.js';

dotenv.config({ path: '/Users/jslap020/Documents/JurysoftProjects/HRMS-Manufacturing/Backend/.env' });

const BASE = 'http://localhost:50050';
const ORG = '6a69e65fe80f3dd717545124';
const EMP = '6a69f2b08108fd9fa316e2f7';

// Distinct working days in Sept (none already have attendance+pending reg collision)
const SEP_A = '2026-09-18';
const SEP_B = '2026-09-23';
const SEP_C = '2026-09-22'; // 3rd in same month — expect reject
const OCT_DAY = '2026-10-01';

function localDayKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function localDayRange(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return { gte: new Date(y, m - 1, d, 0, 0, 0, 0), lt: new Date(y, m, d, 0, 0, 0, 0) };
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function getActivePolicy() {
  return prisma.attendancePolicies.findFirst({
    where: { organizationId: ORG, isActive: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

async function countEmpRegs(monthPrefix) {
  const [y, m] = monthPrefix.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return prisma.attendanceRegularisation.count({
    where: {
      employeeId: EMP,
      deletedAt: null,
      status: { in: ['PENDING', 'APPROVED'] },
      date: { gte: start, lte: end },
    },
  });
}

async function ensureAttendance(dayStr) {
  // Exact local-day match by iterating (avoids TZ edge cases on range queries)
  const candidates = await prisma.attendance.findMany({
    where: { employeeId: EMP, deletedAt: null },
  });
  const hit = candidates.find(a => localDayKey(a.date) === dayStr);
  if (hit) return hit;
  const [y, m, d] = dayStr.split('-').map(Number);
  return prisma.attendance.create({
    data: {
      organizationId: ORG,
      employeeId: EMP,
      date: new Date(y, m - 1, d, 0, 0, 0, 0),
      status: 'PENDING',
      deletedAt: null,
    },
  });
}

async function submitReg(token, dayStr) {
  const att = await ensureAttendance(dayStr);
  return api('/attendance/regularise', {
    method: 'POST',
    token,
    body: {
      attendance_id: att.id,
      date: dayStr,
      type: 'ADJUST_LOGS',
      note: `Cap test ${dayStr}`,
      requested_in_time: `${dayStr}T04:00:00.000Z`,
      requested_out_time: `${dayStr}T12:00:00.000Z`,
    },
  });
}

function isLimitError(body) {
  const s = JSON.stringify(body || {});
  return /limit reached|maximum \d+ request/i.test(s);
}

async function main() {
  const token = await signAccessToken({
    sub: EMP,
    email: 'emp@test.local',
    scope: 'employee',
    organizationId: ORG,
  });

  // Clean slate: soft-delete any prior test/regularisation rows for EMP
  const wiped = await prisma.attendanceRegularisation.updateMany({
    where: { employeeId: EMP, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  console.log(`Wiped ${wiped.count} existing regularisations for clean slate`);

  console.log('=== BEFORE ===');
  const polBefore = await getActivePolicy();
  console.log('policy', polBefore.id, 'name=', polBefore.name,
    'max=', polBefore.maxRegularisationRequests,
    'period=', polBefore.regularisationPeriod,
    'window=', polBefore.regularisationWindowDays);
  console.log('Sept PENDING+APPROVED=', await countEmpRegs('2026-09'));
  console.log('Oct PENDING+APPROVED=', await countEmpRegs('2026-10'));

  await prisma.attendancePolicies.update({
    where: { id: polBefore.id },
    data: { maxRegularisationRequests: 2, regularisationPeriod: 'MONTHLY' },
  });
  const polSet = await getActivePolicy();
  console.log('\n=== POLICY SET max=2 period=MONTHLY ===');
  console.log('verified max=', polSet.maxRegularisationRequests, 'period=', polSet.regularisationPeriod);

  const results = [];
  const rec = (step, expect, res, ok, extra = '') => {
    results.push({ step, expect, status: res?.status, ok, detail: (extra || JSON.stringify(res?.body))?.slice(0, 350) });
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${step} | expect=${expect} | status=${res?.status} | ${(extra || JSON.stringify(res?.body))?.slice(0, 400)}`);
  };

  // Step 1: 1st Sept → success
  const r1 = await submitReg(token, SEP_A);
  rec(`1st Sep (${SEP_A})`, 'success 200', r1, r1.status === 200 && !!r1.body?.regularisation?.id);
  console.log('  Sept count=', await countEmpRegs('2026-09'));

  // Step 2: 2nd Sept → success
  const r2 = await submitReg(token, SEP_B);
  rec(`2nd Sep (${SEP_B})`, 'success 200', r2, r2.status === 200 && !!r2.body?.regularisation?.id);
  console.log('  Sept count=', await countEmpRegs('2026-09'));

  // Step 3: 3rd Sept → rejected with count-based error
  const r3 = await submitReg(token, SEP_C);
  const ok3 = r3.status !== 200 && isLimitError(r3.body);
  rec(`3rd Sep (${SEP_C})`, 'rejected 412 limit error', r3, ok3);
  console.log('  Sept count=', await countEmpRegs('2026-09'));

  // Step 4: next calendar month → success (period reset)
  const r4 = await submitReg(token, OCT_DAY);
  rec(`Oct (${OCT_DAY})`, 'success 200 (period reset)', r4, r4.status === 200 && !!r4.body?.regularisation?.id);
  console.log('  Oct count=', await countEmpRegs('2026-10'));
  console.log('  Sept count=', await countEmpRegs('2026-09'));

  console.log('\n=== AFTER (final state) ===');
  const polAfter = await getActivePolicy();
  console.log('policy max=', polAfter.maxRegularisationRequests, 'period=', polAfter.regularisationPeriod);
  const regs = await prisma.attendanceRegularisation.findMany({
    where: { employeeId: EMP, deletedAt: null },
    orderBy: { date: 'asc' },
  });
  for (const r of regs) console.log(' reg', localDayKey(r.date), r.status, r.note);

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n=== CAP TEST: ${pass} PASS / ${fail} FAIL ===`);

  // Soft-delete test rows so E2E can re-run under cap=2 with count=0
  const del = await prisma.attendanceRegularisation.updateMany({
    where: { employeeId: EMP, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  console.log(`Cleaned ${del.count} test regularisations`);
  console.log('Sept after cleanup=', await countEmpRegs('2026-09'));
  console.log('Oct after cleanup=', await countEmpRegs('2026-10'));

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
