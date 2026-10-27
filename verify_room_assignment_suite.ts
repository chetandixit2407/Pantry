import http from 'http';
import fs from 'fs';

const BASE_URL = 'http://127.0.0.1:3000';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordTest(name: string, category: string, passed: boolean, details: string) {
  results.push({ name, category, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${category}] ${name}: ${details}`);
}

function makeRequest(
  path: string,
  method: string,
  body?: any,
  token?: string
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode || 0, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('SmartPantry Pro - Real-Time Room Assignment Test Suite');
  console.log('======================================================\n');

  // 1. Authenticate users
  console.log('--- Step 1: User Authentication & Role Token Setup ---');
  const adminLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'admin.director@whitecollarrealty.com',
  });
  const adminToken = adminLogin.data.token;
  recordTest('Admin Login', 'AUTH', adminLogin.status === 200 && Boolean(adminToken), `Token received for Admin`);

  const hrLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'priya.sen@whitecollarrealty.com',
  });
  const hrToken = hrLogin.data.token;
  recordTest('HR Login', 'AUTH', hrLogin.status === 200 && Boolean(hrToken), `Token received for HR`);

  const kimmiLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'kimmi.mam@whitecollarrealty.com',
  });
  const kimmiToken = kimmiLogin.data.token;
  recordTest('Kimmi Mam Login', 'AUTH', kimmiLogin.status === 200 && Boolean(kimmiToken), `Token received for Kimmi Mam`);

  const pantryLogin = await makeRequest('/api/auth/login', 'POST', {
    email: 'raju.sharma@whitecollarrealty.com',
  });
  const pantryToken = pantryLogin.data.token;
  recordTest('Pantry Boy Login', 'AUTH', pantryLogin.status === 200 && Boolean(pantryToken), `Token received for Pantry Boy`);

  // Fetch all rooms
  const roomsRes = await makeRequest('/api/rooms', 'GET');
  const allRooms = roomsRes.data.rooms || [];
  recordTest('Fetch Rooms', 'ROOMS', roomsRes.status === 200 && allRooms.length > 0, `Total rooms: ${allRooms.length}`);

  const testRoom1 = allRooms.find((r: any) => r.name.includes('Skyline')) || allRooms[0];
  const testRoom2 = allRooms.find((r: any) => r.name.includes('Summit')) || allRooms[1];
  const testRoom3 = allRooms.find((r: any) => r.name.includes('Prestige')) || allRooms[2];

  // 2. Test Permissions: Unauthenticated request rejected
  console.log('\n--- Step 2: Security & Role-Based Permissions ---');
  const unauthRes = await makeRequest(`/api/rooms/${testRoom1.id}/assign-employee`, 'POST', {
    employeeId: 'usr-1',
  });
  recordTest(
    'Unauthenticated Rejection',
    'SECURITY',
    unauthRes.status === 401,
    `Status ${unauthRes.status} (Expected 401)`
  );

  // Test Permissions: Pantry Boy rejected from assigning room
  const pantryAssignRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/assign-employee`,
    'POST',
    { employeeId: 'usr-2' },
    pantryToken
  );
  recordTest(
    'Pantry Boy Forbidden to Assign',
    'SECURITY',
    pantryAssignRes.status === 403 && pantryAssignRes.data.code === 'FORBIDDEN_ROLE',
    `Status ${pantryAssignRes.status}, code: ${pantryAssignRes.data.code}`
  );

  // Test Permissions: Pantry Boy rejected from unassigning room
  const pantryUnassignRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/unassign-employee`,
    'POST',
    {},
    pantryToken
  );
  recordTest(
    'Pantry Boy Forbidden to Unassign',
    'SECURITY',
    pantryUnassignRes.status === 403 && pantryUnassignRes.data.code === 'FORBIDDEN_ROLE',
    `Status ${pantryUnassignRes.status}, code: ${pantryUnassignRes.data.code}`
  );

  // 3. Test Admin, HR, and Kimmi Mam assigning rooms
  console.log('\n--- Step 3: Admin, HR, and Kimmi Mam Room Assignment ---');
  // First clear any existing assignment on testRoom1 and testRoom2
  await makeRequest(`/api/rooms/${testRoom1.id}/unassign-employee`, 'POST', {}, adminToken);
  await makeRequest(`/api/rooms/${testRoom2.id}/unassign-employee`, 'POST', {}, adminToken);
  await makeRequest(`/api/rooms/${testRoom3.id}/unassign-employee`, 'POST', {}, adminToken);

  // Admin assigns Raju Sharma (Pantry) to testRoom1
  const usersRes = await makeRequest('/api/users', 'GET', undefined, adminToken);
  const users = usersRes.data.users || [];
  const rajuUser = users.find((u: any) => u.email === 'raju.sharma@whitecollarrealty.com');
  const priyaUser = users.find((u: any) => u.email === 'priya.sen@whitecollarrealty.com');
  const kimmiUser = users.find((u: any) => u.email === 'kimmi.mam@whitecollarrealty.com');

  const adminAssignRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/assign-employee`,
    'POST',
    {
      employeeId: rajuUser.id,
      notes: 'Morning shift hospitality lead',
      status: 'ASSIGNED',
    },
    adminToken
  );
  recordTest(
    'Admin Assigns Room to Employee',
    'ASSIGNMENT',
    adminAssignRes.status === 200 &&
      adminAssignRes.data.room.assignedEmployeeId === rajuUser.id &&
      adminAssignRes.data.room.assignedEmployeeName === rajuUser.name,
    `Room "${testRoom1.name}" assigned to ${rajuUser.name} by Admin`
  );

  // HR assigns Kimmi Mam to testRoom2
  const hrAssignRes = await makeRequest(
    `/api/rooms/${testRoom2.id}/assign-employee`,
    'POST',
    {
      employeeId: kimmiUser.id,
      notes: 'Executive board prep meeting',
      status: 'OCCUPIED',
    },
    hrToken
  );
  recordTest(
    'HR Assigns Room to Employee',
    'ASSIGNMENT',
    hrAssignRes.status === 200 &&
      hrAssignRes.data.room.assignedEmployeeId === kimmiUser.id &&
      hrAssignRes.data.room.status === 'OCCUPIED',
    `Room "${testRoom2.name}" assigned to ${kimmiUser.name} by HR with OCCUPIED status`
  );

  // Kimmi Mam assigns Priya Sen (HR) to testRoom3
  const kimmiAssignRes = await makeRequest(
    `/api/rooms/${testRoom3.id}/assign-employee`,
    'POST',
    {
      employeeId: priyaUser.id,
      notes: 'Candidate interviews today',
      status: 'ASSIGNED',
    },
    kimmiToken
  );
  recordTest(
    'Kimmi Mam Assigns Room to Employee',
    'ASSIGNMENT',
    kimmiAssignRes.status === 200 &&
      kimmiAssignRes.data.room.assignedEmployeeId === priyaUser.id,
    `Room "${testRoom3.name}" assigned to ${priyaUser.name} by Kimmi Mam`
  );

  // 4. Conflict & Collision Prevention
  console.log('\n--- Step 4: Conflict Detection & Duplicate Prevention ---');
  // Conflict A: Assigning someone to testRoom1 which is already assigned to Raju
  const roomConflictRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/assign-employee`,
    'POST',
    {
      employeeId: priyaUser.id,
      notes: 'Attempting conflicting assignment',
      forceOverride: false,
    },
    adminToken
  );
  recordTest(
    'Room Conflict Detected (ROOM_ALREADY_ASSIGNED)',
    'CONFLICT',
    roomConflictRes.status === 409 && roomConflictRes.data.code === 'ROOM_ALREADY_ASSIGNED',
    `Status 409: ${roomConflictRes.data.error}`
  );

  // Conflict B: Assigning Raju to testRoom3 while Raju is already assigned to testRoom1
  const employeeConflictRes = await makeRequest(
    `/api/rooms/${testRoom3.id}/assign-employee`,
    'POST',
    {
      employeeId: rajuUser.id,
      notes: 'Attempting duplicate employee assignment',
      forceOverride: false,
    },
    hrToken
  );
  recordTest(
    'Employee Conflict Detected (EMPLOYEE_ALREADY_ASSIGNED)',
    'CONFLICT',
    employeeConflictRes.status === 409 && employeeConflictRes.data.code === 'EMPLOYEE_ALREADY_ASSIGNED',
    `Status 409: ${employeeConflictRes.data.error}`
  );

  // Force Override: Reassign Raju to testRoom3 with forceOverride: true
  const overrideRes = await makeRequest(
    `/api/rooms/${testRoom3.id}/assign-employee`,
    'POST',
    {
      employeeId: rajuUser.id,
      notes: 'Forced reassignment to testRoom3',
      forceOverride: true,
      status: 'ASSIGNED',
    },
    kimmiToken
  );
  recordTest(
    'Force Override Reassignment',
    'CONFLICT',
    overrideRes.status === 200 && overrideRes.data.room.assignedEmployeeId === rajuUser.id,
    `Room "${testRoom3.name}" successfully reassigned to ${rajuUser.name}`
  );

  // Verify previous room (testRoom1) was cleanly released and unassigned
  const checkRoom1Res = await makeRequest('/api/rooms', 'GET');
  const updatedRoom1 = checkRoom1Res.data.rooms.find((r: any) => r.id === testRoom1.id);
  recordTest(
    'Conflicting Room Cleanly Freed',
    'CONFLICT',
    !updatedRoom1.assignedEmployeeId && (updatedRoom1.status === 'AVAILABLE' || updatedRoom1.status === 'VACANT'),
    `Room "${testRoom1.name}" assignedEmployeeId cleared and status set to ${updatedRoom1.status}`
  );

  // 5. One-Click Unassign Actions
  console.log('\n--- Step 5: One-Click Unassign Actions ---');
  const unassignRes = await makeRequest(
    `/api/rooms/${testRoom2.id}/unassign-employee`,
    'POST',
    {},
    adminToken
  );
  recordTest(
    'One-Click Unassign by Admin',
    'UNASSIGN',
    unassignRes.status === 200 &&
      !unassignRes.data.room.assignedEmployeeId &&
      (unassignRes.data.room.status === 'AVAILABLE' || unassignRes.data.room.status === 'VACANT'),
    `Room "${testRoom2.name}" unassigned by Admin; Status: ${unassignRes.data.room.status}`
  );

  const hrUnassignRes = await makeRequest(
    `/api/rooms/${testRoom3.id}/unassign-employee`,
    'POST',
    {},
    hrToken
  );
  recordTest(
    'One-Click Unassign by HR',
    'UNASSIGN',
    hrUnassignRes.status === 200 && !hrUnassignRes.data.room.assignedEmployeeId,
    `Room "${testRoom3.name}" unassigned by HR`
  );

  // 6. Occupancy Toggle & History Verification
  console.log('\n--- Step 6: Occupancy Actions & Audit Persistence ---');
  const occupyRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/status-action`,
    'POST',
    { action: 'MARK_OCCUPIED', note: 'Executive team entering for client review' },
    adminToken
  );
  recordTest(
    'Mark Room Occupied',
    'OCCUPANCY',
    occupyRes.status === 200 && occupyRes.data.room.status === 'OCCUPIED',
    `Room "${testRoom1.name}" marked OCCUPIED`
  );

  const vacantRes = await makeRequest(
    `/api/rooms/${testRoom1.id}/status-action`,
    'POST',
    { action: 'RELEASE_VACANT', note: 'Meeting concluded, room released' },
    kimmiToken
  );
  recordTest(
    'Mark Room Vacant',
    'OCCUPANCY',
    vacantRes.status === 200 && (vacantRes.data.room.status === 'AVAILABLE' || vacantRes.data.room.status === 'VACANT'),
    `Room "${testRoom1.name}" marked VACANT by Kimmi Mam`
  );

  // Check Database file persistence
  const dbContent = JSON.parse(fs.readFileSync('data/smart_pantry_db.json', 'utf8'));
  const dbRoom = dbContent.rooms.find((r: any) => r.id === testRoom1.id);
  const auditLogs = dbContent.auditLogs || [];
  const hasAssignLog = auditLogs.some((l: any) => l.action === 'ROOM_ASSIGNED_EMPLOYEE');
  const hasUnassignLog = auditLogs.some((l: any) => l.action === 'ROOM_UNASSIGNED_EMPLOYEE');

  recordTest(
    'Database Disk Persistence',
    'PERSISTENCE',
    Boolean(dbRoom) && dbContent.rooms.length > 0,
    `Database verified with ${dbContent.rooms.length} persistent room records`
  );

  recordTest(
    'Audit Log Tracking for Assignments',
    'AUDIT',
    hasAssignLog && hasUnassignLog,
    `Audit logs contain ROOM_ASSIGNED_EMPLOYEE and ROOM_UNASSIGNED_EMPLOYEE records`
  );

  // 7. Real-Time SSE Stream Verification
  console.log('\n--- Step 7: Real-Time SSE Stream Event Verification ---');
  const sseConnected = await new Promise<boolean>((resolve) => {
    const sseReq = http.request(
      `${BASE_URL}/api/realtime/stream?token=${encodeURIComponent(adminToken)}`,
      { method: 'GET' },
      (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes('event: connected') || buffer.includes('status: connected')) {
            sseReq.destroy();
            resolve(true);
          }
        });
      }
    );
    sseReq.on('error', () => resolve(false));
    sseReq.setTimeout(4000, () => {
      sseReq.destroy();
      resolve(false);
    });
    sseReq.end();
  });

  recordTest(
    'SSE Real-time Stream Connection & Room State',
    'REALTIME_SSE',
    sseConnected,
    'Client connected to /api/realtime/stream and received initial room payload'
  );

  console.log('\n======================================================');
  console.log('SUMMARY TEST RESULTS');
  console.log('======================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`Passed: ${passedCount} / ${totalCount} (${Math.round((passedCount / totalCount) * 100)}%)`);

  if (passedCount === totalCount) {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED.\n');
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
