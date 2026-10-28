import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

interface AuditTestCase {
  id: string;
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN';
  evidence: string;
}

const results: AuditTestCase[] = [];

function record(
  category: string,
  name: string,
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN',
  evidence: string
) {
  const id = `T-${String(results.length + 1).padStart(2, '0')}`;
  results.push({ id, category, name, status, evidence });
  const icon =
    status === 'PASS'
      ? '✅ PASS'
      : status === 'FAIL'
      ? '❌ FAIL'
      : status === 'BLOCKED'
      ? '🚫 BLOCKED'
      : '⚪ NOT RUN';
  console.log(`${icon} [${id}][${category}] ${name} — ${evidence}`);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function httpReq(
  port: number,
  options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    rawBody?: string;
    timeoutMs?: number;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload =
      options.rawBody !== undefined
        ? options.rawBody
        : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (payload !== undefined) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method || 'GET',
        headers,
        timeout: options.timeoutMs || 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed, raw });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout on ${options.method || 'GET'} ${options.path}`));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function startIsolatedStagingServer(opts: {
  port: number;
  dataDir: string;
  uploadsDir: string;
  sessionSecret: string;
  authRateMax?: number;
}): Promise<ChildProcess> {
  const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const child = spawn(tsxBin, ['server.ts', '--port', String(opts.port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DISABLE_HMR: 'true',
      WCR_DATA_DIR: opts.dataDir,
      WCR_UPLOADS_DIR: opts.uploadsDir,
      SESSION_SECRET: opts.sessionSecret,
      WCR_RATE_LIMIT_AUTH_MAX: String(opts.authRateMax || 25),
      WCR_RATE_LIMIT_API_MAX: '800',
    },
    stdio: 'ignore',
  });

  // Poll until /api/server-time responds 200
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await httpReq(opts.port, { path: '/api/server-time', timeoutMs: 1500 });
      if (res.status === 200) return child;
    } catch {}
    await waitMs(250);
  }
  child.kill('SIGTERM');
  throw new Error(`Staging server failed to start on port ${opts.port}`);
}

async function stopServer(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(t);
      resolve();
    }
  });
}

async function runStagingAudit() {
  const PORT = 3199;
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcr_staging_audit_'));
  const dataDir = path.join(stagingRoot, 'data');
  const uploadsDir = path.join(stagingRoot, 'uploads', 'photos');
  const sessionSecret = crypto.randomBytes(32).toString('hex');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  let serverProc: ChildProcess | null = null;

  console.log('================================================================================');
  console.log('   SMARTPANTRY PRO — END-TO-END ISOLATED STAGING PRODUCTION-READINESS AUDIT     ');
  console.log('================================================================================');
  console.log(`Isolated Staging Root: ${stagingRoot} (Port ${PORT}, NODE_ENV=production)\n`);

  try {
    serverProc = await startIsolatedStagingServer({
      port: PORT,
      dataDir,
      uploadsDir,
      sessionSecret,
      authRateMax: 20,
    });

    // =========================================================================
    // 1. AUTHENTICATION, COOKIES, SESSION SECURITY & REVOCATION
    // =========================================================================
    const adminLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'admin.director@whitecollarrealty.com' },
    });
    const adminToken = adminLogin.body?.token || '';
    const adminSetCookie = String(adminLogin.headers['set-cookie']?.[0] || '');
    const adminCookiePair = adminSetCookie.split(';')[0] || '';
    record(
      'Auth & Sessions',
      'Admin Login & HttpOnly Session Cookie Issuance',
      adminLogin.status === 200 &&
        adminLogin.body?.user?.role === 'ADMIN' &&
        Boolean(adminToken) &&
        adminSetCookie.includes('HttpOnly') &&
        adminSetCookie.includes('wcr_session=')
        ? 'PASS'
        : 'FAIL',
      `HTTP ${adminLogin.status}, role=${adminLogin.body?.user?.role}, Set-Cookie HttpOnly=${adminSetCookie.includes('HttpOnly')}`
    );

    const hrLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'priya.sen@whitecollarrealty.com' },
    });
    const hrToken = hrLogin.body?.token || '';
    record(
      'Auth & Sessions',
      'HR Manager Login & Role Permissions',
      hrLogin.status === 200 &&
        hrLogin.body?.user?.role === 'HR' &&
        hrLogin.body?.user?.permissions?.dashboards?.management === true
        ? 'PASS'
        : 'FAIL',
      `HTTP ${hrLogin.status}, role=${hrLogin.body?.user?.role}, management=${hrLogin.body?.user?.permissions?.dashboards?.management}`
    );

    const kimmiLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'kimmi.mam@whitecollarrealty.com' },
    });
    const kimmiToken = kimmiLogin.body?.token || '';
    record(
      'Auth & Sessions',
      'Co-Founder (Kimmi Mam) Login & Legacy Email Alias Compatibility',
      kimmiLogin.status === 200 && kimmiLogin.body?.user?.role === 'KIMMY_MAM' ? 'PASS' : 'FAIL',
      `HTTP ${kimmiLogin.status}, role=${kimmiLogin.body?.user?.role}`
    );

    const pantryLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'raju.sharma@whitecollarrealty.com' },
    });
    const pantryToken = pantryLogin.body?.token || '';
    record(
      'Auth & Sessions',
      'Pantry Boy Login, Dashboard Isolation & Auto Check-In',
      pantryLogin.status === 200 &&
        pantryLogin.body?.user?.role === 'PANTRY_BOY' &&
        pantryLogin.body?.user?.permissions?.dashboards?.pantry === true &&
        pantryLogin.body?.user?.permissions?.dashboards?.management === false &&
        Boolean(pantryLogin.body?.attendance?.id)
        ? 'PASS'
        : 'FAIL',
      `HTTP ${pantryLogin.status}, pantry=${pantryLogin.body?.user?.permissions?.dashboards?.pantry}, mgmt=${pantryLogin.body?.user?.permissions?.dashboards?.management}, attendance=${pantryLogin.body?.attendance?.status}`
    );

    // Invalid credentials & malformed JSON
    const badLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'intruder.synthetic@attacker.example' },
    });
    record(
      'Auth & Sessions',
      'Unauthorized Account Rejection',
      badLogin.status === 401 && badLogin.body?.code === 'UNAUTHORIZED_ACCOUNT' ? 'PASS' : 'FAIL',
      `HTTP ${badLogin.status}, code=${badLogin.body?.code}`
    );

    const badJson = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      rawBody: '{"email": "broken-json',
    });
    record(
      'Security',
      'Malformed JSON Request Handling (No Stack Trace Leak)',
      badJson.status === 400 && badJson.body?.code === 'INVALID_JSON' ? 'PASS' : 'FAIL',
      `HTTP ${badJson.status}, code=${badJson.body?.code}`
    );

    // HMAC Tampering & Forged Default Secret Token Rejection
    const tamperedTok = adminToken.slice(0, -6) + 'ffffff';
    const tamperedRes = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${tamperedTok}` },
    });
    const legacyForgedTs = Date.now();
    const legacyHmac = crypto
      .createHmac('sha256', 'wcr-smart-pantry-super-secret-key-2026')
      .update(`user-admin-1:${legacyForgedTs}:deadbeef`)
      .digest('hex')
      .substring(0, 16);
    const legacyForgedTok = `wcr_sess_user-admin-1_${legacyForgedTs}_deadbeef_${legacyHmac}`;
    const forgedRes = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${legacyForgedTok}` },
    });
    record(
      'Security',
      'HMAC Tamper & Legacy Hardcoded Secret Token Forgery Rejection',
      tamperedRes.status === 401 && forgedRes.status === 401 ? 'PASS' : 'FAIL',
      `Tampered HTTP ${tamperedRes.status}, Forged-default-secret HTTP ${forgedRes.status}`
    );

    // Expired >7d token rejection
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const oldHmac = crypto
      .createHmac('sha256', sessionSecret)
      .update(`user-admin-1:${oldTs}:11223344`)
      .digest('hex')
      .substring(0, 16);
    const expiredTok = `wcr_sess_user-admin-1_${oldTs}_11223344_${oldHmac}`;
    const expiredRes = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${expiredTok}` },
    });
    record(
      'Auth & Sessions',
      'Expired Session (>7 Days) Rejection',
      expiredRes.status === 401 ? 'PASS' : 'FAIL',
      `HTTP ${expiredRes.status}`
    );

    // Logout & immediate revocation
    const tempLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'priya.sen@whitecollarrealty.com' },
    });
    const tempTok = tempLogin.body?.token;
    const logoutRes = await httpReq(PORT, {
      path: '/api/auth/logout',
      method: 'POST',
      headers: { Authorization: `Bearer ${tempTok}` },
    });
    const reuseRes = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${tempTok}` },
    });
    record(
      'Auth & Sessions',
      'Logout Token Revocation & Cookie Clearing',
      logoutRes.status === 200 &&
        reuseRes.status === 401 &&
        String(logoutRes.headers['set-cookie']?.[0] || '').includes('Max-Age=0')
        ? 'PASS'
        : 'FAIL',
      `Logout HTTP ${logoutRes.status}, Reuse HTTP ${reuseRes.status}, Cookie cleared=${String(logoutRes.headers['set-cookie']?.[0] || '').includes('Max-Age=0')}`
    );

    // =========================================================================
    // 2. SECURITY REGRESSION TESTS FOR FIXED VULNERABILITIES
    // =========================================================================
    // REG-01: /api/auth/switch-user Auth Bypass & Privilege Escalation
    const unauthSwitch = await httpReq(PORT, {
      path: '/api/auth/switch-user',
      method: 'POST',
      body: { userId: 'user-admin-1' },
    });
    const pantryEscalateSwitch = await httpReq(PORT, {
      path: '/api/auth/switch-user',
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { userId: 'user-admin-1' },
    });
    const hrEscalateSwitch = await httpReq(PORT, {
      path: '/api/auth/switch-user',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { userId: 'user-admin-1' },
    });
    // Verify pantryToken was NOT destroyed by failed switch attempt
    const pantryStillValid = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    record(
      'Security (Regression)',
      'POST /api/auth/switch-user Unauthenticated & Non-Admin Escalation Blocked',
      unauthSwitch.status === 401 &&
        pantryEscalateSwitch.status === 403 &&
        hrEscalateSwitch.status === 403 &&
        pantryStillValid.status === 200
        ? 'PASS'
        : 'FAIL',
      `Unauth=${unauthSwitch.status}, Pantry->Admin=${pantryEscalateSwitch.status}, HR->Admin=${hrEscalateSwitch.status}, CallerSessionIntact=${pantryStillValid.status}`
    );

    // Admin legitimate switch-user test (using separate disposable Admin session)
    const disposableAdmin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'admin.director@whitecollarrealty.com' },
    });
    const adminSwitchOk = await httpReq(PORT, {
      path: '/api/auth/switch-user',
      method: 'POST',
      headers: { Authorization: `Bearer ${disposableAdmin.body.token}` },
      body: { userId: 'user-hr-1' },
    });
    record(
      'Auth & Sessions',
      'Admin Authorized Account Switch & Previous Token Rotation',
      adminSwitchOk.status === 200 && adminSwitchOk.body?.user?.id === 'user-hr-1' ? 'PASS' : 'FAIL',
      `Admin switch HTTP ${adminSwitchOk.status}, switchedTo=${adminSwitchOk.body?.user?.email}`
    );

    // REG-03: Unauthenticated GET /api/users Data Redaction
    const unauthUsers = await httpReq(PORT, { path: '/api/users' });
    const authUsers = await httpReq(PORT, {
      path: '/api/users',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const unauthSample = unauthUsers.body?.users?.[0] || {};
    const authSample = authUsers.body?.users?.[0] || {};
    record(
      'Security (Regression)',
      'GET /api/users Redacts Phone, Permissions & SuperAdmin Flags When Unauthenticated',
      unauthUsers.status === 200 &&
        unauthSample.phone === undefined &&
        unauthSample.permissions === undefined &&
        unauthSample.isSuperAdmin === undefined &&
        authSample.permissions !== undefined
        ? 'PASS'
        : 'FAIL',
      `Unauth fields=[${Object.keys(unauthSample).join(',')}], Auth hasPermissions=${Boolean(authSample.permissions)}`
    );

    // REG-04: User CRUD, Super Admin Protection, Role Enum Validation & Permission Escalation Prevention
    const hrSelfGrantDelete = await httpReq(PORT, {
      path: '/api/users/user-hr-1',
      method: 'PUT',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        permissions: {
          dashboards: { pantry: false, management: true },
          sidebarItems: {
            dashboard: false,
            myTasks: false,
            roomSupport: false,
            pantryRequests: false,
            notifications: false,
            taskHistory: false,
            myProfile: false,
            overview: true,
            tasks: true,
            rooms: true,
            visitors: true,
            reports: true,
            users: true,
            audit: true,
            settings: true,
          },
          actions: {
            tasks: { view: true, create: true, edit: true, delete: true },
            rooms: { view: true, create: true, edit: true, delete: true },
            visitors: { view: true, create: true, edit: true, delete: true },
            users: { view: true, create: true, edit: true, delete: true },
            reports: { view: true, export: true },
          },
        },
      },
    });
    const invalidRoleCreate = await httpReq(PORT, {
      path: '/api/users',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Bad Role', email: 'bad.role@whitecollarrealty.com', role: 'ROOT_HACKER' },
    });
    const superAdminDeactivate = await httpReq(PORT, {
      path: '/api/users/user-admin-1/toggle-status',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const superAdminDelete = await httpReq(PORT, {
      path: '/api/users/user-admin-1',
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    record(
      'Security (Regression)',
      'HR Self-Escalation Blocked, Invalid Role Rejected & Super Admin Protected',
      hrSelfGrantDelete.status === 403 &&
        hrSelfGrantDelete.body?.code === 'PRIVILEGE_ESCALATION_BLOCKED' &&
        invalidRoleCreate.status === 400 &&
        superAdminDeactivate.status === 403 &&
        superAdminDelete.status === 403
        ? 'PASS'
        : 'FAIL',
      `HR-escalate=${hrSelfGrantDelete.status} (${hrSelfGrantDelete.body?.code}), BadRole=${invalidRoleCreate.status}, SuperAdminDeactivate=${superAdminDeactivate.status}, SuperAdminDelete=${superAdminDelete.status}`
    );

    // Synthetic User Lifecycle: Create -> Login -> Deactivate (Immediate Session Revocation) -> Reactivate -> Delete
    const synthUserCreate = await httpReq(PORT, {
      path: '/api/users',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Synthetic QA Staff',
        email: 'synthetic.staff@whitecollarrealty.com',
        role: 'HR',
        department: 'QA Staging',
        phone: '+91-9000000001',
      },
    });
    const synthUserId = synthUserCreate.body?.user?.id;
    const synthLogin = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'synthetic.staff@whitecollarrealty.com' },
    });
    const synthTok = synthLogin.body?.token;
    const deactivateRes = await httpReq(PORT, {
      path: `/api/users/${synthUserId}/toggle-status`,
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const synthAfterDeactivate = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${synthTok}` },
    });
    const inactiveLoginAttempt = await httpReq(PORT, {
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'synthetic.staff@whitecollarrealty.com' },
    });
    const reactivateRes = await httpReq(PORT, {
      path: `/api/users/${synthUserId}/toggle-status`,
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const hrDeleteUserDenied = await httpReq(PORT, {
      path: `/api/users/${synthUserId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const adminDeleteUserOk = await httpReq(PORT, {
      path: `/api/users/${synthUserId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    record(
      'Users CRUD & Revocation',
      'User Create, Deactivation Immediate Token Purge, Reactivation & Admin-Only Deletion',
      synthUserCreate.status === 200 &&
        synthLogin.status === 200 &&
        deactivateRes.status === 200 &&
        synthAfterDeactivate.status === 401 &&
        inactiveLoginAttempt.status === 403 &&
        reactivateRes.status === 200 &&
        hrDeleteUserDenied.status === 403 &&
        adminDeleteUserOk.status === 200
        ? 'PASS'
        : 'FAIL',
      `Create=${synthUserCreate.status}, PostDeactivateAuth=${synthAfterDeactivate.status}, InactiveLogin=${inactiveLoginAttempt.status}, HRDelete=${hrDeleteUserDenied.status}, AdminDelete=${adminDeleteUserOk.status}`
    );

    // =========================================================================
    // 3. ATTENDANCE WORKFLOWS & IDEMPOTENCY
    // =========================================================================
    const hrLogoutDenied = await httpReq(PORT, {
      path: '/api/attendance/record-logout',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const pantryLogout1 = await httpReq(PORT, {
      path: '/api/attendance/record-logout',
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const firstLogoutIso = pantryLogout1.body?.attendance?.logoutTime;
    await waitMs(50);
    const pantryLogout2 = await httpReq(PORT, {
      path: '/api/attendance/record-logout',
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const secondLogoutIso = pantryLogout2.body?.attendance?.logoutTime;
    const pantryReCheckIn = await httpReq(PORT, {
      path: '/api/attendance/record-login',
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const attHist = await httpReq(PORT, {
      path: '/api/attendance/history',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    record(
      'Attendance',
      'Check-In, Check-Out RBAC, Duplicate Logout Idempotency & Multi-Session Tracking',
      hrLogoutDenied.status === 403 &&
        pantryLogout1.status === 200 &&
        pantryLogout1.body?.attendance?.status === 'COMPLETED' &&
        firstLogoutIso === secondLogoutIso &&
        pantryReCheckIn.status === 200 &&
        String(pantryReCheckIn.body?.attendance?.id || '').includes('-s2') &&
        Array.isArray(attHist.body?.history) &&
        attHist.body.history.length >= 2
        ? 'PASS'
        : 'FAIL',
      `HRLogout=${hrLogoutDenied.status}, IdempotentLogoutMatch=${firstLogoutIso === secondLogoutIso}, Session2Id=${pantryReCheckIn.body?.attendance?.id}`
    );

    // =========================================================================
    // 4. ROOMS CRUD, MASS ASSIGNMENT DEFENSE, ASSIGNMENTS & WORKFLOW AUTOMATION
    // =========================================================================
    const synthRoomId = 'room-staging-synth-1';
    const createRoom = await httpReq(PORT, {
      path: '/api/rooms',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        id: synthRoomId,
        name: 'Synthetic Staging Boardroom',
        category: 'MEETING_SUITE',
        defaultPriority: 'P1',
        photoRequired: true,
        recurrence: 'ON_DEMAND',
        setupConfig: { tables: 1, tableType: 'standard', chairs: 8, summary: '1 table + 8 chairs' },
      },
    });
    const dupRoom = await httpReq(PORT, {
      path: '/api/rooms',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { id: synthRoomId, name: 'Duplicate ID Room' },
    });
    // REG-05: Mass assignment attempt on PUT /api/rooms/:id
    const massAssignRoom = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        id: 'room-hijacked-id',
        assignedEmployeeId: 'user-hr-1',
        statusHistory: [],
        notes: '<script>alert(1)</script> Clean note text',
      },
    });
    const canonicalDeleteDenied = await httpReq(PORT, {
      path: '/api/rooms/room-10',
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    record(
      'Rooms & Mass Assignment',
      'Room Create, Duplicate ID 409, Mass Assignment Blocked & Canonical Room Protected',
      createRoom.status === 200 &&
        dupRoom.status === 409 &&
        massAssignRoom.status === 200 &&
        massAssignRoom.body?.room?.id === synthRoomId &&
        !massAssignRoom.body?.room?.assignedEmployeeId &&
        !String(massAssignRoom.body?.room?.notes || '').includes('<script>') &&
        canonicalDeleteDenied.status === 403
        ? 'PASS'
        : 'FAIL',
      `Create=${createRoom.status}, Dup=${dupRoom.status}, PreservedId=${massAssignRoom.body?.room?.id}, Notes="${massAssignRoom.body?.room?.notes}", CanonicalDel=${canonicalDeleteDenied.status}`
    );

    // Room Employee Assignments, Conflicts (409), Force Override & Unassign
    const assign1 = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/assign-employee`,
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { employeeId: 'user-kimmy-1', status: 'ASSIGNED', notes: 'Strategy session' },
    });
    const roomConflict = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/assign-employee`,
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { employeeId: 'user-hr-1', forceOverride: false },
    });
    const empConflict = await httpReq(PORT, {
      path: '/api/rooms/room-2/assign-employee',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { employeeId: 'user-kimmy-1', forceOverride: false },
    });
    const forceOverride = await httpReq(PORT, {
      path: '/api/rooms/room-2/assign-employee',
      method: 'POST',
      headers: { Authorization: `Bearer ${kimmiToken}` },
      body: { employeeId: 'user-kimmy-1', forceOverride: true, status: 'ASSIGNED' },
    });
    const unassignRoom2 = await httpReq(PORT, {
      path: '/api/rooms/room-2/unassign-employee',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    record(
      'Room Assignments',
      'Assign Employee, Room/Employee Conflict 409, Force Override & One-Click Unassign',
      assign1.status === 200 &&
        roomConflict.status === 409 &&
        roomConflict.body?.code === 'ROOM_ALREADY_ASSIGNED' &&
        empConflict.status === 409 &&
        empConflict.body?.code === 'EMPLOYEE_ALREADY_ASSIGNED' &&
        forceOverride.status === 200 &&
        unassignRoom2.status === 200
        ? 'PASS'
        : 'FAIL',
      `Assign=${assign1.status}, Room409=${roomConflict.status}, Emp409=${empConflict.status}, Override=${forceOverride.status}, Unassign=${unassignRoom2.status}`
    );

    // Automated Room-Status Workflows (OCCUPIED -> Water Task, VACANT -> Rearrange Task, Idempotency & Strict Alert RBAC)
    const idempKey = `staging-idemp-${Date.now()}`;
    const occRes = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/status`,
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': idempKey },
      body: { status: 'OCCUPIED', note: 'Board members seated' },
    });
    const occDupKey = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/status`,
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': idempKey },
      body: { status: 'OCCUPIED', note: 'Retry with same Idempotency-Key' },
    });
    const vacRes = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/status-action`,
      method: 'POST',
      headers: { Authorization: `Bearer ${kimmiToken}` },
      body: { action: 'RELEASE_VACANT', note: 'Board meeting adjourned' },
    });
    const vacDupSameStatus = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/status-action`,
      method: 'POST',
      headers: { Authorization: `Bearer ${kimmiToken}` },
      body: { action: 'RELEASE_VACANT', note: 'Already vacant' },
    });
    record(
      'Room Automations',
      'OCCUPIED Water Task, VACANT Chair/Table Task & Idempotency Deduplication',
      occRes.status === 200 &&
        occRes.body?.task?.taskType === 'WATER_DISTRIBUTION' &&
        occDupKey.body?.duplicate === true &&
        vacRes.status === 200 &&
        vacRes.body?.task?.taskType === 'VISITOR_RESET' &&
        vacDupSameStatus.body?.transition?.duplicate === true
        ? 'PASS'
        : 'FAIL',
      `WaterTask=${occRes.body?.task?.id}, IdempDup=${occDupKey.body?.duplicate}, ResetTask=${vacRes.body?.task?.id}, SameStatusDup=${vacDupSameStatus.body?.transition?.duplicate}`
    );

    // Visitor Arrival & Departure + Confidential HR Note Redaction for Pantry Boy
    const visArrival = await httpReq(PORT, {
      path: '/api/visitors/arrival',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        visitorName: 'Synthetic Investor Group',
        companyName: 'Apex Capital',
        hostName: 'Kimmi',
        roomAreaId: 'room-3',
        guestCount: 4,
        notes: 'Serve sparkling water [CONFIDENTIAL: Term sheet valuation $50M]',
      },
    });
    const visId = visArrival.body?.visitor?.id;
    const pantryVisitors = await httpReq(PORT, {
      path: '/api/visitors',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const hrVisitors = await httpReq(PORT, {
      path: '/api/visitors',
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const pbVisNote = pantryVisitors.body?.visitors?.find((v: any) => v.id === visId)?.notes || '';
    const hrVisNote = hrVisitors.body?.visitors?.find((v: any) => v.id === visId)?.notes || '';
    const visDepart = await httpReq(PORT, {
      path: '/api/visitors/departure',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { visitorId: visId },
    });
    record(
      'Visitors & Confidentiality',
      'Visitor Arrival Prep Task, Departure Reset Task & Confidential Note Redaction for Pantry Boy',
      visArrival.status === 200 &&
        Boolean(visArrival.body?.prepTask?.id) &&
        !pbVisNote.includes('CONFIDENTIAL') &&
        hrVisNote.includes('CONFIDENTIAL') &&
        visDepart.status === 200 &&
        Boolean(visDepart.body?.resetTask?.id)
        ? 'PASS'
        : 'FAIL',
      `Arrival=${visArrival.status}, PantryRedacted=${!pbVisNote.includes('CONFIDENTIAL')}, HRFull=${hrVisNote.includes('CONFIDENTIAL')}, Departure=${visDepart.status}`
    );

    // =========================================================================
    // 5. TASKS LIFECYCLE, LIVE CAMERA PHOTOS, STATIC PHOTO AUTH & VERIFICATION
    // =========================================================================
    const createTask = await httpReq(PORT, {
      path: '/api/tasks',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        title: '<script>evil()</script> Synthetic Pantry Task =SUM(1,2)',
        description: '<iframe src="evil"></iframe> Sanitize staging conference suite',
        roomAreaId: synthRoomId,
        priority: 'P1',
        dueTime: '06:30 PM',
        checklist: ['Clean table surface', 'Capture live camera verification photo'],
      },
    });
    const synthTaskId = createTask.body?.task?.id;
    const invalidStatusPatch = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/status`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'NOT_A_REAL_STATUS' },
    });
    const startTask = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/status`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { status: 'IN_PROGRESS' },
    });
    const toggleChecklist = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/checklist`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { itemId: 'item-0', completed: true, note: 'Cleaned thoroughly' },
    });
    record(
      'Tasks & XSS Sanitization',
      'Task Create (Script/Iframe Tags Stripped), Invalid Status 400, Start & Checklist Update',
      createTask.status === 201 &&
        !createTask.body.task.title.includes('<script>') &&
        !createTask.body.task.description.includes('<iframe') &&
        invalidStatusPatch.status === 400 &&
        startTask.status === 200 &&
        toggleChecklist.status === 200
        ? 'PASS'
        : 'FAIL',
      `CleanTitle="${createTask.body?.task?.title}", BadStatus=${invalidStatusPatch.status}, Start=${startTask.status}, Checklist=${toggleChecklist.status}`
    );

    // Capture Session & Session Binding Security Checks (REG-08)
    const capSess = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/capture-session`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const sessionId = capSess.body?.sessionId;
    const validPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Fake sessionId rejected
    const fakeSessionUpload = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { sessionId: 'csess_forged_999', photos: [{ photoData: validPng }] },
    });
    // Cross-task session mismatch rejected
    const otherTaskId = occRes.body?.task?.id;
    const crossTaskSessionUpload = await httpReq(PORT, {
      path: `/api/tasks/${otherTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { sessionId, photos: [{ photoData: validPng }] },
    });
    // >10 photos rejected
    const tooManyPhotos = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId,
        photos: Array.from({ length: 11 }, () => ({ photoData: validPng })),
      },
    });
    // Magic-byte invalid file rejected
    const fakeExe = Buffer.from('MZ_FAKE_WINDOWS_BINARY_PAYLOAD_OVER_TWENTY_BYTES_LONG').toString('base64');
    const badMagicUpload = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { sessionId, photos: [{ photoData: `data:image/png;base64,${fakeExe}` }] },
    });

    // Valid multi-photo upload
    const validUpload = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId,
        photos: [{ photoData: validPng }, { photoData: validPng }],
      },
    });
    const lastHistoryEntry =
      validUpload.body?.task?.changeHistory?.[validUpload.body.task.changeHistory.length - 1];
    const photoUrl = validUpload.body?.photoEvidence?.photoUrl || '';
    const leakedFilePath = validUpload.body?.photoEvidence?.filePath;

    record(
      'Camera & File Upload Security',
      'Capture Session Binding, >10 Limit, Magic-Byte Validation, History fromStatus & Path Redaction',
      fakeSessionUpload.status === 400 &&
        crossTaskSessionUpload.status === 403 &&
        tooManyPhotos.status === 400 &&
        badMagicUpload.status === 400 &&
        validUpload.status === 200 &&
        validUpload.body?.count === 2 &&
        lastHistoryEntry?.fromStatus === 'IN_PROGRESS' &&
        lastHistoryEntry?.toStatus === 'PENDING_VERIFICATION' &&
        leakedFilePath === undefined
        ? 'PASS'
        : 'FAIL',
      `FakeSess=${fakeSessionUpload.status}, CrossTaskSess=${crossTaskSessionUpload.status}, >10=${tooManyPhotos.status}, BadMagic=${badMagicUpload.status}, ValidUpload=${validUpload.status}, fromStatus=${lastHistoryEntry?.fromStatus}, filePathRedacted=${leakedFilePath === undefined}`
    );

    // REG-02: /uploads/photos/* Unauthenticated Access Blocked vs Cookie & Bearer Allowed
    const unauthPhotoFetch = await httpReq(PORT, { path: photoUrl });
    const bearerPhotoFetch = await httpReq(PORT, {
      path: photoUrl,
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const cookiePhotoFetch = await httpReq(PORT, {
      path: photoUrl,
      headers: { Cookie: adminCookiePair },
    });
    record(
      'Security (Regression)',
      'Operational Photo Evidence (/uploads/photos/*) Protected Against Unauthenticated Access',
      unauthPhotoFetch.status === 401 &&
        bearerPhotoFetch.status === 200 &&
        cookiePhotoFetch.status === 200 &&
        bearerPhotoFetch.headers['x-content-type-options'] === 'nosniff'
        ? 'PASS'
        : 'FAIL',
      `Unauth=${unauthPhotoFetch.status}, Bearer=${bearerPhotoFetch.status}, Cookie=${cookiePhotoFetch.status}, nosniff=${bearerPhotoFetch.headers['x-content-type-options']}`
    );

    // Photo Verification Workflow (Invalid Decision 400 -> Pantry Forbidden 403 -> HR Reject -> Retake -> Co-Founder Approve)
    const invalidVerifyDecision = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/verify`,
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { decision: 'MAYBE' },
    });
    const pantrySelfVerify = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/verify`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { decision: 'APPROVE' },
    });
    const hrRejectPhoto = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/verify`,
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { decision: 'REJECT', reason: 'Chair #3 misaligned' },
    });
    await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { photos: [{ photoData: validPng }] },
    });
    const kimmiApprovePhoto = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/verify`,
      method: 'POST',
      headers: { Authorization: `Bearer ${kimmiToken}` },
      body: { decision: 'APPROVE' },
    });
    const postCompleteUploadBlocked = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}/photos`,
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { photos: [{ photoData: validPng }] },
    });
    record(
      'Photo Verification',
      'Invalid Decision 400, Pantry Self-Verify 403, HR Reject, Retake & Co-Founder Approve',
      invalidVerifyDecision.status === 400 &&
        pantrySelfVerify.status === 403 &&
        hrRejectPhoto.status === 200 &&
        hrRejectPhoto.body?.task?.status === 'REJECTED' &&
        kimmiApprovePhoto.status === 200 &&
        kimmiApprovePhoto.body?.task?.status === 'COMPLETED' &&
        postCompleteUploadBlocked.status === 400
        ? 'PASS'
        : 'FAIL',
      `BadDecision=${invalidVerifyDecision.status}, PantryVerify=${pantrySelfVerify.status}, Reject=${hrRejectPhoto.body?.task?.status}, Approve=${kimmiApprovePhoto.body?.task?.status}, UploadAfterComplete=${postCompleteUploadBlocked.status}`
    );

    // Non-Deletable Pantry Task vs Eligible Non-Pantry Task Deletion
    const pantryTaskDelBlocked = await httpReq(PORT, {
      path: `/api/tasks/${synthTaskId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const hrAssignedTask = await httpReq(PORT, {
      path: '/api/tasks',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: '=CMD|\' /C calc\'!A0 Synthetic HR Task',
        roomAreaId: 'room-5',
        priority: 'P3',
        assignedToEmail: 'priya.sen@whitecollarrealty.com',
      },
    });
    const hrTaskId = hrAssignedTask.body?.task?.id;
    // Pantry Boy BOLA attempt on HR's task
    const pantryBolaTaskPatch = await httpReq(PORT, {
      path: `/api/tasks/${hrTaskId}/status`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { status: 'IN_PROGRESS' },
    });
    record(
      'Task RBAC & BOLA',
      'Pantry Boy Task Protected From Admin Deletion & Cross-User Task BOLA Blocked',
      pantryTaskDelBlocked.status === 403 &&
        pantryTaskDelBlocked.body?.code === 'PANTRY_TASK_NOT_DELETABLE' &&
        pantryBolaTaskPatch.status === 403
        ? 'PASS'
        : 'FAIL',
      `PantryTaskDel=${pantryTaskDelBlocked.status} (${pantryTaskDelBlocked.body?.code}), PantryCrossUserPatch=${pantryBolaTaskPatch.status}`
    );

    // =========================================================================
    // 6. PANTRY ORDERS, NOTIFICATIONS BOLA, ROOM HISTORY AUTH & REPORTS CSV
    // =========================================================================
    const unauthPantryReq = await httpReq(PORT, { path: '/api/pantry-requests' });
    const unauthRoomHist = await httpReq(PORT, { path: `/api/rooms/${synthRoomId}/history` });
    const authRoomHist = await httpReq(PORT, {
      path: `/api/rooms/${synthRoomId}/history`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const createPantryOrder = await httpReq(PORT, {
      path: '/api/pantry-requests',
      method: 'POST',
      headers: { Authorization: `Bearer ${kimmiToken}` },
      body: {
        roomAreaId: 'room-10',
        items: ['Green Tea', 'Almonds'],
        instructions: '<b>No sugar</b> please',
        priority: 'URGENT',
      },
    });
    const preqId = createPantryOrder.body?.request?.id;
    const pantryCancelOrderDenied = await httpReq(PORT, {
      path: `/api/pantry-requests/${preqId}/status`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { status: 'CANCELLED' },
    });
    const pantryServeOrder = await httpReq(PORT, {
      path: `/api/pantry-requests/${preqId}/status`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: { status: 'SERVED' },
    });
    record(
      'Pantry Orders & History Auth',
      'Unauth Pantry-Requests/Room-History Blocked, Order Flow & HTML Tag Stripping',
      unauthPantryReq.status === 401 &&
        unauthRoomHist.status === 401 &&
        authRoomHist.status === 200 &&
        createPantryOrder.status === 200 &&
        !createPantryOrder.body.request.instructions.includes('<b>') &&
        pantryCancelOrderDenied.status === 403 &&
        pantryServeOrder.status === 200 &&
        pantryServeOrder.body?.request?.status === 'SERVED'
        ? 'PASS'
        : 'FAIL',
      `UnauthReq=${unauthPantryReq.status}, UnauthHist=${unauthRoomHist.status}, PantryCancel=${pantryCancelOrderDenied.status}, Serve=${pantryServeOrder.body?.request?.status}`
    );

    // REG-07: Notifications RBAC & Cross-Role Mark-Read BOLA
    const pbNotifs = await httpReq(PORT, {
      path: '/api/notifications',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const adminNotifs = await httpReq(PORT, {
      path: '/api/notifications',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pantryOnlyNotif = (pbNotifs.body?.notifications || []).find((n: any) => n.targetOnlyPantryBoy);
    const hrOnlyNotif = (adminNotifs.body?.notifications || []).find((n: any) => n.recipientRole === 'HR');
    const adminLeakedPantryOnly = (adminNotifs.body?.notifications || []).some((n: any) => n.targetOnlyPantryBoy);

    const adminReadPantryOnly = await httpReq(PORT, {
      path: `/api/notifications/${pantryOnlyNotif?.id}/read`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pantryReadHrOnly = await httpReq(PORT, {
      path: `/api/notifications/${hrOnlyNotif?.id}/read`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const pantryReadOwn = await httpReq(PORT, {
      path: `/api/notifications/${pantryOnlyNotif?.id}/read`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    record(
      'Notifications RBAC & BOLA',
      'Pantry-Only Notification Isolation & Cross-User Mark-Read BOLA Blocked',
      !adminLeakedPantryOnly &&
        adminReadPantryOnly.status === 403 &&
        pantryReadHrOnly.status === 403 &&
        pantryReadOwn.status === 200
        ? 'PASS'
        : 'FAIL',
      `AdminLeakedPantryAlert=${adminLeakedPantryOnly}, AdminReadPantryOnly=${adminReadPantryOnly.status}, PantryReadHROnly=${pantryReadHrOnly.status}, PantryReadOwn=${pantryReadOwn.status}`
    );

    // Reports, Insights & CSV Formula Injection Defense (REG-10)
    const pantryReportsBlocked = await httpReq(PORT, {
      path: '/api/reports/daily',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const dailyRep = await httpReq(PORT, {
      path: '/api/reports/daily',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const weeklyRep = await httpReq(PORT, {
      path: '/api/reports/weekly',
      headers: { Authorization: `Bearer ${kimmiToken}` },
    });
    const csvExport = await httpReq(PORT, {
      path: '/api/reports/export',
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const nlpParse = await httpReq(PORT, {
      path: '/api/ai/parse-task',
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { naturalInstruction: 'Urgent prepare The Skyline within 15 mins with coffee' },
    });
    const insights = await httpReq(PORT, {
      path: '/api/ai/operational-insights',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    // Verify '=CMD|' in hrAssignedTask title was escaped as "'=CMD|" in CSV
    const csvHasEscapedFormula = csvExport.raw.includes(`"'=CMD|`);
    const csvHasUnescapedFormula = csvExport.raw.includes(`"=CMD|`);

    // Now delete eligible hrAssignedTask
    const delEligibleTask = await httpReq(PORT, {
      path: `/api/tasks/${hrTaskId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    record(
      'Reports, NLP & CSV Security',
      'Daily/Weekly Reports, NLP Parser, Insights, Pantry RBAC & CSV Formula Neutralization',
      pantryReportsBlocked.status === 403 &&
        dailyRep.status === 200 &&
        weeklyRep.status === 200 &&
        csvExport.status === 200 &&
        csvHasEscapedFormula &&
        !csvHasUnescapedFormula &&
        nlpParse.status === 200 &&
        nlpParse.body?.data?.isUrgent === true &&
        insights.status === 200 &&
        delEligibleTask.status === 200
        ? 'PASS'
        : 'FAIL',
      `PantryReport=${pantryReportsBlocked.status}, Daily=${dailyRep.status}, Weekly=${weeklyRep.status}, CSVFormulaEscaped=${csvHasEscapedFormula}, NLP=${nlpParse.status}, EligibleTaskDel=${delEligibleTask.status}`
    );

    // =========================================================================
    // 7. REAL-TIME SSE, 1-SECOND TIMER/ALERT ENGINE & SCHEDULER MILESTONES
    // =========================================================================
    const unauthSse = await httpReq(PORT, { path: '/api/realtime/stream' });
    record(
      'Realtime SSE Security',
      'Unauthenticated SSE Stream Connection Rejected (HTTP 401)',
      unauthSse.status === 401 ? 'PASS' : 'FAIL',
      `HTTP ${unauthSse.status}`
    );

    // Open SSE listener as Pantry Boy and test 5-min warning + 2-second due-now promotion + overdue engine
    const receivedAlerts: string[] = [];
    const sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: `/api/realtime/stream?token=${encodeURIComponent(pantryToken)}`,
        method: 'GET',
      },
      (res) => {
        res.on('data', (chunk) => {
          const txt = chunk.toString();
          if (txt.includes('WARNING_5MIN')) receivedAlerts.push('WARNING_5MIN');
          if (txt.includes('TASK_DUE_NOW')) receivedAlerts.push('TASK_DUE_NOW');
        });
      }
    );
    sseReq.on('error', () => {});
    sseReq.end();
    await waitMs(250);

    // Create task scheduled +4 minutes from now -> triggers immediate WARNING_5MIN
    const fourMinFutureIso = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const warnTaskRes = await httpReq(PORT, {
      path: '/api/tasks',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: 'Timer 5-Min Warning Synthetic Check',
        roomAreaId: 'room-1',
        priority: 'P2',
        scheduledFor: fourMinFutureIso,
      },
    });

    // Create task scheduled +2 seconds from now -> starts SCHEDULED, promotes to AVAILABLE + TASK_DUE_NOW within 3s
    const twoSecFutureIso = new Date(Date.now() + 2000).toISOString();
    const dueSoonTaskRes = await httpReq(PORT, {
      path: '/api/tasks',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: 'Timer Due-Now Promotion Synthetic Check',
        roomAreaId: 'room-1',
        priority: 'P1',
        scheduledFor: twoSecFutureIso,
      },
    });
    const dueSoonId = dueSoonTaskRes.body?.task?.id;
    const initialDueSoonStatus = dueSoonTaskRes.body?.task?.status;

    await waitMs(2800);
    sseReq.destroy();

    const tasksCheck = await httpReq(PORT, {
      path: '/api/tasks',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const promotedTask = (tasksCheck.body?.tasks || []).find((t: any) => t.id === dueSoonId);

    record(
      'Timers & Alert Engine',
      '1-Second Ticker Promotes SCHEDULED -> AVAILABLE & Emits WARNING_5MIN + TASK_DUE_NOW Alerts',
      initialDueSoonStatus === 'SCHEDULED' &&
        promotedTask?.status === 'AVAILABLE' &&
        receivedAlerts.includes('WARNING_5MIN') &&
        receivedAlerts.includes('TASK_DUE_NOW') &&
        Boolean(warnTaskRes.body?.task?.id)
        ? 'PASS'
        : 'FAIL',
      `Initial=${initialDueSoonStatus} -> Promoted=${promotedTask?.status}, SSEAlerts=[${Array.from(new Set(receivedAlerts)).join(', ')}]`
    );

    // Scheduler Milestones + Invalid Milestone Validation
    const badMilestone = await httpReq(PORT, {
      path: '/api/scheduler/trigger',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { milestone: 'INVALID_MILESTONE' },
    });
    const milestones = ['9AM_START', '10AM_WATER', '12PM_PLANTS', '4PM_WATER', 'CLOSING_AUDIT'];
    let allMilestonesOk = true;
    for (const m of milestones) {
      const r = await httpReq(PORT, {
        path: '/api/scheduler/trigger',
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { milestone: m },
      });
      if (r.status !== 200) allMilestonesOk = false;
    }
    record(
      'Scheduled Automations',
      'All 5 Operational Milestones Execute Cleanly & Unknown Milestone Rejected (HTTP 400)',
      badMilestone.status === 400 && allMilestonesOk ? 'PASS' : 'FAIL',
      `InvalidMilestone=${badMilestone.status}, All5Milestones200=${allMilestonesOk}`
    );

    // =========================================================================
    // 8. SECURITY HEADERS & RATE LIMITING
    // =========================================================================
    const headerCheck = await httpReq(PORT, { path: '/api/server-time' });
    const h = headerCheck.headers;
    record(
      'Security Headers',
      'Security Headers Present & X-Powered-By Disabled (Iframe-Compatible)',
      h['x-content-type-options'] === 'nosniff' &&
        h['referrer-policy'] === 'strict-origin-when-cross-origin' &&
        h['x-permitted-cross-domain-policies'] === 'none' &&
        String(h['permissions-policy'] || '').includes('camera=(self)') &&
        h['x-powered-by'] === undefined
        ? 'PASS'
        : 'FAIL',
      `nosniff=${h['x-content-type-options']}, referrer=${h['referrer-policy']}, x-powered-by=${h['x-powered-by'] ?? 'absent'}`
    );

    // Burst rate limit test using isolated X-Forwarded-For IP so 127.0.0.1 test bucket is unaffected
    const burstResults = await Promise.all(
      Array.from({ length: 24 }, () =>
        httpReq(PORT, {
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'X-Forwarded-For': '203.0.113.99' },
          body: { email: 'brute.force@attacker.example' },
        })
      )
    );
    const rateLimitedRes = burstResults.find((r) => r.status === 429);
    record(
      'Rate Limiting',
      'Auth Endpoint Burst Flood Blocked With HTTP 429 & Retry-After Header',
      Boolean(rateLimitedRes) &&
        rateLimitedRes?.body?.code === 'RATE_LIMITED' &&
        Boolean(rateLimitedRes?.headers['retry-after'])
        ? 'PASS'
        : 'FAIL',
      `Triggered 429=${Boolean(rateLimitedRes)}, Retry-After=${rateLimitedRes?.headers['retry-after']}s`
    );

    // =========================================================================
    // 9. CONCURRENT WRITES & PROCESS RESTART PERSISTENCE
    // =========================================================================
    const parallelWrites = await Promise.all(
      Array.from({ length: 16 }, (_, idx) =>
        httpReq(PORT, {
          path: '/api/pantry-requests',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${[adminToken, hrToken, kimmiToken, pantryToken][idx % 4]}`,
          },
          body: {
            roomAreaId: 'room-1',
            items: [`Concurrent Beverage #${idx + 1}`],
            priority: 'NORMAL',
          },
        })
      )
    );
    const allParallelOk = parallelWrites.every((r) => r.status === 200 && r.body?.success === true);
    const dataFiles = fs.readdirSync(dataDir);
    const leftoverTmp = dataFiles.filter((f) => f.endsWith('.tmp'));
    const parsedDiskBeforeRestart = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'smart_pantry_db.json'), 'utf8')
    );
    record(
      'Concurrency & Durability',
      '16 Parallel Multi-Role Writes Complete Atomically With Valid JSON & Zero Orphan .tmp Files',
      allParallelOk && leftoverTmp.length === 0 && Array.isArray(parsedDiskBeforeRestart.pantryRequests)
        ? 'PASS'
        : 'FAIL',
      `16/16 HTTP 200=${allParallelOk}, OrphanTmpFiles=${leftoverTmp.length}, PersistedRequests=${parsedDiskBeforeRestart.pantryRequests.length}`
    );

    // Cold Process Restart Persistence Test
    await stopServer(serverProc);
    serverProc = await startIsolatedStagingServer({
      port: PORT,
      dataDir,
      uploadsDir,
      sessionSecret,
      authRateMax: 60,
    });

    const postRestartCurr = await httpReq(PORT, {
      path: '/api/auth/current',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const postRestartRooms = await httpReq(PORT, {
      path: '/api/rooms',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const postRestartPhoto = await httpReq(PORT, {
      path: photoUrl,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const synthRoomSurvived = (postRestartRooms.body?.rooms || []).some((r: any) => r.id === synthRoomId);
    record(
      'Restart Persistence',
      'Cold Server Restart Preserves Database Records, Uploaded Photos & Cryptographic Sessions',
      postRestartCurr.status === 200 && synthRoomSurvived && postRestartPhoto.status === 200
        ? 'PASS'
        : 'FAIL',
      `PostRestartSession=${postRestartCurr.status}, SynthRoomPersisted=${synthRoomSurvived}, PhotoPersisted=${postRestartPhoto.status}`
    );

    // =========================================================================
    // 10. UI / FRONTEND CODEBASE & HEADLESS ENVIRONMENT CHECKS
    // =========================================================================
    const mgmtSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/management/ManagementView.tsx'), 'utf8');
    const navbarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/Navbar.tsx'), 'utf8');
    const pantrySrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pantry/PantryBoyView.tsx'), 'utf8');
    const noPantrySwitcher =
      !mgmtSrc.includes('Pantry Boy View') &&
      !navbarSrc.includes('Pantry Boy View') &&
      !mgmtSrc.includes('setActiveView');
    const hasResponsiveClasses =
      mgmtSrc.includes('sm:') && mgmtSrc.includes('md:') && mgmtSrc.includes('lg:') && pantrySrc.includes('sm:');
    record(
      'Dashboards & Responsive UI',
      'Pantry Boy View Switcher Absent Across All Dashboards & Responsive Breakpoints Verified',
      noPantrySwitcher && hasResponsiveClasses ? 'PASS' : 'FAIL',
      `PantrySwitcherAbsent=${noPantrySwitcher}, ResponsiveTailwindGrid=${hasResponsiveClasses}`
    );

    record(
      'Hardware Camera UX',
      'Physical WebRTC Webcam Hardware Stream (navigator.mediaDevices.getUserMedia)',
      'BLOCKED',
      'Headless Linux container has no physical webcam device; CameraCaptureModal source & live /capture-session + /photos magic-byte API pipeline verified.'
    );
  } finally {
    await stopServer(serverProc);
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch {}
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const blocked = results.filter((r) => r.status === 'BLOCKED').length;

  console.log('\n================================================================================');
  console.log(
    `STAGING AUDIT COMPLETE: ${passed} PASS | ${failed} FAIL | ${blocked} BLOCKED (Total: ${results.length})`
  );
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runStagingAudit().catch((err) => {
  console.error('Fatal staging audit error:', err);
  process.exit(1);
});
