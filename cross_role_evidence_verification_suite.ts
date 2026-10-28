import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

const TEST_PORT = 3456;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeSyntheticJpegBuffer(seedLabel: string, extraBytes = 2048): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const body = Buffer.alloc(extraBytes);
  const hashSeed = crypto.createHash('sha256').update(seedLabel).digest();
  for (let i = 0; i < extraBytes; i++) {
    body[i] = hashSeed[i % hashSeed.length] ^ (i & 0x7f);
  }
  const footer = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, body, footer]);
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

interface AssertionResult {
  name: string;
  passed: boolean;
  details: string;
}

const assertions: AssertionResult[] = [];

function record(name: string, passed: boolean, details: string) {
  assertions.push({ name, passed, details });
  const tag = passed ? '[PASS]' : '[FAIL]';
  console.log(`${tag} ${name} — ${details}`);
}

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/server-time`);
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server failed to respond at ${url} within ${timeoutMs}ms`);
}

function spawnStagingServer(port: number, dataDir: string, uploadsDir: string): ChildProcess {
  const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  return spawn(tsxBin, ['server.ts', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      DISABLE_HMR: 'true',
      WCR_DATA_DIR: dataDir,
      WCR_UPLOADS_DIR: uploadsDir,
      SESSION_SECRET: 'test-staging-cross-role-evidence-secret-1234567890',
    },
    stdio: 'inherit',
  });
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGKILL');
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function login(url: string, email: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email} with status ${res.status}`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error(`No token received for ${email}`);
  }
  return data.token;
}

async function run() {
  console.log('=== CROSS-ROLE PHOTO EVIDENCE VERIFICATION SUITE ===');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcr_cross_role_ev_'));
  const dataDir = path.join(tmpRoot, 'data');
  const uploadsDir = path.join(tmpRoot, 'uploads', 'photos');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  let serverProc = spawnStagingServer(TEST_PORT, dataDir, uploadsDir);
  await waitForServer(BASE_URL);

  try {
    // 1. Role Authentication for All 4 Roles
    const adminToken = await login(BASE_URL, 'admin.director@whitecollarrealty.com');
    const hrToken = await login(BASE_URL, 'priya.sen@whitecollarrealty.com');
    const cofounderToken = await login(BASE_URL, 'kimmi.mam@whitecollarrealty.com');
    const pantryToken1 = await login(BASE_URL, 'raju.sharma@whitecollarrealty.com');

    // Create a second Pantry Boy account to test cross-pantry visibility
    const pantry2Email = `vikas.pantry.${Date.now()}@whitecollarrealty.com`;
    const createPantry2Res = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Vikas Sharma',
        email: pantry2Email,
        role: 'PANTRY_BOY',
        department: 'Hospitality & Operations',
      }),
    });
    if (!createPantry2Res.ok) {
      const errText = await createPantry2Res.text();
      throw new Error(`Failed to create second pantry boy: ${createPantry2Res.status} ${errText}`);
    }
    const pantryToken2 = await login(BASE_URL, pantry2Email);

    record(
      '1. All 4 Company Roles Authenticated (Admin, HR, Co-Founder, Pantry Boy 1, Pantry Boy 2)',
      Boolean(adminToken && hrToken && cofounderToken && pantryToken1 && pantryToken2),
      'Tokens acquired for all roles'
    );

    // 2. Fetch rooms and tasks
    const roomsRes = await fetch(`${BASE_URL}/api/rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const roomsJson = await roomsRes.json();
    const rooms = roomsJson.rooms || [];
    const testRoom = rooms[0];

    // Create a task assigned to Pantry Boy 1
    const createTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Morning Cleaning of Reception',
        roomAreaId: testRoom.id,
        priority: 'P1',
        assignedToEmail: 'raju.sharma@whitecollarrealty.com',
        description: 'Complete morning cleaning and capture verification photo',
      }),
    });
    const createTaskJson = await createTaskRes.json();
    const targetTask = createTaskJson.task || createTaskJson;

    // 3. Pantry Boy 1 Uploads Single Photo
    const singleBuf = makeSyntheticJpegBuffer('single-frame-cross-role', 2400);
    const singleHash = sha256Hex(singleBuf);

    const sessionRes = await fetch(`${BASE_URL}/api/tasks/${targetTask.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken1}` },
    });
    const sessionJson = await sessionRes.json();

    const uploadRes = await fetch(`${BASE_URL}/api/tasks/${targetTask.id}/photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pantryToken1}`,
      },
      body: JSON.stringify({
        sessionId: sessionJson.sessionId,
        photos: [
          {
            photoData: `data:image/jpeg;base64,${singleBuf.toString('base64')}`,
            capturedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    const uploadJson = await uploadRes.json();
    console.log('UPLOAD RESULT:', uploadRes.status, uploadJson);
    const uploadedPhotos = uploadJson.photoEvidences || [];
    const uploadedPhotoUrl = uploadedPhotos[0]?.photoUrl || '';
    const uploadedFileName = path.basename(uploadedPhotoUrl.split('?')[0]);

    record(
      '2. Pantry Boy 1 Uploads Single Photo Evidence',
      uploadRes.status === 200 && uploadedPhotos.length === 1 && Boolean(uploadedFileName),
      `fileName=${uploadedFileName}, taskStatus=${uploadJson.task?.status}`
    );

    // 4. Cross-Role Evidence Viewing: All 4 Roles View the Photo Uploaded by Pantry Boy 1
    const p2PhotoRes = await fetch(`${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`, {
      headers: { Authorization: `Bearer ${pantryToken2}` },
    });
    const p2PhotoBytes = Buffer.from(await p2PhotoRes.arrayBuffer());

    const hrPhotoRes = await fetch(`${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const hrPhotoBytes = Buffer.from(await hrPhotoRes.arrayBuffer());

    const cofounderPhotoRes = await fetch(
      `${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`,
      { headers: { Authorization: `Bearer ${cofounderToken}` } }
    );
    const cofounderPhotoBytes = Buffer.from(await cofounderPhotoRes.arrayBuffer());

    const adminPhotoRes = await fetch(`${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminPhotoBytes = Buffer.from(await adminPhotoRes.arrayBuffer());

    // Protected /uploads route also works for authenticated users
    const p2UploadsRes = await fetch(
      `${BASE_URL}/uploads/photos/${encodeURIComponent(uploadedFileName)}`,
      { headers: { Authorization: `Bearer ${pantryToken2}` } }
    );

    // Unauthenticated request is strictly blocked (401)
    const unauthPhotoRes = await fetch(
      `${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`
    );
    const unauthUploadsRes = await fetch(
      `${BASE_URL}/uploads/photos/${encodeURIComponent(uploadedFileName)}`
    );

    record(
      '3. Cross-Role Viewing of Single Photo: All Roles Return 200 with Exact Binary SHA-256; Unauthenticated Returns 401',
      p2PhotoRes.status === 200 &&
        sha256Hex(p2PhotoBytes) === singleHash &&
        hrPhotoRes.status === 200 &&
        sha256Hex(hrPhotoBytes) === singleHash &&
        cofounderPhotoRes.status === 200 &&
        sha256Hex(cofounderPhotoBytes) === singleHash &&
        adminPhotoRes.status === 200 &&
        sha256Hex(adminPhotoBytes) === singleHash &&
        p2UploadsRes.status === 200 &&
        unauthPhotoRes.status === 401 &&
        unauthUploadsRes.status === 401,
      `P2=${p2PhotoRes.status}, HR=${hrPhotoRes.status}, CoFounder=${cofounderPhotoRes.status}, Admin=${adminPhotoRes.status}, Unauth=${unauthPhotoRes.status}`
    );

    // 5. Multi-Photo Batch Submission (3 photos) on another task
    const createMultiTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Meeting Suite Setup Verification',
        roomAreaId: rooms[1]?.id || testRoom.id,
        priority: 'P2',
        assignedToEmail: 'raju.sharma@whitecollarrealty.com',
      }),
    });
    const multiTaskJson = await createMultiTaskRes.json();
    const multiTask = multiTaskJson.task || multiTaskJson;

    const multiBufs = [
      makeSyntheticJpegBuffer('multi-1', 2000),
      makeSyntheticJpegBuffer('multi-2', 2200),
      makeSyntheticJpegBuffer('multi-3', 2400),
    ];
    const multiHashes = multiBufs.map(sha256Hex);

    const sessionRes2 = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken1}` },
    });
    const sessionJson2 = await sessionRes2.json();

    const multiUploadRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pantryToken1}`,
      },
      body: JSON.stringify({
        photos: multiBufs.map((buf, idx) => ({
          photoData: `data:image/jpeg;base64,${buf.toString('base64')}`,
          capturedAt: new Date(Date.now() + idx * 500).toISOString(),
        })),
        sessionId: sessionJson2.sessionId,
      }),
    });
    const multiUploadJson = await multiUploadRes.json();
    const multiPhotos = multiUploadJson.photoEvidences || [];
    const multiFileNames = multiPhotos.map((p: any) => path.basename((p.photoUrl || '').split('?')[0]));

    record(
      '4. Multi-Photo Batch (3 Photos) Successfully Uploaded and Stored',
      multiUploadRes.status === 200 && multiPhotos.length === 3,
      `count=${multiPhotos.length}, files=${multiFileNames.join(', ')}`
    );

    // 6. Cross-Role Viewing of Multi-Photo Batch
    // Pantry Boy 2 views all 3 photos
    const p2MultiResults = await Promise.all(
      multiFileNames.map((fn: string) =>
        fetch(`${BASE_URL}/api/photos/${encodeURIComponent(fn)}`, {
          headers: { Authorization: `Bearer ${pantryToken2}` },
        })
      )
    );
    const p2All200 = p2MultiResults.every((r) => r.status === 200);

    // Co-Founder views all 3 photos
    const cofounderMultiResults = await Promise.all(
      multiFileNames.map((fn: string) =>
        fetch(`${BASE_URL}/api/photos/${encodeURIComponent(fn)}`, {
          headers: { Authorization: `Bearer ${cofounderToken}` },
        })
      )
    );
    const cofounderAll200 = cofounderMultiResults.every((r) => r.status === 200);

    record(
      '5. Multi-Photo Batch Viewable by Different Staff Members (Pantry Boy 2 & Co-Founder)',
      p2All200 && cofounderAll200,
      `p2Statuses=${p2MultiResults.map((r) => r.status).join(',')}, cofounderStatuses=${cofounderMultiResults.map((r) => r.status).join(',')}`
    );

    // 7. /api/tasks/:id/evidence Access Across All Roles
    const p2TaskEvRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${pantryToken2}` },
    });
    const p2TaskEvJson = await p2TaskEvRes.json();

    const hrTaskEvRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const hrTaskEvJson = await hrTaskEvRes.json();

    const unauthTaskEvRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/evidence`);

    record(
      '6. Task Evidence Metadata Endpoint Accessible by All Staff (200), Blocked for Unauthenticated (401)',
      p2TaskEvRes.status === 200 &&
        p2TaskEvJson.photoCount === 3 &&
        hrTaskEvRes.status === 200 &&
        hrTaskEvJson.photoCount === 3 &&
        unauthTaskEvRes.status === 401,
      `P2Count=${p2TaskEvJson.photoCount}, HRCount=${hrTaskEvJson.photoCount}, UnauthStatus=${unauthTaskEvRes.status}`
    );

    // 8. /api/rooms/:id/history Access Across All Roles
    const roomId = multiTask.roomAreaId;
    const p2RoomHistRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/history`, {
      headers: { Authorization: `Bearer ${pantryToken2}` },
    });
    const p2RoomHistJson = await p2RoomHistRes.json();

    const adminRoomHistRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminRoomHistJson = await adminRoomHistRes.json();

    const unauthRoomHistRes = await fetch(`${BASE_URL}/api/rooms/${roomId}/history`);

    record(
      '7. Room History Photo Evidence Accessible by All Staff (200 with Photos), Blocked for Unauthenticated (401)',
      p2RoomHistRes.status === 200 &&
        Array.isArray(p2RoomHistJson.photos) &&
        p2RoomHistJson.photos.length >= 3 &&
        adminRoomHistRes.status === 200 &&
        unauthRoomHistRes.status === 401,
      `P2RoomPhotos=${p2RoomHistJson.photos?.length}, AdminRoomPhotos=${adminRoomHistJson.photos?.length}, UnauthStatus=${unauthRoomHistRes.status}`
    );

    // 9. /api/rooms/evidence Endpoint Accessible Across Roles
    const p2RoomsEvRes = await fetch(`${BASE_URL}/api/rooms/evidence`, {
      headers: { Authorization: `Bearer ${pantryToken2}` },
    });
    const p2RoomsEvJson = await p2RoomsEvRes.json();

    const unauthRoomsEvRes = await fetch(`${BASE_URL}/api/rooms/evidence`);

    record(
      '8. Global Room Evidence Endpoint Returns Grouped Evidence for All Roles (200), Blocked for Unauthenticated (401)',
      p2RoomsEvRes.status === 200 &&
        Boolean(p2RoomsEvJson.roomEvidence?.[roomId]?.length >= 3) &&
        unauthRoomsEvRes.status === 401,
      `RoomId=${roomId}, PhotosInRoom=${p2RoomsEvJson.roomEvidence?.[roomId]?.length}, UnauthStatus=${unauthRoomsEvRes.status}`
    );

    // 10. Missing-File Returns Structured 404 JSON
    const missingName = 'non_existent_photo_1793199999999.png';
    const missingRes = await fetch(`${BASE_URL}/api/photos/${encodeURIComponent(missingName)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const missingJson = await missingRes.json().catch(() => ({}));

    record(
      '9. Missing-File Returns Structured 404 JSON (EVIDENCE_FILE_MISSING)',
      missingRes.status === 404 && missingJson.code === 'EVIDENCE_FILE_MISSING',
      `status=${missingRes.status}, code=${missingJson.code}`
    );

    // 11. Cold Server Restart Persistence (Evidence Remains Viewable by All Roles)
    await stopServer(serverProc);
    serverProc = spawnStagingServer(TEST_PORT, dataDir, uploadsDir);
    await waitForServer(BASE_URL);

    const postRestartPantry2Token = await login(BASE_URL, pantry2Email);
    const postRestartHRToken = await login(BASE_URL, 'priya.sen@whitecollarrealty.com');

    const postRestartImgRes = await fetch(
      `${BASE_URL}/api/photos/${encodeURIComponent(uploadedFileName)}`,
      { headers: { Authorization: `Bearer ${postRestartPantry2Token}` } }
    );
    const postRestartImgBytes = Buffer.from(await postRestartImgRes.arrayBuffer());

    const postRestartEvRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${postRestartHRToken}` },
    });
    const postRestartEvJson = await postRestartEvRes.json();

    record(
      '10. Cold Server Restart Retains All Photo Evidence Files & Cross-Role Access',
      postRestartImgRes.status === 200 &&
        sha256Hex(postRestartImgBytes) === singleHash &&
        postRestartEvRes.status === 200 &&
        postRestartEvJson.photoCount === 3,
      `postRestartImgStatus=${postRestartImgRes.status}, sha256Match=${sha256Hex(postRestartImgBytes) === singleHash}, postRestartEvCount=${postRestartEvJson.photoCount}`
    );

    // 12. Security: Broadened Photo Access Does NOT Grant Extra Administrative Rights
    // Pantry Boy attempts to delete a task -> strictly forbidden (403)
    const deleteAttemptRes = await fetch(`${BASE_URL}/api/tasks/${multiTask.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${postRestartPantry2Token}` },
    });

    // Pantry Boy attempts to create user -> strictly forbidden (403)
    const createUserAttemptRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${postRestartPantry2Token}`,
      },
      body: JSON.stringify({ name: 'Hacker', email: 'hacker@test.com', role: 'ADMIN' }),
    });

    record(
      '11. Role Isolation Preserved (Pantry Boy Blocked 403 on Delete Task & Create User)',
      deleteAttemptRes.status === 403 && createUserAttemptRes.status === 403,
      `deleteTask=${deleteAttemptRes.status}, createUser=${createUserAttemptRes.status}`
    );
  } finally {
    await stopServer(serverProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const failed = assertions.filter((a) => !a.passed);
  console.log(`\n=== SUMMARY: ${assertions.length - failed.length}/${assertions.length} PASSED ===`);
  if (failed.length > 0) {
    console.error('Failed assertions:', failed);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error in cross_role_evidence_verification_suite:', err);
  process.exit(1);
});
