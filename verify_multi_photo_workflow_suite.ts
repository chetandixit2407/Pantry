import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
  type CapturedPhotoItem,
  validateCapturedPhotoDataUrl,
  validatePhotoBatchForSubmission,
  computeBatchSubmissionKey,
  saveCaptureSessionDraft,
  loadCaptureSessionDraft,
  clearCaptureSessionDraft,
} from './src/utils/photoValidation.ts';

const TEST_PORT = 3197;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Authentic valid binary image frames (PNG, JPEG, WebP) with valid magic bytes & >= 20 bytes
const VALID_PNG_FRAMES = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2NkYGD4z8DAwMgAI0AMAA4AAf92yZ0AAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACCcAf85j5P2AAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
];

// Minimal valid JPEG (>= 20 bytes, starts with FF D8 FF)
const VALID_JPEG_FRAME =
  'data:image/jpeg;base64,' +
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    Buffer.alloc(36, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]).toString('base64');

// Minimal valid WebP (>= 20 bytes, RIFF....WEBP)
const VALID_WEBP_FRAME =
  'data:image/webp;base64,' +
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('VP8 ', 'ascii'),
    Buffer.alloc(24, 0x00),
  ]).toString('base64');

interface MemoryStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function makeCapturedItem(index: number, dataUrl: string): CapturedPhotoItem {
  const val = validateCapturedPhotoDataUrl(dataUrl);
  const iso = new Date(Date.now() + index * 1000).toISOString();
  return {
    id: `shot_test_${index}_${Math.random().toString(36).slice(2, 7)}`,
    dataUrl,
    capturedAt: iso,
    capturedAtIST: '28 Oct 2026, 05:15:00 pm',
    resolution: '1280x720',
    width: 1280,
    height: 720,
    mimeType: val.mimeType,
    sizeBytes: val.sizeBytes,
    sizeLabel: val.sizeLabel,
    valid: val.valid,
    validationError: val.error,
  };
}

function requestHttp(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const postData = options.body !== undefined ? JSON.stringify(options.body) : '';
    const reqOpts: http.RequestOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        ...(options.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(postData)) } : {}),
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function waitForServer(url: string, timeoutMs: number = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await requestHttp(`${url}/api/server-time`);
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Staging server failed to start on ${url} within ${timeoutMs}ms`);
}

async function runSuite() {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcr_mp_workflow_'));
  const stagingDataDir = path.join(stagingRoot, 'data');
  const stagingUploadsDir = path.join(stagingRoot, 'uploads', 'photos');
  fs.mkdirSync(stagingDataDir, { recursive: true });
  fs.mkdirSync(stagingUploadsDir, { recursive: true });

  // Copy production DB snapshot into isolated /tmp staging directory so production DB is untouched
  const prodDbPath = path.join(process.cwd(), 'data', 'smart_pantry_db.json');
  if (fs.existsSync(prodDbPath)) {
    fs.copyFileSync(prodDbPath, path.join(stagingDataDir, 'smart_pantry_db.json'));
  }

  let serverProc: ChildProcess | null = null;
  let passed = 0;
  let failed = 0;
  const results: Array<{ id: string; status: 'PASS' | 'FAIL'; title: string; evidence: string }> = [];

  function record(condition: boolean, id: string, title: string, evidence: string) {
    if (condition) {
      passed++;
      results.push({ id, status: 'PASS', title, evidence });
      console.log(`[PASS] ${id}: ${title} — ${evidence}`);
    } else {
      failed++;
      results.push({ id, status: 'FAIL', title, evidence });
      console.error(`[FAIL] ${id}: ${title} — ${evidence}`);
    }
  }

  try {
    console.log('=== MULTI-PHOTO SESSION WORKFLOW VERIFICATION SUITE ===');
    console.log(`Isolated Staging Root: ${stagingRoot}`);

    // -------------------------------------------------------------------------
    // PART A: Source & Client-Side Validation / Session Draft Unit Verification
    // -------------------------------------------------------------------------
    const modalSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'common', 'CameraCaptureModal.tsx'),
      'utf8'
    );
    const hasAddPhotoButton = modalSource.includes('Add Photo') && modalSource.includes('data-testid="add-photo-btn"');
    const hasGallerySubmitButton =
      modalSource.includes('data-testid="gallery-submit-photos-btn"') &&
      modalSource.includes('Submit Photo(s) ({capturedPhotos.length})');
    const hasFooterSubmitButton =
      modalSource.includes('data-testid="submit-photos-btn"') &&
      modalSource.includes('Submit Photo(s) ({capturedPhotos.length})');
    const hasSinglePhotoThreshold =
      modalSource.includes('capturedPhotos.length >= 1') && !modalSource.includes('capturedPhotos.length >= 2');
    const hasIndividualRetakeAndRemove =
      modalSource.includes('aria-label={`Retake photo ${index + 1}`}') &&
      modalSource.includes('aria-label={`Remove photo ${index + 1}`}');
    const hasDiscardAllAndEnlarge =
      modalSource.includes('Discard All') && modalSource.includes('setPreviewingPhotoIndex');
    const hasNoWindowAlert = !/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(modalSource);
    const hasNoInlineStyle = !/style=\{\{/.test(modalSource);

    record(
      hasAddPhotoButton &&
        hasGallerySubmitButton &&
        hasFooterSubmitButton &&
        hasSinglePhotoThreshold &&
        hasIndividualRetakeAndRemove &&
        hasDiscardAllAndEnlarge &&
        hasNoWindowAlert &&
        hasNoInlineStyle,
      'UI-01',
      'CameraCaptureModal Preview Gallery Submit Photo(s) (N), 1-Photo Threshold & Preserved Controls',
      `GallerySubmit=${hasGallerySubmitButton}, FooterSubmit=${hasFooterSubmitButton}, SinglePhotoEnabled=${hasSinglePhotoThreshold}, AddPhoto=${hasAddPhotoButton}, Retake/Remove=${hasIndividualRetakeAndRemove}, DiscardAll/Enlarge=${hasDiscardAllAndEnlarge}, NoAlert=${hasNoWindowAlert}, NoInlineStyle=${hasNoInlineStyle}`
    );

    // Format & Size Validation Checks
    const pngVal = validateCapturedPhotoDataUrl(VALID_PNG_FRAMES[0]);
    const jpgVal = validateCapturedPhotoDataUrl(VALID_JPEG_FRAME);
    const webpVal = validateCapturedPhotoDataUrl(VALID_WEBP_FRAME);
    record(
      pngVal.valid && jpgVal.valid && webpVal.valid,
      'VAL-01',
      'Client Format & Signature Validation (PNG, JPEG, WebP)',
      `PNG=${pngVal.mimeType}(${pngVal.sizeLabel}), JPEG=${jpgVal.mimeType}(${jpgVal.sizeLabel}), WebP=${webpVal.mimeType}(${webpVal.sizeLabel})`
    );

    const svgSpoof = `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}`;
    const magicSpoof = `data:image/jpeg;base64,${Buffer.from('NOT_A_REAL_JPEG_HEADER_AT_ALL_1234567890').toString('base64')}`;
    const tinyFrame = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;
    const oversizedBuf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10 * 1024 * 1024 + 64, 0xab)]);
    const oversizedFrame = `data:image/jpeg;base64,${oversizedBuf.toString('base64')}`;

    const svgRes = validateCapturedPhotoDataUrl(svgSpoof);
    const spoofRes = validateCapturedPhotoDataUrl(magicSpoof);
    const tinyRes = validateCapturedPhotoDataUrl(tinyFrame);
    const overRes = validateCapturedPhotoDataUrl(oversizedFrame);

    record(
      !svgRes.valid && !spoofRes.valid && !tinyRes.valid && !overRes.valid,
      'VAL-02',
      'Client Rejects Invalid Format, Spoofed Magic Bytes, Too-Small & Oversized (>10MB) Photos',
      `SVG=${svgRes.valid}, Spoof=${spoofRes.valid}, Tiny=${tinyRes.valid}, >10MB=${overRes.valid} (${overRes.sizeLabel})`
    );

    // Batch count flexibility: 1, 2, 3, 4, 5 photos all valid without forcing fixed count
    const countsValid = [1, 2, 3, 4, 5].every((count) => {
      const items = Array.from({ length: count }, (_, idx) => makeCapturedItem(idx, VALID_PNG_FRAMES[idx % VALID_PNG_FRAMES.length]));
      return validatePhotoBatchForSubmission(items, 10).valid;
    });
    const emptyInvalid = !validatePhotoBatchForSubmission([], 10).valid;
    const overCountInvalid = !validatePhotoBatchForSubmission(
      Array.from({ length: 11 }, (_, idx) => makeCapturedItem(idx, VALID_PNG_FRAMES[0])),
      10
    ).valid;

    record(
      countsValid && emptyInvalid && overCountInvalid,
      'VAL-03',
      'Flexible Photo Batch Count Validation (1, 2, 3, 4, 5 Valid; 0 & >10 Blocked)',
      `Counts 1..5 valid=${countsValid}, Empty blocked=${emptyInvalid}, >10 blocked=${overCountInvalid}`
    );

    // Session Draft Persistence until Submitted or Explicitly Discarded
    const memStore = createMemoryStorage();
    const draftPhotos = [makeCapturedItem(0, VALID_PNG_FRAMES[0]), makeCapturedItem(1, VALID_PNG_FRAMES[1])];
    const mockSess = {
      sessionId: 'csess_draft_test_1',
      captureSessionTimestamp: new Date().toISOString(),
      maxPhotos: 10,
      task: { id: 'task-draft-1', title: 'Draft Test', roomAreaName: 'Cabin 1' },
    };
    saveCaptureSessionDraft('raju.sharma@whitecollarrealty.com', 'task-draft-1', mockSess, draftPhotos, memStore);
    const restoredDraft = loadCaptureSessionDraft('raju.sharma@whitecollarrealty.com', 'task-draft-1', memStore);
    const isolatedOtherTask = loadCaptureSessionDraft('raju.sharma@whitecollarrealty.com', 'task-other-2', memStore);
    clearCaptureSessionDraft('raju.sharma@whitecollarrealty.com', 'task-draft-1', memStore);
    const afterDiscard = loadCaptureSessionDraft('raju.sharma@whitecollarrealty.com', 'task-draft-1', memStore);

    record(
      Boolean(restoredDraft && restoredDraft.photos.length === 2) && isolatedOtherTask === null && afterDiscard === null,
      'SESS-01',
      'Session Draft Persistence & Explicit Discard Isolation',
      `Restored=${restoredDraft?.photos.length} photos, OtherTaskIsolated=${isolatedOtherTask === null}, ClearedAfterDiscard=${afterDiscard === null}`
    );

    // -------------------------------------------------------------------------
    // PART B: Live Isolated Staging Server End-to-End Multi-Photo Workflows
    // -------------------------------------------------------------------------
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts', '--port', String(TEST_PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(TEST_PORT),
        DISABLE_HMR: 'true',
        WCR_DATA_DIR: stagingDataDir,
        WCR_UPLOADS_DIR: stagingUploadsDir,
        SESSION_SECRET: 'staging_multi_photo_verification_secret_2026',
      },
      stdio: 'ignore',
    });

    await waitForServer(BASE_URL);

    // Authenticate Admin, HR, and Pantry Boy
    const [adminLogin, hrLogin, pantryLogin] = await Promise.all([
      requestHttp(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: { email: 'admin.director@whitecollarrealty.com' },
      }),
      requestHttp(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: { email: 'priya.sen@whitecollarrealty.com' },
      }),
      requestHttp(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        body: { email: 'raju.sharma@whitecollarrealty.com' },
      }),
    ]);

    const adminToken = adminLogin.body.token;
    const hrToken = hrLogin.body.token;
    const pantryToken = pantryLogin.body.token;

    record(
      Boolean(adminToken && hrToken && pantryToken),
      'AUTH-01',
      'Authenticate Admin, HR & Pantry Boy on Isolated Staging Server',
      `Admin=${adminLogin.status}, HR=${hrLogin.status}, PantryBoy=${pantryLogin.status}`
    );

    // Fetch rooms so we associate tasks with real rooms
    const roomsRes = await requestHttp(`${BASE_URL}/api/rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rooms = roomsRes.body.rooms || [];
    const targetRoomA = rooms[0];
    const targetRoomB = rooms[1] || rooms[0];
    const targetRoomC = rooms[2] || rooms[0];
    const targetRoomD = rooms[3] || rooms[0];

    // Helper to create a clean dedicated task assigned to Raju Sharma for each scenario
    async function createStagingTask(label: string, room: any) {
      const res = await requestHttp(`${BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          title: `[MP-TEST] ${label}`,
          description: `Verification scenario: ${label}`,
          roomAreaId: room.id,
          roomAreaName: room.name,
          priority: 'P1',
          taskType: 'ROUTINE_CLEANING',
          assignedToEmail: 'raju.sharma@whitecollarrealty.com',
          assignedToName: 'Raju Sharma',
          checklist: [
            { id: 'chk-1', text: 'Clean and sanitize table surfaces', completed: true },
            { id: 'chk-2', text: 'Capture live verification photos', completed: false },
          ],
        },
      });
      return res.body.task;
    }

    // -------------------------------------------------------------------------
    // SCENARIO 0: Single-Photo (1 Photo) Session Capture & Submission (1 Valid Photo Sufficient)
    // -------------------------------------------------------------------------
    const task1 = await createStagingTask('1-Photo Single Valid Submission', targetRoomA);
    const sess1Res = await requestHttp(`${BASE_URL}/api/tasks/${task1.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const session1Id = sess1Res.body.sessionId;
    const items1 = [makeCapturedItem(0, VALID_JPEG_FRAME)];
    const singleClientBatchCheck = validatePhotoBatchForSubmission(items1, sess1Res.body.maxPhotos || 10);
    const subKey1 = computeBatchSubmissionKey(task1.id, session1Id, items1);

    const submit1Res = await requestHttp(`${BASE_URL}/api/tasks/${task1.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': subKey1,
      },
      body: {
        sessionId: session1Id,
        submissionId: subKey1,
        photos: items1.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { resolution: p.resolution, photoIndex: idx + 1, totalInBatch: 1 },
        })),
      },
    });

    const ev1 = submit1Res.body.photoEvidences || [];
    const fileExists1 =
      ev1.length === 1 && fs.existsSync(path.join(stagingUploadsDir, path.basename(ev1[0].photoUrl)));
    const roomHist1 = await requestHttp(`${BASE_URL}/api/rooms/${targetRoomA.id}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const roomPhotosForTask1 = (roomHist1.body.photos || []).filter((p: any) => p.taskId === task1.id);

    record(
      singleClientBatchCheck.valid &&
        sess1Res.body.maxPhotos === 10 &&
        submit1Res.status === 200 &&
        submit1Res.body.count === 1 &&
        submit1Res.body.task?.status === 'PENDING_VERIFICATION' &&
        fileExists1 &&
        ev1[0]?.taskId === task1.id &&
        ev1[0]?.roomId === targetRoomA.id &&
        ev1[0]?.metadata?.sessionId === session1Id &&
        roomPhotosForTask1.length === 1,
      'E2E-1PHOTO',
      'Single-Photo (N=1) Submission Enabled & Associated with Task, Room & Active Session (Max=10 Preserved)',
      `clientValid=${singleClientBatchCheck.valid}, maxPhotos=${sess1Res.body.maxPhotos}, HTTP ${submit1Res.status}, count=${submit1Res.body.count}, taskStatus=${submit1Res.body.task?.status}, diskFile=${fileExists1}, roomHistoryPhotos=${roomPhotosForTask1.length}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 1: 2-Photo Session Capture & Batch Submission + Room History Association
    // -------------------------------------------------------------------------
    const task2 = await createStagingTask('2-Photo Batch Submission', targetRoomA);
    const sess2Res = await requestHttp(`${BASE_URL}/api/tasks/${task2.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const session2Id = sess2Res.body.sessionId;
    const items2 = [makeCapturedItem(0, VALID_PNG_FRAMES[0]), makeCapturedItem(1, VALID_JPEG_FRAME)];
    const subKey2 = computeBatchSubmissionKey(task2.id, session2Id, items2);

    const submit2Res = await requestHttp(`${BASE_URL}/api/tasks/${task2.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': subKey2,
      },
      body: {
        sessionId: session2Id,
        submissionId: subKey2,
        photos: items2.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { resolution: p.resolution, photoIndex: idx + 1, totalInBatch: 2 },
        })),
      },
    });

    const ev2 = submit2Res.body.photoEvidences || [];
    const filesExist2 =
      ev2.length === 2 &&
      ev2.every((e: any) => fs.existsSync(path.join(stagingUploadsDir, path.basename(e.photoUrl))));
    const roomHist2 = await requestHttp(`${BASE_URL}/api/rooms/${targetRoomA.id}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const roomPhotosForTask2 = (roomHist2.body.photos || []).filter((p: any) => p.taskId === task2.id);

    record(
      submit2Res.status === 200 &&
        submit2Res.body.count === 2 &&
        filesExist2 &&
        ev2.every((e: any) => e.taskId === task2.id && e.roomId === targetRoomA.id && e.metadata?.sessionId === session2Id) &&
        roomPhotosForTask2.length === 2,
      'E2E-2PHOTO',
      '2-Photo Session Submission & Task/Room/Session Association',
      `HTTP ${submit2Res.status}, count=${submit2Res.body.count}, diskFiles=${filesExist2}, roomHistoryPhotos=${roomPhotosForTask2.length}, session=${session2Id}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: Capture 4 -> Individual Remove -> Individual Retake -> 3-Photo Submission
    // -------------------------------------------------------------------------
    const task3 = await createStagingTask('3-Photo After Removal & Retake', targetRoomB);
    const sess3Res = await requestHttp(`${BASE_URL}/api/tasks/${task3.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const session3Id = sess3Res.body.sessionId;

    // Simulate user capturing 4 photos in session
    let gallery3: CapturedPhotoItem[] = [
      makeCapturedItem(0, VALID_PNG_FRAMES[0]),
      makeCapturedItem(1, VALID_PNG_FRAMES[1]),
      makeCapturedItem(2, VALID_PNG_FRAMES[2]),
      makeCapturedItem(3, VALID_PNG_FRAMES[3]),
    ];
    const removedShotId = gallery3[2].id;
    // Remove Photo #3 (index 2) -> 3 photos remain
    gallery3 = gallery3.filter((_, idx) => idx !== 2);
    // Retake Photo #2 (index 1) in-place with a WebP frame -> still 3 photos, index 1 replaced
    const originalShot2Id = gallery3[1].id;
    const replacementShot2 = makeCapturedItem(10, VALID_WEBP_FRAME);
    gallery3 = gallery3.map((item, idx) => (idx === 1 ? replacementShot2 : item));

    const subKey3 = computeBatchSubmissionKey(task3.id, session3Id, gallery3);
    const submit3Res = await requestHttp(`${BASE_URL}/api/tasks/${task3.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': subKey3,
      },
      body: {
        sessionId: session3Id,
        submissionId: subKey3,
        photos: gallery3.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { resolution: p.resolution, photoIndex: idx + 1, totalInBatch: gallery3.length },
        })),
      },
    });

    const ev3 = submit3Res.body.photoEvidences || [];
    record(
      gallery3.length === 3 &&
        !gallery3.some((p) => p.id === removedShotId) &&
        !gallery3.some((p) => p.id === originalShot2Id) &&
        gallery3[1].id === replacementShot2.id &&
        submit3Res.status === 200 &&
        submit3Res.body.count === 3 &&
        ev3.length === 3 &&
        ev3[1].metadata?.mimeType === 'image/webp',
      'E2E-3PHOTO-EDIT',
      'Capture 4 -> Remove 1 -> In-Place Retake #2 -> Submit 3 Photos Together',
      `HTTP ${submit3Res.status}, submittedCount=${submit3Res.body.count}, retakenMime=${ev3[1]?.metadata?.mimeType}, status=${submit3Res.body.task?.status}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: 4-Photo Submission (Confirming Any Valid Count Including 4 Works)
    // -------------------------------------------------------------------------
    const task4 = await createStagingTask('4-Photo Batch Submission', targetRoomC);
    const sess4Res = await requestHttp(`${BASE_URL}/api/tasks/${task4.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const items4 = [0, 1, 2, 3].map((i) => makeCapturedItem(i, VALID_PNG_FRAMES[i]));
    const subKey4 = computeBatchSubmissionKey(task4.id, sess4Res.body.sessionId, items4);
    const submit4Res = await requestHttp(`${BASE_URL}/api/tasks/${task4.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}`, 'Idempotency-Key': subKey4 },
      body: {
        sessionId: sess4Res.body.sessionId,
        submissionId: subKey4,
        photos: items4.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { photoIndex: idx + 1, totalInBatch: 4 },
        })),
      },
    });
    record(
      submit4Res.status === 200 && submit4Res.body.count === 4 && submit4Res.body.task?.photoEvidences?.length === 4,
      'E2E-4PHOTO',
      '4-Photo Session Batch Submission',
      `HTTP ${submit4Res.status}, count=${submit4Res.body.count}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 4: 5-Photo Session Submission + HR Verification Approval
    // -------------------------------------------------------------------------
    const task5 = await createStagingTask('5-Photo Batch Submission & HR Approval', targetRoomD);
    const sess5Res = await requestHttp(`${BASE_URL}/api/tasks/${task5.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const session5Id = sess5Res.body.sessionId;
    const items5 = [
      makeCapturedItem(0, VALID_PNG_FRAMES[0]),
      makeCapturedItem(1, VALID_JPEG_FRAME),
      makeCapturedItem(2, VALID_WEBP_FRAME),
      makeCapturedItem(3, VALID_PNG_FRAMES[3]),
      makeCapturedItem(4, VALID_PNG_FRAMES[4]),
    ];
    const subKey5 = computeBatchSubmissionKey(task5.id, session5Id, items5);

    const submit5Res = await requestHttp(`${BASE_URL}/api/tasks/${task5.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': subKey5,
      },
      body: {
        sessionId: session5Id,
        submissionId: subKey5,
        photos: items5.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { resolution: '1280x720', photoIndex: idx + 1, totalInBatch: 5 },
        })),
      },
    });

    const ev5 = submit5Res.body.photoEvidences || [];
    const all5ExistOnDisk =
      ev5.length === 5 &&
      ev5.every((e: any) => fs.existsSync(path.join(stagingUploadsDir, path.basename(e.photoUrl))));

    // HR approves the 5-photo submission
    const verify5Res = await requestHttp(`${BASE_URL}/api/tasks/${task5.id}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { decision: 'APPROVE' },
    });
    const verifiedAll5 =
      verify5Res.status === 200 &&
      verify5Res.body.task?.status === 'COMPLETED' &&
      (verify5Res.body.task?.photoEvidences || []).every((e: any) => e.status === 'VERIFIED');

    record(
      submit5Res.status === 200 && submit5Res.body.count === 5 && all5ExistOnDisk && verifiedAll5,
      'E2E-5PHOTO',
      '5-Photo Mixed-Format Session Submission & HR Verification Approval',
      `Upload HTTP ${submit5Res.status} (count=${submit5Res.body.count}, disk=${all5ExistOnDisk}), HR Approve HTTP ${verify5Res.status} (all5Verified=${verifiedAll5})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 5: Duplicate Submission Prevention (Idempotency Key & Session Replay)
    // -------------------------------------------------------------------------
    const filesBeforeDup = fs.readdirSync(stagingUploadsDir).length;
    const dupRes = await requestHttp(`${BASE_URL}/api/tasks/${task2.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': subKey2,
      },
      body: {
        sessionId: session2Id,
        submissionId: subKey2,
        photos: items2.map((p) => ({ photoData: p.dataUrl, capturedAt: p.capturedAt })),
      },
    });
    // Also test session-level duplicate guard even without Idempotency-Key header
    const dupSessOnlyRes = await requestHttp(`${BASE_URL}/api/tasks/${task2.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId: session2Id,
        photos: items2.map((p) => ({ photoData: p.dataUrl, capturedAt: p.capturedAt })),
      },
    });
    const filesAfterDup = fs.readdirSync(stagingUploadsDir).length;

    record(
      dupRes.status === 200 &&
        dupRes.body.duplicate === true &&
        dupSessOnlyRes.status === 200 &&
        dupSessOnlyRes.body.duplicate === true &&
        filesAfterDup === filesBeforeDup,
      'E2E-DUP-GUARD',
      'Duplicate Submission Prevention (Zero Extra Disk Files or Duplicate Task Mutations)',
      `IdempKeyReplay duplicate=${dupRes.body.duplicate}, SessionReplay duplicate=${dupSessOnlyRes.body.duplicate}, diskFilesBefore=${filesBeforeDup}, diskFilesAfter=${filesAfterDup}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 6: Upload Failure (Atomic Rollback) & Successful Retry with Active Session
    // -------------------------------------------------------------------------
    const taskRetry = await createStagingTask('Upload Failure Atomic Rollback & Retry', targetRoomA);
    const sessRetryRes = await requestHttp(`${BASE_URL}/api/tasks/${taskRetry.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const retrySessionId = sessRetryRes.body.sessionId;
    const filesBeforeFail = fs.readdirSync(stagingUploadsDir).length;

    // Attempt 1: 3 photos where Photo #3 has corrupted magic bytes -> must fail 400 with ZERO partial files written!
    const corruptedBase64 = Buffer.from('CORRUPTED_CAMERA_BUFFER_FAILS_SIGNATURE_CHECK_1234567890').toString('base64');
    const failedAttemptRes = await requestHttp(`${BASE_URL}/api/tasks/${taskRetry.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId: retrySessionId,
        photos: [
          { photoData: VALID_PNG_FRAMES[0], capturedAt: new Date().toISOString() },
          { photoData: VALID_PNG_FRAMES[1], capturedAt: new Date().toISOString() },
          { photoData: `data:image/png;base64,${corruptedBase64}`, capturedAt: new Date().toISOString() },
        ],
      },
    });
    const filesAfterFail = fs.readdirSync(stagingUploadsDir).length;

    // Attempt 2 (Retry): User retakes/replaces Photo #3 and retries using the SAME active sessionId -> succeeds 200!
    const retryItems = [
      makeCapturedItem(0, VALID_PNG_FRAMES[0]),
      makeCapturedItem(1, VALID_PNG_FRAMES[1]),
      makeCapturedItem(2, VALID_PNG_FRAMES[2]),
    ];
    const retrySubKey = computeBatchSubmissionKey(taskRetry.id, retrySessionId, retryItems);
    const retrySuccessRes = await requestHttp(`${BASE_URL}/api/tasks/${taskRetry.id}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pantryToken}`,
        'Idempotency-Key': retrySubKey,
      },
      body: {
        sessionId: retrySessionId,
        submissionId: retrySubKey,
        photos: retryItems.map((p, idx) => ({
          photoData: p.dataUrl,
          capturedAt: p.capturedAt,
          metadata: { photoIndex: idx + 1, totalInBatch: 3 },
        })),
      },
    });

    record(
      failedAttemptRes.status === 400 &&
        failedAttemptRes.body.failedPhotoIndex === 3 &&
        filesAfterFail === filesBeforeFail &&
        retrySuccessRes.status === 200 &&
        retrySuccessRes.body.count === 3,
      'E2E-FAIL-RETRY',
      'Failed Upload Atomic Rollback (Zero Orphan Files) & Successful Retry on Same Active Session',
      `Attempt1 HTTP ${failedAttemptRes.status} (failedPhotoIndex=${failedAttemptRes.body.failedPhotoIndex}, orphanFiles=${filesAfterFail - filesBeforeFail}), Retry HTTP ${retrySuccessRes.status} (count=${retrySuccessRes.body.count})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 7: Invalid/Stale Session Rejection & Session Refresh Retry
    // -------------------------------------------------------------------------
    const taskStale = await createStagingTask('Stale Session Recovery', targetRoomB);
    const staleAttempt = await requestHttp(`${BASE_URL}/api/tasks/${taskStale.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId: 'csess_stale_or_invalid_id',
        photos: [
          { photoData: VALID_PNG_FRAMES[0], capturedAt: new Date().toISOString() },
          { photoData: VALID_PNG_FRAMES[1], capturedAt: new Date().toISOString() },
        ],
      },
    });
    const freshSessRes = await requestHttp(`${BASE_URL}/api/tasks/${taskStale.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    const freshRetryRes = await requestHttp(`${BASE_URL}/api/tasks/${taskStale.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId: freshSessRes.body.sessionId,
        photos: [
          { photoData: VALID_PNG_FRAMES[0], capturedAt: new Date().toISOString() },
          { photoData: VALID_PNG_FRAMES[1], capturedAt: new Date().toISOString() },
        ],
      },
    });

    record(
      staleAttempt.status === 400 &&
        staleAttempt.body.code === 'INVALID_CAPTURE_SESSION' &&
        freshRetryRes.status === 200 &&
        freshRetryRes.body.count === 2,
      'E2E-SESS-RETRY',
      'Invalid/Expired Session Rejection & Automatic Fresh Session Retry',
      `Stale HTTP ${staleAttempt.status} (${staleAttempt.body.code}), FreshRetry HTTP ${freshRetryRes.status} (count=${freshRetryRes.body.count})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 8: Security & RBAC Preservation (Unauthenticated, Cross-Task Session Spoof, Protected Static Photo Serving, Audit Logs)
    // -------------------------------------------------------------------------
    const unauthUpload = await requestHttp(`${BASE_URL}/api/tasks/${task2.id}/photos`, {
      method: 'POST',
      body: { photos: [{ photoData: VALID_PNG_FRAMES[0] }] },
    });

    // Cross-task session spoofing: try using taskRetry's session on a brand new task
    const taskOther = await createStagingTask('Cross-Task Session Target', targetRoomC);
    const spoofTaskSess = await requestHttp(`${BASE_URL}/api/tasks/${taskOther.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId: retrySessionId,
        photos: [{ photoData: VALID_PNG_FRAMES[0] }],
      },
    });

    // Unauthenticated static photo access blocked; authenticated allowed
    const samplePhotoUrl = ev2[0].photoUrl;
    const unauthStatic = await requestHttp(`${BASE_URL}${samplePhotoUrl}`);
    const authStatic = await requestHttp(`${BASE_URL}${samplePhotoUrl}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Audit log check
    const auditRes = await requestHttp(`${BASE_URL}/api/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const logs = auditRes.body.auditLogs || [];
    const hasUploadAudit = logs.some((l: any) => l.action === 'PHOTO_SUBMITTED');
    const hasDupAudit = logs.some((l: any) => l.action === 'PHOTO_SUBMISSION_DUPLICATE_PREVENTED');

    record(
      unauthUpload.status === 401 &&
        spoofTaskSess.status === 403 &&
        spoofTaskSess.body.code === 'SESSION_TASK_MISMATCH' &&
        unauthStatic.status === 401 &&
        authStatic.status === 200 &&
        hasUploadAudit &&
        hasDupAudit,
      'SEC-01',
      'Authentication, Cross-Task Session Binding, Protected Photo Serving & Audit Logging Preserved',
      `UnauthUpload=${unauthUpload.status}, CrossTaskSession=${spoofTaskSess.status}(${spoofTaskSess.body.code}), UnauthStatic=${unauthStatic.status}, AuthStatic=${authStatic.status}, AuditLogs(Upload=${hasUploadAudit}, Dup=${hasDupAudit})`
    );

    console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (serverProc && !serverProc.killed) {
      try {
        serverProc.kill('SIGTERM');
      } catch {}
    }
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch {}
  }
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch((err) => {
  console.error('Unhandled suite failure:', err);
  process.exit(1);
});
