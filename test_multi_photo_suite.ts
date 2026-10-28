import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = parseInt(process.env.WCR_TEST_PORT || '3000', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const UPLOADS_DIR = process.env.WCR_UPLOADS_DIR || path.join(process.cwd(), 'uploads', 'photos');

function requestHttp(urlStr: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const postData = options.body ? JSON.stringify(options.body) : '';
    const reqOpts: http.RequestOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.body ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode || 0, body: parsed });
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

async function runTests() {
  console.log('--- STARTING MULTI-PHOTO CAMERA CAPTURE TEST SUITE ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail: string = '') {
    if (condition) {
      console.log(`[PASS] ${title} - ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} - ${detail}`);
      failed++;
    }
  }

  try {
    // 1. Login as Raju Sharma (Pantry Boy)
    const loginRes = await requestHttp(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      body: { email: 'raju.sharma@whitecollarrealty.com' },
    });
    assert(loginRes.status === 200 && Boolean(loginRes.body.token), 'Pantry Boy Authentication', `Logged in as ${loginRes.body.user?.email}`);
    const pantryToken = loginRes.body.token;

    // 2. Fetch Tasks
    const tasksRes = await requestHttp(`${BASE_URL}/api/tasks`, {
      headers: { Authorization: `Bearer ${pantryToken}` },
    });
    const tasks = tasksRes.body.tasks || [];
    assert(tasks.length > 0, 'Fetch Pantry Tasks', `Found ${tasks.length} tasks`);
    const activeTask = tasks.find((t: any) => t.assignedToEmail === 'raju.sharma@whitecollarrealty.com' && t.status !== 'COMPLETED') || tasks[0];

    // 3. Initialize Authoritative Capture Session
    const sessRes = await requestHttp(`${BASE_URL}/api/tasks/${activeTask.id}/capture-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {},
    });
    assert(
      sessRes.status === 200 && Boolean(sessRes.body.sessionId) && Boolean(sessRes.body.captureSessionTimestamp),
      'Initialize Capture Session',
      `Session ID: ${sessRes.body.sessionId}, Capture Timestamp: ${sessRes.body.captureSessionTimestamp}`
    );
    const sessionId = sessRes.body.sessionId;
    const captureSessionTimestamp = sessRes.body.captureSessionTimestamp;

    // 4. Test Security Rejection on Invalid Non-Image Payload
    const fakeLongBase64 = Buffer.from('THIS_IS_A_FAKE_NON_IMAGE_STRING_THAT_IS_LONG_ENOUGH_TO_PASS_LENGTH_CHECK_AND_FAIL_MAGIC_BYTES').toString('base64');
    const invalidPayloadRes = await requestHttp(`${BASE_URL}/api/tasks/${activeTask.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId,
        photos: [{ photoData: `data:image/png;base64,${fakeLongBase64}` }],
      },
    });
    assert(
      invalidPayloadRes.status === 400 && invalidPayloadRes.body.error?.includes('Security rejection'),
      'Security Magic Bytes Validation',
      `Correctly rejected invalid payload: ${invalidPayloadRes.body.error}`
    );

    // 5. Multi-Photo Batch Upload with Valid Live Camera Base64 Frames
    const validPng1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const validPng2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const multiUploadRes = await requestHttp(`${BASE_URL}/api/tasks/${activeTask.id}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pantryToken}` },
      body: {
        sessionId,
        photos: [
          { photoData: validPng1, capturedAt: new Date().toISOString(), metadata: { resolution: '1280x720' } },
          { photoData: validPng2, capturedAt: new Date().toISOString(), metadata: { resolution: '1280x720' } },
        ],
      },
    });

    assert(
      multiUploadRes.status === 200 && multiUploadRes.body.count === 2 && Array.isArray(multiUploadRes.body.photoEvidences),
      'Batch Multi-Photo Upload Endpoint',
      `Uploaded ${multiUploadRes.body.count} photos successfully`
    );

    const uploadedEvidences = multiUploadRes.body.photoEvidences;
    assert(
      uploadedEvidences[0].metadata?.sessionId === sessionId && Boolean(uploadedEvidences[0].serverTimestamp),
      'Timestamp & Capture Session Association',
      `Photo #1 linked to session ${uploadedEvidences[0].metadata?.sessionId}, receipt time: ${uploadedEvidences[0].serverTimestamp}`
    );

    // 6. Verify Files Persisted to Disk
    const file1Name = path.basename(uploadedEvidences[0].photoUrl);
    const diskPath1 = path.join(UPLOADS_DIR, file1Name);
    assert(fs.existsSync(diskPath1), 'File System Persistence', `Disk file verified at: ${diskPath1}`);

    // 7. Verify Task Status Transitioned to PENDING_VERIFICATION
    const updatedTask = multiUploadRes.body.task;
    assert(
      updatedTask.status === 'PENDING_VERIFICATION' && updatedTask.photoEvidences.length === 2,
      'Task Status Update & Dashboard Readiness',
      `Task status: ${updatedTask.status}, Photo Count: ${updatedTask.photoEvidences.length}`
    );

    console.log(`\n--- TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('Test suite error:', err);
    process.exit(1);
  }
}

runTests();
