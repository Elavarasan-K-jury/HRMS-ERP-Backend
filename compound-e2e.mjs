import dotenv from 'dotenv';
import { signAccessToken } from '@jury-hrms/auth/jwt.js';
import { prisma } from '@jury-hrms/db/client.js';

dotenv.config({ path: '/Users/jslap020/Documents/JurysoftProjects/HRMS-Manufacturing/Backend/.env' });

const BASE = 'http://localhost:50050';
const ORG = '6a69e65fe80f3dd717545124';
const EMP = '6a69f2b08108fd9fa316e2f7';
const LT = '6ab234ce3d33355b58c338ae';
const SHIFT = '6a84338f5145dc1b7dba23b7';
const WO_POLICY = '6ab2104fa6ee2abb954c0639';
const ADMIN_SUPER = '6a991d0568008ebaa8dc3880';

// Dates (local IST calendar days)
const LEAVE_START = '2026-09-25'; // Friday
const LEAVE_END = '2026-09-27';   // Sunday (weekly off)
const REG_DAY = '2026-09-21';     // Monday — past working day (future dates rejected)
const SHIFT_FROM = '2026-09-20';
const SHIFT_TO = '2026-09-30';

const results = [];
function assert(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, text };
}

function localDayKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Local (IST) day boundaries for prisma date ranges — dates are stored at local midnight
function localDayRange(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { gte: start, lt: end };
}
function localRange(fromStr, toStrExclusive) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStrExclusive.split('-').map(Number);
  return { gte: new Date(fy, fm - 1, fd, 0, 0, 0, 0), lt: new Date(ty, tm - 1, td, 0, 0, 0, 0) };
}
// Gateway date is formatted as en-IN long date (dd/mm/yyyy or similar) — parse day-first safely
function parseGatewayDate(s) {
  if (!s) return '';
  // formatDate uses en-IN locale: e.g. "25 September 2026" or "25/9/2026"
  const m = String(s).match(/(\d{1,2})[\/\-\s]+(\d{1,2})[\/\-\s]+(\d{4})/);
  if (m) {
    const [ , a, b, y ] = m;
    // en-IN day/month/year
    return `${y}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return localDayKey(d);
  return String(s);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, ms = 8000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

async function main() {
  const employeeToken = await signAccessToken({
    sub: EMP,
    email: 'emp@test.local',
    scope: 'employee',
    organizationId: ORG,
  });
  const adminToken = await signAccessToken({
    sub: ADMIN_SUPER,
    email: 'elavarasanek01@gmail.com',
    scope: 'admin',
  });

  console.log('=== Compound E2E starting ===');

  // 0) Gateway up
  const root = await api('/');
  assert('gateway root up', root.status === 200, `status=${root.status}`);

  // 1) Seed weekly-off assignment (Sunday Off) for EMP
  let wo = await prisma.employeeWeeklyOffAssignment.findFirst({
    where: { employeeId: EMP, deletedAt: null },
  });
  if (!wo) {
    wo = await prisma.employeeWeeklyOffAssignment.create({
      data: {
        employeeId: EMP,
        weeklyOffPolicyId: WO_POLICY,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
      },
    });
  }
  assert('weekly-off assignment present', wo?.id, `id=${wo?.id}`);

  // 2) Clean prior leaves in range + prior regs for REG_DAY (fresh scenario)
  const priorLeaves = await prisma.leaveRequests.findMany({
    where: {
      employeeId: EMP,
      startDate: localRange('2026-09-20', '2026-10-01'),
    },
  });
  for (const l of priorLeaves) {
    await prisma.leaveRequests.update({ where: { id: l.id }, data: { deletedAt: new Date() } }).catch(() => {});
  }
  // Reverse LeaveBalance so prior runs don't exhaust allocation
  await prisma.leaveBalance.updateMany({
    where: { employeeId: EMP, leaveTypeId: LT, year: 2026 },
    data: { used: 0, pending: 0 },
  }).catch(() => {});
  // Reset attendance in leave window + reg day
  await prisma.attendance.updateMany({
    where: {
      employeeId: EMP,
      date: localRange('2026-09-20', '2026-10-01'),
      status: { in: ['LEAVE', 'WEEKLY_OFF', 'REGULARISED'] },
    },
    data: { status: 'PENDING', checkIn: null, checkOut: null },
  });
  await prisma.attendanceRegularisation.updateMany({
    where: {
      employeeId: EMP,
      date: localRange('2026-09-20', '2026-10-01'),
    },
    data: { deletedAt: new Date() },
  }).catch(() => {});
  // Remove old shift assignments overlapping test window
  await prisma.employeeShiftAssignment.updateMany({
    where: {
      employeeId: EMP,
      OR: [
        { validTo: null },
        { validTo: { gte: new Date(2026, 8, 1) } },
      ],
      validFrom: { lt: new Date(2026, 10, 1) },
    },
    data: { deletedAt: new Date() },
  }).catch(() => {});
  console.log('cleanup done');

  // 3) Apply leave spanning weekly-off Sunday
  const applyRes = await api('/leave/apply', {
    method: 'POST',
    token: employeeToken,
    body: {
      employee_id: EMP,
      leave_type_id: LT,
      start_date: LEAVE_START,
      end_date: LEAVE_END,
      reason: 'Compound E2E: leave spanning weekly-off Sunday',
    },
  });
  assert('leave apply 200', applyRes.status === 200, `status=${applyRes.status} body=${JSON.stringify(applyRes.body)?.slice(0, 300)}`);
  const leave = applyRes.body?.leave_request;
  assert('leave request returned', !!leave?.id, `id=${leave?.id} total_days=${leave?.total_days}`);
  // Sunday should be excluded from working days → total_days expected 2 (Fri+Sat? wait Sat is working; Sun off → Fri, Sat = 2? LEAVE_START Fri 25, END Sun 27 → Fri, Sat, Sun; Sun off → 2)
  assert('total_days excludes Sunday', Number(leave?.total_days) === 2, `total_days=${leave?.total_days}`);

  const leaveId = leave?.id;
  const approvalInstanceId = leave?.approval_instance_id;
  assert('leave has approval instance', !!approvalInstanceId, `approval_instance_id=${approvalInstanceId}`);

  // 4) Approve via POST /approval/instances/{id}/approve (admin JWT)
  if (approvalInstanceId) {
    const approveRes = await api(`/approval/instances/${approvalInstanceId}/approve`, {
      method: 'POST',
      token: adminToken,
      body: { approver_id: EMP, remarks: 'Compound E2E approval' },
    });
    assert('approval instance approve 200', approveRes.status === 200, `status=${approveRes.status} body=${JSON.stringify(approveRes.body)?.slice(0, 400)}`);
  } else {
    assert('approval instance approve 200', false, 'no approval instance id');
  }

  // Wait for leave APPROVED + attendance recompute (redis async)
  const leaveAfter = await waitFor(async () => {
    const l = await prisma.leaveRequests.findFirst({ where: { id: leaveId } });
    return l && l.status === 'APPROVED' ? l : null;
  }, 10000);
  assert('leave status APPROVED', leaveAfter?.status === 'APPROVED', `status=${leaveAfter?.status}`);

  // 5) Verify attendance per day for leave range
  const attList = await waitFor(async () => {
    const rows = await prisma.attendance.findMany({
      where: {
        employeeId: EMP,
        date: localRange('2026-09-25', '2026-09-28'),
      },
      orderBy: { date: 'asc' },
    });
    // Need LEAVE on Fri and WEEKLY_OFF on Sun
    const byKey = {};
    for (const r of rows) byKey[localDayKey(r.date)] = r.status;
    return (byKey['2026-09-25'] === 'LEAVE' && byKey['2026-09-27'] === 'WEEKLY_OFF') ? byKey : null;
  }, 10000);
  const attRows = await prisma.attendance.findMany({
    where: {
      employeeId: EMP,
      date: localRange('2026-09-25', '2026-09-28'),
    },
    orderBy: { date: 'asc' },
  });
  const map = {};
  for (const r of attRows) map[localDayKey(r.date)] = r.status;
  console.log('attendance map', map);
  assert('Fri 2026-09-25 is LEAVE', map['2026-09-25'] === 'LEAVE', `got=${map['2026-09-25']}`);
  assert('Sun 2026-09-27 is WEEKLY_OFF (not LEAVE)', map['2026-09-27'] === 'WEEKLY_OFF', `got=${map['2026-09-27']}`);

  // 6) Ensure attendance exists for REG_DAY (create if missing)
  let regAtt = await prisma.attendance.findFirst({
    where: {
      employeeId: EMP,
      date: localDayRange(REG_DAY),
    },
  });
  if (!regAtt) {
    const createAtt = await api('/attendance', {
      method: 'POST',
      token: employeeToken,
      body: {
        organization_id: ORG,
        employee_id: EMP,
        date: REG_DAY,
        status: 'PENDING',
      },
    });
    assert('create attendance for reg day', createAtt.status === 201 || createAtt.status === 409, `status=${createAtt.status} body=${JSON.stringify(createAtt.body)?.slice(0, 200)}`);
    regAtt = await prisma.attendance.findFirst({
      where: {
        employeeId: EMP,
        date: localDayRange(REG_DAY),
      },
    });
  } else {
    // reset to PENDING if needed
    if (regAtt.status !== 'PENDING' && regAtt.status !== 'LATE' && regAtt.status !== 'ABSENT') {
      await prisma.attendance.update({ where: { id: regAtt.id }, data: { status: 'PENDING', checkIn: null, checkOut: null } });
    }
    assert('attendance exists for reg day', true, `id=${regAtt.id} status=${regAtt.status}`);
  }
  assert('reg day attendance id', !!regAtt?.id, `id=${regAtt?.id}`);
  if (!regAtt) {
    const pass = results.filter(r => r.pass).length;
    const fail = results.filter(r => !r.pass).length;
    console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL (aborted: no reg attendance) ===`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // 7) Regularise REG_DAY (separate from leave range)
  const inISO = `${REG_DAY}T04:00:00.000Z`; // 09:30 IST
  const outISO = `${REG_DAY}T12:00:00.000Z`; // 17:30 IST
  const regRes = await api('/attendance/regularise', {
    method: 'POST',
    token: employeeToken,
    body: {
      attendance_id: regAtt.id,
      type: 'ADJUST_LOGS',
      note: 'Compound E2E regularisation',
      requested_in_time: inISO,
      requested_out_time: outISO,
    },
  });
  assert('regularise submit 200', regRes.status === 200, `status=${regRes.status} body=${JSON.stringify(regRes.body)?.slice(0, 400)}`);
  const reg = regRes.body?.regularisation;
  assert('regularisation returned', !!reg?.id, `id=${reg?.id} status=${reg?.status}`);

  // Wait for approval instance link
  const regWithApproval = await waitFor(async () => {
    const r = await prisma.attendanceRegularisation.findFirst({ where: { id: reg?.id } });
    return r?.approvalInstanceId ? r : null;
  }, 5000);
  assert('reg linked to approval instance', !!regWithApproval?.approvalInstanceId, `id=${regWithApproval?.approvalInstanceId}`);

  // 8) Approve regularisation via approval instance
  if (regWithApproval?.approvalInstanceId) {
    const regApprove = await api(`/approval/instances/${regWithApproval.approvalInstanceId}/approve`, {
      method: 'POST',
      token: adminToken,
      body: { approver_id: EMP, remarks: 'Compound E2E reg approval' },
    });
    assert('reg approval instance approve 200', regApprove.status === 200, `status=${regApprove.status} body=${JSON.stringify(regApprove.body)?.slice(0, 400)}`);
  } else {
    assert('reg approval instance approve 200', false, 'no reg approval instance');
  }

  // Wait for attendance REGULARISED
  const regDone = await waitFor(async () => {
    const a = await prisma.attendance.findFirst({ where: { id: regAtt.id } });
    const r = await prisma.attendanceRegularisation.findFirst({ where: { id: reg?.id } });
    return (a?.status === 'REGULARISED' && r?.status === 'APPROVED') ? { a, r } : null;
  }, 10000);
  const attAfterReg = await prisma.attendance.findFirst({ where: { id: regAtt.id } });
  const regAfter = await prisma.attendanceRegularisation.findFirst({ where: { id: reg?.id } });
  assert('attendance REGULARISED after reg approve', attAfterReg?.status === 'REGULARISED', `status=${attAfterReg?.status}`);
  assert('regularisation APPROVED', regAfter?.status === 'APPROVED', `status=${regAfter?.status}`);

  // 9) Reassign shift overlapping regularised day → clearAttendanceAdjustments
  const shiftRes = await api('/shift-assignments', {
    method: 'POST',
    token: adminToken,
    body: {
      employee_id: EMP,
      shift_id: SHIFT,
      valid_from: `${SHIFT_FROM}T00:00:00.000Z`,
      valid_to: `${SHIFT_TO}T23:59:59.999Z`,
    },
  });
  assert('shift reassignment created', shiftRes.status === 201, `status=${shiftRes.status} body=${JSON.stringify(shiftRes.body)?.slice(0, 300)}`);

  // 10) Verify clearAttendanceAdjustments effects
  const cleared = await waitFor(async () => {
    const a = await prisma.attendance.findFirst({ where: { id: regAtt.id } });
    const r = await prisma.attendanceRegularisation.findFirst({ where: { id: reg?.id } });
    return (a?.status === 'PENDING' && (r?.deletedAt != null)) ? { a, r } : null;
  }, 8000);
  const attFinal = await prisma.attendance.findFirst({ where: { id: regAtt.id } });
  const regFinal = await prisma.attendanceRegularisation.findFirst({ where: { id: reg?.id } });
  assert('clearAttendanceAdjustments: REGULARISED→PENDING', attFinal?.status === 'PENDING', `status=${attFinal?.status}`);
  assert('clearAttendanceAdjustments: reg soft-deleted', regFinal?.deletedAt != null, `deletedAt=${regFinal?.deletedAt}`);

  // 11) Also verify via gateway GET /attendance list for month
  const listRes = await api(`/attendance?employee_id=${EMP}&month=2026-09`, { token: employeeToken });
  assert('GET /attendance list 200', listRes.status === 200, `status=${listRes.status}`);
  const listRows = listRes.body?.attendance || [];
  const listMap = {};
  for (const r of listRows) {
    // Gateway formatDate returns en-IN display format — always reparse to local day key
    const k = typeof r.date === 'string' ? parseGatewayDate(r.date) : localDayKey(r.date);
    listMap[k] = r.status;
  }
  console.log('gateway list sample dates', listRows.slice(0, 5).map(r => r.date));
  console.log('gateway list key days', {
    [REG_DAY]: listMap[REG_DAY],
    '2026-09-25': listMap['2026-09-25'],
    '2026-09-27': listMap['2026-09-27'],
  });
  assert('gateway list Fri=LEAVE', listMap['2026-09-25'] === 'LEAVE', `got=${listMap['2026-09-25']}`);
  assert('gateway list Sun=WEEKLY_OFF', listMap['2026-09-27'] === 'WEEKLY_OFF', `got=${listMap['2026-09-27']}`);
  assert('gateway list REG_DAY=PENDING after clear', listMap[REG_DAY] === 'PENDING', `got=${listMap[REG_DAY]}`);

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL (total ${results.length}) ===`);
  for (const r of results.filter(x => !x.pass)) console.log('FAILED:', r.name, r.detail);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('E2E fatal:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(2);
});
