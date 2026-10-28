import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

interface TestAssertion {
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: TestAssertion[] = [];

function record(name: string, passed: boolean, detail: string) {
  assertions.push({ name, passed, detail });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name} — ${detail}`);
}

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

async function waitForServer(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/server-time`);
      if (res.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Staging server at ${baseUrl} did not become ready within ${timeoutMs}ms`);
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
      SESSION_SECRET: 'staging_photo_evidence_preview_secret_2026',
    },
    stdio: 'ignore',
  });
}

async function stopServer(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3500);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function loginByEmail(baseUrl: string, email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.token as string;
}

async function createCaptureSessionAndUpload(
  baseUrl: string,
  token: string,
  taskId: string,
  buffers: Buffer[]
) {
  const sessRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/capture-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const sessBody = await sessRes.json();
  if (!sessRes.ok || !sessBody.sessionId) {
    throw new Error(`Failed to open capture session: ${sessRes.status} ${JSON.stringify(sessBody)}`);
  }

  const sessionId: string = sessBody.sessionId;
  const submissionId = `sub_${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const photosPayload = buffers.map((buf, idx) => ({
    photoData: `data:image/jpeg;base64,${buf.toString('base64')}`,
    capturedAt: new Date(Date.now() + idx * 500).toISOString(),
    metadata: {
      resolution: '1280x720',
      device: 'Automated Staging Camera',
      mode: 'LIVE_CAMERA',
      photoIndex: idx + 1,
      totalInBatch: buffers.length,
    },
  }));

  const submitRes = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/photos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': submissionId,
    },
    body: JSON.stringify({
      sessionId,
      submissionId,
      photos: photosPayload,
    }),
  });
  const submitBody = await submitRes.json().catch(() => ({}));
  return { status: submitRes.status, sessionId, body: submitBody };
}

async function run() {
  const port = 3198;
  const baseUrl = `http://127.0.0.1:${port}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcr-evidence-preview-'));
  const dataDir = path.join(tmpRoot, 'data');
  const uploadsDir = path.join(tmpRoot, 'uploads', 'photos');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const prodDbPath = path.join(process.cwd(), 'data', 'smart_pantry_db.json');
  if (fs.existsSync(prodDbPath)) {
    fs.copyFileSync(prodDbPath, path.join(dataDir, 'smart_pantry_db.json'));
  }

  let serverProc: ChildProcess | null = null;

  try {
    console.log('=== Starting Isolated Staging Server for Photo Evidence Preview Suite ===');
    serverProc = spawnStagingServer(port, dataDir, uploadsDir);
    await waitForServer(baseUrl);

    // 1. Authenticate Admin, HR, Co-Founder, and Pantry Boy
    const adminToken = await loginByEmail(baseUrl, 'admin.director@whitecollarrealty.com');
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const usersJson = await usersRes.json();
    const usersList = (usersJson.users || []) as Array<{ email: string; role: string; status: string }>;
    const hrEmail =
      usersList.find((u) => u.role === 'HR' && u.status === 'active')?.email ||
      'priya.sen@whitecollarrealty.com';
    const cofounderEmail =
      usersList.find((u) => u.role === 'KIMMY_MAM' && u.status === 'active')?.email || hrEmail;
    const pantryEmail =
      usersList.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active')?.email ||
      'raju.sharma@whitecollarrealty.com';

    const hrToken = await loginByEmail(baseUrl, hrEmail);
    const cofounderToken = await loginByEmail(baseUrl, cofounderEmail);
    let pantryToken = await loginByEmail(baseUrl, pantryEmail);

    record(
      '1. Role Authentication (Admin, HR, Co-Founder, Pantry Boy)',
      Boolean(adminToken && hrToken && cofounderToken && pantryToken),
      `Authenticated Admin, HR (${hrEmail}), Co-Founder (${cofounderEmail}), Pantry Boy (${pantryEmail})`
    );

    // Fetch rooms so tasks link to real persisted rooms
    const roomsRes = await fetch(`${baseUrl}/api/rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const roomsJson = await roomsRes.json();
    const rooms = (roomsJson.rooms || roomsJson || []) as Array<{ id: string; name: string }>;
    const roomA = rooms[0];
    const roomB = rooms[1] || rooms[0];

    const createTask = async (title: string, room: { id: string; name: string }) => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          title,
          description: `Evidence preview test: ${title}`,
          roomAreaId: room.id,
          roomAreaName: room.name,
          priority: 'P1',
          taskType: 'ROUTINE_CLEANING',
          assignedToEmail: pantryEmail,
          assignedToName: 'Raju Sharma',
          checklist: [
            { id: 'chk-1', text: 'Sanitize table surface', completed: true },
            { id: 'chk-2', text: 'Upload live verification photo', completed: false },
          ],
        }),
      });
      const json = await res.json();
      const created = json.task || json;
      if (!res.ok || !created?.id) {
        throw new Error(`Create task failed: ${res.status} ${JSON.stringify(json)}`);
      }
      return created;
    };

    const singleTask = await createTask('[EV-TEST] Single Photo Evidence Inspection', roomA);
    const multiTask = await createTask('[EV-TEST] Multi Photo Gallery Inspection', roomB);

    // 2. Single-photo submission & persisted binary retrieval
    const singleBuf = makeSyntheticJpegBuffer('single-evidence-frame-1', 3200);
    const singleHash = sha256Hex(singleBuf);

    const singleUpload = await createCaptureSessionAndUpload(
      baseUrl,
      pantryToken,
      singleTask.id,
      [singleBuf]
    );

    const singlePhotos = singleUpload.body?.photoEvidences || [];
    const singleUrl: string = singlePhotos[0]?.photoUrl || '';
    const singleFileName = path.basename(singleUrl);

    record(
      '2. Single-Photo Submission Persists Task, Room & Capture Session References',
      singleUpload.status === 200 &&
        singlePhotos.length === 1 &&
        singleUpload.body?.count === 1 &&
        singlePhotos[0]?.taskId === singleTask.id &&
        singlePhotos[0]?.roomId === roomA.id &&
        singlePhotos[0]?.metadata?.sessionId === singleUpload.sessionId &&
        Boolean(singlePhotos[0]?.taskTitle) &&
        Boolean(singlePhotos[0]?.userName) &&
        !singleUrl.startsWith('blob:') &&
        fs.existsSync(path.join(uploadsDir, singleFileName)),
      `status=${singleUpload.status}, photoUrl=${singleUrl}, taskId=${singlePhotos[0]?.taskId}, roomId=${singlePhotos[0]?.roomId}, session=${singleUpload.sessionId}`
    );

    // Fetch persisted single photo via /api/photos/:fileName and /uploads/photos/:fileName
    const singleApiImgRes = await fetch(`${baseUrl}/api/photos/${encodeURIComponent(singleFileName)}`, {
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const singleApiBytes = Buffer.from(await singleApiImgRes.arrayBuffer());

    const singleStaticImgRes = await fetch(
      `${baseUrl}/uploads/photos/${encodeURIComponent(singleFileName)}`,
      { headers: { Authorization: `Bearer ${pantryToken}` } }
    );
    const singleStaticBytes = Buffer.from(await singleStaticImgRes.arrayBuffer());

    record(
      '3. Single-Photo Binary Retrieval Matches Uploaded Bytes (No Blob URLs)',
      singleApiImgRes.status === 200 &&
        (singleApiImgRes.headers.get('content-type') || '').includes('image/jpeg') &&
        sha256Hex(singleApiBytes) === singleHash &&
        singleStaticImgRes.status === 200 &&
        sha256Hex(singleStaticBytes) === singleHash,
      `apiStatus=${singleApiImgRes.status}, contentType=${singleApiImgRes.headers.get('content-type')}, sha256Match=${sha256Hex(singleApiBytes) === singleHash}`
    );

    // 3. Multi-photo batch submission (3 photos) & full gallery metadata check
    const multiBufs = [
      makeSyntheticJpegBuffer('multi-frame-1', 2600),
      makeSyntheticJpegBuffer('multi-frame-2', 3100),
      makeSyntheticJpegBuffer('multi-frame-3', 3500),
    ];
    const multiHashes = multiBufs.map(sha256Hex);

    const multiUpload = await createCaptureSessionAndUpload(
      baseUrl,
      pantryToken,
      multiTask.id,
      multiBufs
    );

    const multiPhotos = multiUpload.body?.photoEvidences || [];
    const multiFileNames = multiPhotos.map((p: any) => path.basename(String(p.photoUrl || '')));

    let allThreeMatchBytes = multiPhotos.length === 3;
    for (let i = 0; i < multiPhotos.length; i++) {
      const r = await fetch(`${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[i])}`, {
        headers: { Authorization: `Bearer ${pantryToken}` },
      });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.status !== 200 || sha256Hex(b) !== multiHashes[i]) {
        allThreeMatchBytes = false;
      }
    }

    record(
      '4. Multi-Photo Batch (3 Photos) Retains All References & Full-Size Binaries',
      multiUpload.status === 200 &&
        multiPhotos.length === 3 &&
        multiUpload.body?.count === 3 &&
        allThreeMatchBytes &&
        multiPhotos.every(
          (p: any, idx: number) =>
            p.taskId === multiTask.id &&
            p.roomId === roomB.id &&
            p.metadata?.sessionId === multiUpload.sessionId &&
            p.metadata?.photoIndex === idx + 1 &&
            p.metadata?.totalInBatch === 3 &&
            Boolean(p.userName) &&
            Boolean(p.taskTitle)
        ),
      `count=${multiPhotos.length}, allThreeByteVerified=${allThreeMatchBytes}, session=${multiUpload.sessionId}`
    );

    // Check /api/tasks/:id/evidence & /api/rooms/:id/history
    const taskEvRes = await fetch(`${baseUrl}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const taskEvJson = await taskEvRes.json();

    const roomHistRes = await fetch(`${baseUrl}/api/rooms/${roomB.id}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const roomHistJson = await roomHistRes.json();
    const roomTaskPhotos = (roomHistJson.photos || []).filter((p: any) => p.taskId === multiTask.id);

    record(
      '5. Authoritative Task Evidence & Room History Endpoints Return Enriched Records',
      taskEvRes.status === 200 &&
        taskEvJson.photoCount === 3 &&
        Array.isArray(taskEvJson.photoEvidences) &&
        taskEvJson.photoEvidences.every((p: any) => p.fileAvailable === true) &&
        roomHistRes.status === 200 &&
        roomTaskPhotos.length === 3 &&
        roomTaskPhotos.every((p: any) => p.fileAvailable === true && Boolean(p.taskTitle)) &&
        Array.isArray(roomHistJson.statusHistory) &&
        roomHistJson.statusHistory.some((h: any) => h.taskId === multiTask.id && h.photoCount === 3),
      `taskEvidenceCount=${taskEvJson.photoCount}, roomTaskPhotos=${roomTaskPhotos.length}, roomStatusHistoryLogged=${roomHistJson.statusHistory?.length}`
    );

    // 4. Security: Unauthenticated, Invalid Token, Path Traversal, Cross-User BOLA, Authorized Roles
    const unauthApi = await fetch(`${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[0])}`);
    const unauthUploads = await fetch(
      `${baseUrl}/uploads/photos/${encodeURIComponent(multiFileNames[0])}`
    );
    const invalidTokenRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[0])}`,
      { headers: { Authorization: 'Bearer expired_or_forged_token_xyz' } }
    );
    const traversalRes = await fetch(`${baseUrl}/api/photos/..%2F..%2Fpackage.json`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    record(
      '6. Unrestricted Public URLs Blocked (401 on Unauthenticated & Forged Tokens + Traversal Blocked)',
      unauthApi.status === 401 &&
        unauthUploads.status === 401 &&
        invalidTokenRes.status === 401 &&
        (traversalRes.status === 400 || traversalRes.status === 404),
      `unauthApi=${unauthApi.status}, unauthUploads=${unauthUploads.status}, invalidToken=${invalidTokenRes.status}, traversal=${traversalRes.status}`
    );

    // Create a second Pantry Boy user to verify BOLA isolation on photo files
    const createSecondPantryRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Mohan Verma',
        email: 'mohan.pantry@whitecollarrealty.com',
        role: 'PANTRY_BOY',
        department: 'Hospitality & Operations',
      }),
    });
    if (!createSecondPantryRes.ok) {
      throw new Error(`Failed creating second pantry user: ${createSecondPantryRes.status}`);
    }
    const secondPantryToken = await loginByEmail(baseUrl, 'mohan.pantry@whitecollarrealty.com');

    const bolaPhotoRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[0])}`,
      { headers: { Authorization: `Bearer ${secondPantryToken}` } }
    );
    const bolaUploadsRes = await fetch(
      `${baseUrl}/uploads/photos/${encodeURIComponent(multiFileNames[0])}`,
      { headers: { Authorization: `Bearer ${secondPantryToken}` } }
    );
    const bolaTaskEvRes = await fetch(`${baseUrl}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${secondPantryToken}` },
    });

    const hrPhotoRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[1])}`,
      { headers: { Authorization: `Bearer ${hrToken}` } }
    );
    const cofounderPhotoRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[2])}`,
      { headers: { Authorization: `Bearer ${cofounderToken}` } }
    );
    const adminPhotoRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[0])}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    record(
      '7. RBAC & BOLA Enforcement Across Roles (Other Pantry Boy 403; HR/Co-Founder/Admin 200)',
      bolaPhotoRes.status === 403 &&
        bolaUploadsRes.status === 403 &&
        bolaTaskEvRes.status === 403 &&
        hrPhotoRes.status === 200 &&
        cofounderPhotoRes.status === 200 &&
        adminPhotoRes.status === 200,
      `otherPantryApi=${bolaPhotoRes.status}, otherPantryUploads=${bolaUploadsRes.status}, otherPantryTaskEv=${bolaTaskEvRes.status}, hr=${hrPhotoRes.status}, cofounder=${cofounderPhotoRes.status}, admin=${adminPhotoRes.status}`
    );

    // Verify photo approval transitions task to COMPLETED (Task History) while keeping all 3 photos
    const verifyRes = await fetch(`${baseUrl}/api/tasks/${multiTask.id}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hrToken}`,
      },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    const verifyJson = await verifyRes.json();
    const verifiedTask = verifyJson.task || verifyJson;

    record(
      '8. Task Verification Retains Full Multi-Photo Batch in Completed History',
      verifyRes.status === 200 &&
        verifiedTask.status === 'COMPLETED' &&
        Array.isArray(verifiedTask.photoEvidences) &&
        verifiedTask.photoEvidences.length === 3 &&
        verifiedTask.photoEvidences.every((p: any) => p.status === 'VERIFIED'),
      `status=${verifiedTask.status}, verifiedBatchCount=${verifiedTask.photoEvidences?.length}`
    );

    // 5. Logout / Login Session Revocation & Re-Authentication Persistence
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const revokedRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(singleFileName)}`,
      { headers: { Authorization: `Bearer ${pantryToken}` } }
    );
    pantryToken = await loginByEmail(baseUrl, pantryEmail);
    const reloginRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(singleFileName)}`,
      { headers: { Authorization: `Bearer ${pantryToken}` } }
    );
    const reloginBytes = Buffer.from(await reloginRes.arrayBuffer());

    record(
      '9. Logout Revokes Photo Access (401) & Re-Login Restores Persisted Evidence (200)',
      revokedRes.status === 401 &&
        reloginRes.status === 200 &&
        sha256Hex(reloginBytes) === singleHash,
      `afterLogout=${revokedRes.status}, afterRelogin=${reloginRes.status}, sha256Match=${sha256Hex(reloginBytes) === singleHash}`
    );

    // 6. Cold Server Restart Persistence Test
    await stopServer(serverProc);
    serverProc = spawnStagingServer(port, dataDir, uploadsDir);
    await waitForServer(baseUrl);

    const postRestartPantryToken = await loginByEmail(baseUrl, pantryEmail);
    const postRestartAdminToken = await loginByEmail(
      baseUrl,
      'admin.director@whitecollarrealty.com'
    );

    const postRestartTasksRes = await fetch(`${baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${postRestartPantryToken}` },
    });
    const postRestartTasksJson = await postRestartTasksRes.json();
    const postRestartTasks = (postRestartTasksJson.tasks || postRestartTasksJson || []) as any[];
    const persistedSingle = postRestartTasks.find((t) => t.id === singleTask.id);
    const persistedMulti = postRestartTasks.find((t) => t.id === multiTask.id);

    const postRestartImgRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[2])}`,
      { headers: { Authorization: `Bearer ${postRestartPantryToken}` } }
    );
    const postRestartImgBytes = Buffer.from(await postRestartImgRes.arrayBuffer());

    record(
      '10. Cold Server Restart Retains All Task/Room References & Image Files',
      Boolean(persistedSingle && persistedSingle.photoEvidences?.length === 1) &&
        Boolean(persistedMulti && persistedMulti.photoEvidences?.length === 3) &&
        postRestartImgRes.status === 200 &&
        sha256Hex(postRestartImgBytes) === multiHashes[2],
      `singleCount=${persistedSingle?.photoEvidences?.length}, multiCount=${persistedMulti?.photoEvidences?.length}, imgStatus=${postRestartImgRes.status}`
    );

    // 7. Missing-File Scenario (404 JSON, Sibling Photos Unaffected, Retry Recovery)
    const missingFileName = multiFileNames[1];
    const missingDiskPath = path.join(uploadsDir, missingFileName);
    const backupBytes = fs.readFileSync(missingDiskPath);
    fs.unlinkSync(missingDiskPath);

    const missingApiRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(missingFileName)}`,
      { headers: { Authorization: `Bearer ${postRestartAdminToken}` } }
    );
    const missingApiJson = await missingApiRes.json().catch(() => ({}));

    const missingUploadsRes = await fetch(
      `${baseUrl}/uploads/photos/${encodeURIComponent(missingFileName)}`,
      { headers: { Authorization: `Bearer ${postRestartAdminToken}` } }
    );
    const missingUploadsContentType = missingUploadsRes.headers.get('content-type') || '';

    const partialEvRes = await fetch(`${baseUrl}/api/tasks/${multiTask.id}/evidence`, {
      headers: { Authorization: `Bearer ${postRestartAdminToken}` },
    });
    const partialEvJson = await partialEvRes.json();

    const siblingStillOkRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(multiFileNames[0])}`,
      { headers: { Authorization: `Bearer ${postRestartAdminToken}` } }
    );

    // Restore missing file & verify Retry succeeds
    fs.writeFileSync(missingDiskPath, backupBytes);
    const retryRecoveredRes = await fetch(
      `${baseUrl}/api/photos/${encodeURIComponent(missingFileName)}?t=${Date.now()}`,
      { headers: { Authorization: `Bearer ${postRestartAdminToken}` } }
    );
    const retryRecoveredBytes = Buffer.from(await retryRecoveredRes.arrayBuffer());

    record(
      '11. Missing-File Returns Structured 404 JSON (Never SPA HTML), Siblings Load 200, Retry Recovers',
      missingApiRes.status === 404 &&
        missingApiJson.code === 'EVIDENCE_FILE_MISSING' &&
        missingUploadsRes.status === 404 &&
        missingUploadsContentType.includes('application/json') &&
        partialEvJson.photoEvidences?.[1]?.fileAvailable === false &&
        partialEvJson.photoEvidences?.[0]?.fileAvailable === true &&
        siblingStillOkRes.status === 200 &&
        retryRecoveredRes.status === 200 &&
        sha256Hex(retryRecoveredBytes) === multiHashes[1],
      `missingApi=${missingApiRes.status} (${missingApiJson.code}), missingUploads=${missingUploadsRes.status} (${missingUploadsContentType}), sibling=${siblingStillOkRes.status}, retryRecovered=${retryRecoveredRes.status}`
    );

    // 8. Static Source Verification for UI Components & Regression Constraints
    const pantrySrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/pantry/PantryBoyView.tsx'),
      'utf8'
    );
    const mgmtSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/management/ManagementView.tsx'),
      'utf8'
    );
    const roomDashSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/management/RealtimeRoomDashboard.tsx'),
      'utf8'
    );
    const cameraSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/common/CameraCaptureModal.tsx'),
      'utf8'
    );
    const navbarSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/common/Navbar.tsx'),
      'utf8'
    );

    const hasViewEvidenceEverywhere =
      pantrySrc.includes('View Evidence') &&
      mgmtSrc.includes('View Evidence') &&
      roomDashSrc.includes('View Evidence') &&
      pantrySrc.includes('EvidenceLightboxModal') &&
      mgmtSrc.includes('EvidenceLightboxModal');

    const noRawUnauthenticatedEvidenceImg =
      !pantrySrc.includes('src={pe.photoUrl}') &&
      !pantrySrc.includes('src={task.photoEvidence.photoUrl}') &&
      !mgmtSrc.includes('src={activePhoto.photoUrl}') &&
      !mgmtSrc.includes('src={ph.photoUrl}') &&
      !mgmtSrc.includes('src={task.photoEvidence.photoUrl}');

    const preservesCameraAndNoPantrySwitcher =
      cameraSrc.includes('Submit Photo(s)') &&
      !mgmtSrc.includes('Pantry Boy View') &&
      !navbarSrc.includes('Pantry Boy View');

    record(
      '12. UI Source Audit: View Evidence Buttons, Authenticated Loader, Lightbox & Prior Constraints Intact',
      hasViewEvidenceEverywhere &&
        noRawUnauthenticatedEvidenceImg &&
        preservesCameraAndNoPantrySwitcher,
      `viewEvidenceButtons=${hasViewEvidenceEverywhere}, noRawUnauthImg=${noRawUnauthenticatedEvidenceImg}, priorConstraints=${preservesCameraAndNoPantrySwitcher}`
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
}

run().catch((err) => {
  console.error('Fatal error in verify_photo_evidence_preview_suite:', err);
  process.exit(1);
});
