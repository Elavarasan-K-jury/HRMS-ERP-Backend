import dotenv from 'dotenv';
import { signAccessToken } from '@jury-hrms/auth/jwt.js';
import { prisma } from '@jury-hrms/db/client.js';

dotenv.config({ path: '/Users/jslap020/Documents/JurysoftProjects/HRMS-Manufacturing/Backend/.env' });

const BASE = 'http://localhost:50050';
const ORG = '6a69e65fe80f3dd717545124';
const EMP = '6a69f2b08108fd9fa316e2f7';
const POLICY_ID = '6ab11c75284c236d134bc03f';

// Today = Tue 2026-09-22; window=7 → cutoff Sep 15
const TODAY = '2026-09-22';
const IN_WINDOW_OK = '2026-09-18';
const OUT_OF_WINDOW = '2026-09-10'; // before Sep 15
const FUTURE = '2026-12-01';
const CURRENT_WEEK_DAY = '2026-09-23'; // this Mon-start week Sep 21-27
const PRIOR_WEEK_DAY = '2026-09-16'; // last Mon-start week Sep 14-20

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

function errMsg(body) {
  return body?.error || body?.message || JSON.stringify(body);
}

async function ensureAttendance(dayStr) {
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
      note: `Verify ${dayStr}`,
      requested_in_time: `${dayStr}T04:00:00.000Z`,
      requested_out_time: `${dayStr}T12:00:00.000Z`,
    },
  });
}

async function wipeEmpRegs() {
  const n = await prisma.attendanceRegularisation.updateMany({
    where: { employeeId: EMP, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return n.count;
}

async function setPolicy(data) {
  await prisma.attendancePolicies.update({ where: { id: POLICY_ID }, data });
  // small delay not needed — service reads DB per request
}

async function insertRegFixture({ dayStr, createdAt }) {
  const att = await ensureAttendance(dayStr);
  const [y, m, d] = dayStr.split('-').map(Number);
  return prisma.attendanceRegularisation.create({
    data: {
      organizationId: ORG,
      employeeId: EMP,
      attendanceId: att.id,
      date: new Date(y, m - 1, d, 0, 0, 0, 0),
      type: 'ADJUST_LOGS',
      requestedInTime: new Date(`${dayStr}T04:00:00.000Z`),
      requestedOutTime: new Date(`${dayStr}T12:00:00.000Z`),
      note: `Fixture createdAt=${createdAt.toISOString()}`,
      status: 'PENDING',
      deletedAt: null,
      createdBy: EMP,
      createdAt,
    },
  });
}

const results = [];
function rec(step, expect, res, ok) {
  const detail = typeof res === 'string' ? res : `${res?.status} ${errMsg(res?.body)}`.slice(0, 300);
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step} | expect=${expect} | got=${detail}`);
}

async function main() {
  const token = await signAccessToken({
    sub: EMP,
    email: 'emp@test.local',
    scope: 'employee',
    organizationId: ORG,
  });

  console.log('=== CLEAN SLATE ===');
  console.log('wiped', await wipeEmpRegs());

  // ============================================================
  // PART 1 — three rejection claims
  // ============================================================
  console.log('\n=== PART 1: Three rejection claims (window=7, max=2 MONTHLY) ===');
  await setPolicy({ maxRegularisationRequests: 2, regularisationPeriod: 'MONTHLY', regularisationWindowDays: 7 });

  // 1a. Future-dated
  const rFuture = await submitReg(token, FUTURE);
  rec('Future-dated rejected', '412 future date', rFuture,
    rFuture.status === 412 && /future date/i.test(errMsg(rFuture.body)));

  // 1b. Outside window
  const rWin = await submitReg(token, OUT_OF_WINDOW);
  rec('Outside window rejected', '412 beyond 7 days', rWin,
    rWin.status === 412 && /beyond 7 days/i.test(errMsg(rWin.body)));

  // 1c. ADJUST_LOGS null times
  const rNull = await api('/attendance/regularise', {
    method: 'POST',
    token,
    body: {
      date: IN_WINDOW_OK,
      type: 'ADJUST_LOGS',
      note: 'null times test',
      // requested_in_time / requested_out_time omitted → null
    },
  });
  rec('ADJUST_LOGS null times rejected', '400 required', rNull,
    rNull.status === 400 && /required for ADJUST_LOGS/i.test(errMsg(rNull.body)));

  // ============================================================
  // PART 2 — WEEKLY bucketing
  // ============================================================
  console.log('\n=== PART 2: WEEKLY bucketing (max=1) ===');
  await wipeEmpRegs();
  await setPolicy({ maxRegularisationRequests: 1, regularisationPeriod: 'WEEKLY' });

  // Fixture last week (Sep 16, same calendar month) — must NOT count for WEEKLY
  const fxLastWeek = await insertRegFixture({
    dayStr: PRIOR_WEEK_DAY,
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
  });
  const rW1 = await submitReg(token, IN_WINDOW_OK);
  rec('WEEKLY: prior-week fixture does not count', '200 success', rW1,
    rW1.status === 200 && !!rW1.body?.regularisation?.id);

  // Cleanup API reg + insert current-week fixture → must count → reject
  await wipeEmpRegs();
  await insertRegFixture({
    dayStr: CURRENT_WEEK_DAY,
    createdAt: new Date('2026-09-21T10:00:00.000Z'), // Monday this week
  });
  const rW2 = await submitReg(token, IN_WINDOW_OK);
  rec('WEEKLY: current-week fixture counts → reject', '412 weekly limit', rW2,
    rW2.status === 412 && /per weekly period/i.test(errMsg(rW2.body)));

  // Distinguish from MONTHLY: same prior-week fixture under MONTHLY must count
  await wipeEmpRegs();
  await setPolicy({ maxRegularisationRequests: 1, regularisationPeriod: 'MONTHLY' });
  await insertRegFixture({
    dayStr: PRIOR_WEEK_DAY,
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
  });
  const rMvsW = await submitReg(token, IN_WINDOW_OK);
  rec('MONTHLY counts prior-week same-month fixture', '412 monthly limit', rMvsW,
    rMvsW.status === 412 && /per monthly period/i.test(errMsg(rMvsW.body)));

  // ============================================================
  // PART 3 — YEARLY bucketing
  // ============================================================
  console.log('\n=== PART 3: YEARLY bucketing (max=1) ===');
  await wipeEmpRegs();
  await setPolicy({ maxRegularisationRequests: 1, regularisationPeriod: 'YEARLY' });

  // Aug fixture (same year, different month) — must count for YEARLY
  await insertRegFixture({
    dayStr: '2026-08-15',
    createdAt: new Date('2026-08-15T10:00:00.000Z'),
  });
  const rY1 = await submitReg(token, IN_WINDOW_OK);
  rec('YEARLY: prior-month same-year fixture counts → reject', '412 yearly limit', rY1,
    rY1.status === 412 && /per yearly period/i.test(errMsg(rY1.body)));

  // Distinguish from MONTHLY: same Aug fixture under MONTHLY must NOT count
  await wipeEmpRegs();
  await setPolicy({ maxRegularisationRequests: 1, regularisationPeriod: 'MONTHLY' });
  await insertRegFixture({
    dayStr: '2026-08-15',
    createdAt: new Date('2026-08-15T10:00:00.000Z'),
  });
  const rYvsM = await submitReg(token, IN_WINDOW_OK);
  rec('MONTHLY does not count prior-month fixture', '200 success', rYvsM,
    rYvsM.status === 200 && !!rYvsM.body?.regularisation?.id);

  // ============================================================
  // PART 4 — createdAt period boundary (MONTHLY max=2)
  // ============================================================
  console.log('\n=== PART 4: createdAt period boundary (max=2 MONTHLY) ===');
  await wipeEmpRegs();
  await setPolicy({ maxRegularisationRequests: 2, regularisationPeriod: 'MONTHLY' });

  const b1 = await submitReg(token, '2026-09-18');
  rec('Boundary 1st submit', '200', b1, b1.status === 200);
  const b2 = await submitReg(token, '2026-09-19');
  rec('Boundary 2nd submit', '200', b2, b2.status === 200);
  const b3 = await submitReg(token, '2026-09-20');
  rec('Boundary 3rd submit rejected', '412 monthly limit', b3,
    b3.status === 412 && /per monthly period/i.test(errMsg(b3.body)));

  // Future-dated is already rejected above (Part 1); under createdAt bucketing,
  // a future-dated target never reaches the count check. Prove createdAt drives
  // the count by moving one live reg's createdAt into October.

  // Prove createdAt field drives the count: move one live reg into October
  const live = await prisma.attendanceRegularisation.findFirst({
    where: { employeeId: EMP, deletedAt: null, status: { in: ['PENDING', 'APPROVED'] } },
    orderBy: { createdAt: 'asc' },
  });
  await prisma.attendanceRegularisation.update({
    where: { id: live.id },
    data: { createdAt: new Date('2026-10-01T12:00:00.000Z') },
  });
  const b4 = await submitReg(token, '2026-09-21');
  rec('After moving createdAt→Oct, next Sep submit succeeds', '200', b4,
    b4.status === 200 && !!b4.body?.regularisation?.id);

  // ============================================================
  // Cleanup
  // ============================================================
  await wipeEmpRegs();
  // restore baseline for E2E / future runs
  await setPolicy({
    maxRegularisationRequests: 2,
    regularisationPeriod: 'MONTHLY',
    regularisationWindowDays: 7,
    allowRegularisation: true,
    regularisationMode: 'BOTH',
  });
  console.log('\nCleanup done; policy restored max=2 MONTHLY window=7');

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n=== VERIFY-FINAL: ${pass} PASS / ${fail} FAIL ===`);

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
