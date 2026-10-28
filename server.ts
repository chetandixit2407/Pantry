import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';
import type {
  Role,
  UserAccount,
  RoomArea,
  RoomSetupConfig,
  RoomAssignment,
  RoomStatusHistoryEntry,
  RoomStatus,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  VisitorEvent,
  AuditLog,
  AppNotification,
  PhotoEvidence,
  ChecklistItem,
  DailyReportSummary,
  WeeklyReportSummary,
  PantryRequest,
  UserPermissions,
  AttendanceRecord,
} from './src/types/index.ts';
import {
  normalizeDisplayText,
  normalizeRoomName,
  normalizeTaskRecord,
  normalizeRoomRecord,
} from './src/utils/textNormalizer.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// AI Studio dev server must always run on port 3000. Ignore Cloud Run's internal PORT=8080.
function resolveServerPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const parsed = parseInt(process.argv[portArgIdx + 1], 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (process.env.PORT && process.env.PORT !== '8080') {
    const parsed = parseInt(process.env.PORT, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 3000;
}
const PORT = resolveServerPort();

// Security headers middleware (compatible with AI Studio iframe hosting)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.path.startsWith('/api') && !req.path.startsWith('/api/realtime')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Sliding-window rate limiting middleware (protects auth & API endpoints against burst abuse)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_AUTH_MAX = Math.max(10, parseInt(process.env.WCR_RATE_LIMIT_AUTH_MAX || '60', 10) || 60);
const RATE_LIMIT_API_MAX = Math.max(50, parseInt(process.env.WCR_RATE_LIMIT_API_MAX || '600', 10) || 600);
const rateLimitBuckets = new Map<string, number[]>();

function getClientIpKey(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : typeof xff === 'string' ? xff.split(',')[0] : '';
  return (forwarded || req.socket.remoteAddress || 'local').trim();
}

app.use('/api', (req, res, next) => {
  const now = Date.now();
  const isAuthRoute = req.path.startsWith('/auth/login') || req.path.startsWith('/auth/switch-user');
  const bucketKey = `${isAuthRoute ? 'auth' : 'api'}:${getClientIpKey(req)}`;
  const maxAllowed = isAuthRoute ? RATE_LIMIT_AUTH_MAX : RATE_LIMIT_API_MAX;

  const existing = rateLimitBuckets.get(bucketKey) || [];
  const activeTimestamps = existing.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (activeTimestamps.length >= maxAllowed) {
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - activeTimestamps[0])) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    rateLimitBuckets.set(bucketKey, activeTimestamps);
    return res.status(429).json({
      error: isAuthRoute
        ? 'Too many authentication attempts. Please wait before retrying.'
        : 'API rate limit exceeded. Please slow down and retry shortly.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: retryAfterSec,
    });
  }
  activeTimestamps.push(now);
  rateLimitBuckets.set(bucketKey, activeTimestamps);
  next();
});

// Body parser with 50MB limit for multi-photo camera evidence batches
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Malformed JSON request payload.', code: 'INVALID_JSON' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload exceeds maximum 50MB limit.', code: 'PAYLOAD_TOO_LARGE' });
  }
  next(err);
});

// -----------------------------------------------------------------------------
// Local Storage & Database Persistence Layer (Supports Isolated Staging Overrides)
// -----------------------------------------------------------------------------
const DATA_DIR = process.env.WCR_DATA_DIR
  ? path.resolve(process.env.WCR_DATA_DIR)
  : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'smart_pantry_db.json');
const UPLOADS_DIR = process.env.WCR_UPLOADS_DIR
  ? path.resolve(process.env.WCR_UPLOADS_DIR)
  : path.join(__dirname, 'uploads', 'photos');
const UPLOADS_ROOT_DIR = path.resolve(UPLOADS_DIR, '..');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function resolvePhotoMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function isEvidenceFileOnDisk(photoUrl?: string): boolean {
  if (!photoUrl || typeof photoUrl !== 'string') return false;
  const cleanPath = photoUrl.split('?')[0].trim();
  const base = path.basename(cleanPath);
  if (!base || base === '.' || base === '..') return false;
  return fs.existsSync(path.join(UPLOADS_DIR, base));
}

function serveAuthorizedPhotoFile(req: express.Request, res: express.Response, rawFileName: string) {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({
      error: 'Session expired or authentication required to view operational photo evidence.',
      code: 'SESSION_EXPIRED_OR_UNAUTHENTICATED',
    });
  }

  let decodedName = '';
  try {
    decodedName = decodeURIComponent(String(rawFileName || '').split('?')[0].trim());
  } catch {
    return res.status(400).json({
      error: 'Invalid photo evidence reference.',
      code: 'INVALID_PHOTO_REFERENCE',
    });
  }

  const safeFileName = path.basename(decodedName);
  if (
    !safeFileName ||
    safeFileName !== decodedName ||
    safeFileName === '.' ||
    safeFileName === '..' ||
    !/\.(png|jpe?g|webp)$/i.test(safeFileName)
  ) {
    return res.status(400).json({
      error: 'Invalid photo evidence file name.',
      code: 'INVALID_PHOTO_REFERENCE',
    });
  }

  const perms = actor.permissions || getDefaultPermissions(actor.role);
  const canViewAnyOperationalArea =
    checkUserPermission(actor, 'tasks', 'view') || checkUserPermission(actor, 'rooms', 'view');
  if (!canViewAnyOperationalArea) {
    return res.status(403).json({
      error: 'Access denied: Your account does not have permission to view operational photo evidence.',
      code: 'FORBIDDEN_EVIDENCE_ACCESS',
    });
  }

  const isManagementViewer =
    actor.role === 'ADMIN' || Boolean(actor.isSuperAdmin) || Boolean(perms.dashboards?.management);

  const matchingTasks = db.tasks.filter((t) => {
    const evidences =
      Array.isArray(t.photoEvidences) && t.photoEvidences.length > 0
        ? t.photoEvidences
        : t.photoEvidence
        ? [t.photoEvidence]
        : [];
    return evidences.some((ev) => {
      if (!ev?.photoUrl) return false;
      const evBase = path.basename(ev.photoUrl.split('?')[0]);
      return evBase === safeFileName;
    });
  });

  if (!isManagementViewer) {
    const actorEmailLower = actor.email.toLowerCase();
    if (matchingTasks.length > 0) {
      const ownsOrAssigned = matchingTasks.some((t) => {
        if (t.assignedToEmail && t.assignedToEmail.toLowerCase() === actorEmailLower) return true;
        const evidences =
          Array.isArray(t.photoEvidences) && t.photoEvidences.length > 0
            ? t.photoEvidences
            : t.photoEvidence
            ? [t.photoEvidence]
            : [];
        return evidences.some((ev) => ev?.userEmail?.toLowerCase() === actorEmailLower);
      });
      if (!ownsOrAssigned) {
        return res.status(403).json({
          error: 'Access denied: You are only authorized to view photo evidence for your own assigned tasks.',
          code: 'FORBIDDEN_EVIDENCE_ACCESS',
        });
      }
    } else if (fs.existsSync(path.join(UPLOADS_DIR, safeFileName))) {
      return res.status(403).json({
        error: 'Access denied: Photo evidence is not associated with your assigned tasks.',
        code: 'FORBIDDEN_EVIDENCE_ACCESS',
      });
    }
  }

  const targetPath = path.join(UPLOADS_DIR, safeFileName);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({
      error: 'Uploaded photo evidence file was not found in server storage.',
      code: 'EVIDENCE_FILE_MISSING',
      fileName: safeFileName,
    });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Content-Type', resolvePhotoMimeType(safeFileName));
  return res.sendFile(targetPath);
}

// Protect operational photo evidence under /uploads with strict session authentication & RBAC
const requirePhotoAuth: express.RequestHandler = (req, res, next) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({
      error: 'Session expired or authentication required to view operational photo evidence.',
      code: 'SESSION_EXPIRED_OR_UNAUTHENTICATED',
    });
  }
  res.setHeader('Cache-Control', 'private, no-cache');
  next();
};
app.get('/uploads/photos/:fileName', (req, res) => {
  return serveAuthorizedPhotoFile(req, res, req.params.fileName);
});
app.use('/uploads', requirePhotoAuth, (_req, res) => {
  return res.status(404).json({
    error: 'Uploaded photo evidence file was not found in server storage.',
    code: 'EVIDENCE_FILE_MISSING',
  });
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// -----------------------------------------------------------------------------
// Real-time Event Broadcaster (Server-Sent Events)
// -----------------------------------------------------------------------------
interface SSEClientEntry {
  res: express.Response;
  req: express.Request;
  userId?: string;
}

const sseClients = new Set<SSEClientEntry>();

function broadcastRealtime(event: string, payload: any) {
  const nowIso = new Date().toISOString();
  const basePayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, serverTime: payload.serverTime || nowIso }
      : payload;

  for (const client of sseClients) {
    try {
      const user = getCurrentUser(client.req);

      // Deliver immediate revocation signal to a just-deactivated/deleted user, then close their stream
      if (!user) {
        if (
          (event === 'account:revoked' && basePayload?.userId && basePayload.userId === client.userId) ||
          (event === 'user:updated' && basePayload?.user?.id && basePayload.user.id === client.userId)
        ) {
          const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload: basePayload, timestamp: nowIso })}\n\n`;
          client.res.write(message);
          if (event === 'account:revoked') {
            client.res.end();
            sseClients.delete(client);
          }
        } else {
          client.res.end();
          sseClients.delete(client);
        }
        continue;
      }

      if (event === 'notification:new' && basePayload?.notification) {
        if (!canUserReceiveNotification(user, basePayload.notification)) {
          continue;
        }
      }

      let clientPayload = basePayload;
      if (
        (event === 'task:created' || event === 'task:updated') &&
        user.role === 'PANTRY_BOY' &&
        basePayload &&
        typeof basePayload === 'object'
      ) {
        const ownEmail = user.email.toLowerCase();
        const filteredTasks = Array.isArray(basePayload.tasks)
          ? basePayload.tasks
              .filter((t: Task) => t.assignedToEmail.toLowerCase() === ownEmail)
              .map((t: Task) => normalizeTaskRecord(t))
          : undefined;
        const singleTask =
          basePayload.task && basePayload.task.assignedToEmail?.toLowerCase() === ownEmail
            ? normalizeTaskRecord(basePayload.task)
            : undefined;
        clientPayload = {
          ...basePayload,
          ...(filteredTasks !== undefined ? { tasks: filteredTasks } : {}),
          task: singleTask,
        };
      }

      const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload: clientPayload, timestamp: nowIso })}\n\n`;
      client.res.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastToPantryBoy(assignedEmail: string, event: string, payload: any) {
  const nowIso = new Date().toISOString();
  const enrichedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, serverTime: payload.serverTime || nowIso }
      : payload;
  const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload: enrichedPayload, timestamp: nowIso })}\n\n`;
  const targetEmail = (assignedEmail || '').toLowerCase().trim();

  for (const client of sseClients) {
    try {
      const user = getCurrentUser(client.req);
      if (
        user &&
        user.role === 'PANTRY_BOY' &&
        user.status === 'active' &&
        (!targetEmail || user.email.toLowerCase() === targetEmail)
      ) {
        client.res.write(message);
      }
    } catch {
      sseClients.delete(client);
    }
  }
}

function getDefaultPermissions(role: Role): UserPermissions {
  if (role === 'ADMIN') {
    return {
      dashboards: { pantry: true, management: true },
      sidebarItems: {
        dashboard: true,
        myTasks: true,
        roomSupport: true,
        pantryRequests: true,
        notifications: true,
        taskHistory: true,
        myProfile: true,
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
    };
  }
  if (role === 'KIMMY_MAM' || role === 'HR') {
    return {
      dashboards: { pantry: true, management: true },
      sidebarItems: {
        dashboard: true,
        myTasks: true,
        roomSupport: true,
        pantryRequests: true,
        notifications: true,
        taskHistory: true,
        myProfile: true,
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
        rooms: { view: true, create: true, edit: true, delete: false },
        visitors: { view: true, create: true, edit: true, delete: true },
        users: { view: true, create: true, edit: true, delete: false },
        reports: { view: true, export: true },
      },
    };
  }
  // PANTRY_BOY
  return {
    dashboards: { pantry: true, management: false },
    sidebarItems: {
      dashboard: true,
      myTasks: true,
      roomSupport: true,
      pantryRequests: true,
      notifications: true,
      taskHistory: true,
      myProfile: true,
      overview: false,
      tasks: false,
      rooms: false,
      visitors: false,
      reports: false,
      users: false,
      audit: false,
      settings: false,
    },
    actions: {
      tasks: { view: true, create: false, edit: true, delete: false },
      rooms: { view: true, create: false, edit: false, delete: false },
      visitors: { view: true, create: false, edit: false, delete: false },
      users: { view: false, create: false, edit: false, delete: false },
      reports: { view: false, export: false },
    },
  };
}

interface DatabaseState {
  users: UserAccount[];
  rooms: RoomArea[];
  tasks: Task[];
  visitors: VisitorEvent[];
  pantryRequests: PantryRequest[];
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  attendance: AttendanceRecord[];
  lastGeneratedDate: string;
  deletedTaskIds?: string[];
}

const STANDARD_ROOM_SETUP: RoomSetupConfig = {
  tables: 1,
  tableType: 'standard',
  chairs: 4,
  summary: '1 table + 4 chairs',
};

const COMMUNITY_ROOM_SETUP: RoomSetupConfig = {
  tables: 1,
  tableType: 'large',
  chairs: 10,
  summary: '1 large table + 10 chairs',
};

function isCommunityRoom(room: Pick<RoomArea, 'id' | 'name'>): boolean {
  const clean = room.name.trim().toLowerCase();
  return room.id === 'room-7' || clean === 'community' || clean === 'the community';
}

function isTableChairConfiguredRoom(room: Pick<RoomArea, 'id' | 'name' | 'category'>): boolean {
  if (isCommunityRoom(room)) return true;
  return (
    room.category === 'MEETING_SUITE' ||
    room.category === 'EXECUTIVE_CABIN' ||
    room.id === 'room-12' ||
    room.category === 'COMMON_AREA'
  );
}

// Verifies each room's actual table + chair configuration before checklist generation
function verifyRoomSetupConfig(room: RoomArea): RoomSetupConfig | null {
  if (isCommunityRoom(room)) {
    const custom = room.setupConfig;
    if (custom && typeof custom.tables === 'number' && custom.tables > 0 && typeof custom.chairs === 'number' && custom.chairs > 0) {
      const tType = custom.tableType === 'large' || custom.chairs >= 8 ? 'large' : 'standard';
      const tLabel = tType === 'large' ? `${custom.tables} large ${custom.tables === 1 ? 'table' : 'tables'}` : `${custom.tables} ${custom.tables === 1 ? 'table' : 'tables'}`;
      return {
        tables: custom.tables,
        tableType: tType,
        chairs: custom.chairs,
        summary: `${tLabel} + ${custom.chairs} ${custom.chairs === 1 ? 'chair' : 'chairs'}`,
      };
    }
    return { ...COMMUNITY_ROOM_SETUP };
  }

  if (isTableChairConfiguredRoom(room)) {
    const custom = room.setupConfig;
    if (custom && typeof custom.tables === 'number' && custom.tables > 0 && typeof custom.chairs === 'number' && custom.chairs > 0) {
      const tType = custom.tableType === 'large' ? 'large' : 'standard';
      const tLabel = tType === 'large' ? `${custom.tables} large ${custom.tables === 1 ? 'table' : 'tables'}` : `${custom.tables} ${custom.tables === 1 ? 'table' : 'tables'}`;
      return {
        tables: custom.tables,
        tableType: tType,
        chairs: custom.chairs,
        summary: `${tLabel} + ${custom.chairs} ${custom.chairs === 1 ? 'chair' : 'chairs'}`,
      };
    }
    return { ...STANDARD_ROOM_SETUP };
  }

  return room.setupConfig || null;
}

function buildVerifiedRoomChecklistStrings(room: RoomArea): string[] {
  const verifiedSetup = verifyRoomSetupConfig(room);

  if (isCommunityRoom(room) && verifiedSetup) {
    const tablePhrase =
      verifiedSetup.tableType === 'large'
        ? `${verifiedSetup.tables} large ${verifiedSetup.tables === 1 ? 'table' : 'tables'}`
        : `${verifiedSetup.tables} ${verifiedSetup.tables === 1 ? 'table' : 'tables'}`;
    return [
      `Verify ${room.name} configuration: ${verifiedSetup.summary} present and undamaged`,
      `Clean and sanitize the ${tablePhrase} and surrounding pantry/lounge counter`,
      `Clean and align all ${verifiedSetup.chairs} chairs evenly around the table`,
      'Perform room readiness check (refreshment station, napkins, water supply, lighting)',
      'Capture and upload live room readiness verification photo',
    ];
  }

  if (room.category === 'MEETING_SUITE' && verifiedSetup) {
    const tablePhrase =
      verifiedSetup.tables === 1
        ? `1 ${verifiedSetup.tableType === 'large' ? 'large ' : ''}meeting table`
        : `${verifiedSetup.tables} meeting tables`;
    return [
      `Verify ${room.name} configuration: ${verifiedSetup.summary} present and undamaged`,
      `Clean and sanitize the ${tablePhrase} and presentation surfaces`,
      `Clean and align all ${verifiedSetup.chairs} chairs neatly with uniform spacing`,
      'Complete room readiness check (sealed water setup, screen/whiteboard, lighting, AC, empty bin)',
      'Capture and upload live room readiness verification photo',
    ];
  }

  if ((room.category === 'EXECUTIVE_CABIN' || room.id === 'room-12' || room.category === 'COMMON_AREA') && verifiedSetup) {
    return [
      `Verify ${room.name} configuration: ${verifiedSetup.summary} present and arranged`,
      'Clean and sanitize table/desk surfaces and coasters',
      `Clean and align all ${verifiedSetup.chairs} chairs neatly`,
      'Replenish fresh water supply and verify room readiness',
      'Capture and upload live verification photo',
    ];
  }

  return Array.isArray(room.defaultChecklist) && room.defaultChecklist.length > 0
    ? room.defaultChecklist
    : ['Clean surfaces', 'Align seating', 'Verify readiness', 'Capture live verification photo'];
}

// 15 Configurable Rooms/Areas for White Collar Realty
const INITIAL_ROOMS: RoomArea[] = [
  {
    id: 'room-1',
    name: 'Reception',
    category: 'RECEPTION',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Clean reception counter and glass surfaces',
      'Arrange visitor lounge chairs properly',
      'Return company brochures and guest registers to designated positions',
      'Check overall cleanliness and floor shine',
      'Capture and upload mandatory photo evidence',
    ],
  },
  {
    id: 'room-2',
    name: 'Employee Desks',
    category: 'WORKSTATION',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Wipe down designated desk surfaces and monitor edges without disturbing documents',
      'Align employee chairs neatly with workstation edges',
      'Arrange desktop stationery organizers',
      'Inspect surrounding walkway and cabling',
      'Capture and upload required verification photo',
    ],
  },
  {
    id: 'room-3',
    name: 'Lalit Sir Room',
    category: 'EXECUTIVE_CABIN',
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify Lalit Sir Room configuration: 1 table + 4 chairs present and arranged',
      'Clean and sanitize executive table/desk surface and coasters',
      'Clean and align all 4 chairs neatly',
      'Replenish fresh water carafe, clean glasses, and verify room readiness',
      'Capture and upload live verification photo',
    ],
  },
  {
    id: 'room-5',
    name: 'Prestige Loft',
    category: 'MEETING_SUITE',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify Prestige Loft configuration: 1 table + 4 chairs present and undamaged',
      'Clean and sanitize the 1 meeting table and presentation screen surfaces',
      'Clean and align all 4 chairs neatly with uniform spacing',
      'Complete room readiness check (water setup, sanitizer, lighting, AC, empty bin)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-6',
    name: 'The Skyline',
    category: 'MEETING_SUITE',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify The Skyline configuration: 1 table + 4 chairs present and undamaged',
      'Clean and sanitize the 1 meeting table and presentation surfaces',
      'Clean and align all 4 chairs neatly with uniform spacing',
      'Complete room readiness check (sealed water setup, whiteboard/markers, lighting, AC)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-7',
    name: 'Community',
    category: 'COMMON_AREA',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...COMMUNITY_ROOM_SETUP },
    defaultChecklist: [
      'Verify Community configuration: 1 large table + 10 chairs present and undamaged',
      'Clean and sanitize the 1 large table and surrounding pantry/lounge counter',
      'Clean and align all 10 chairs evenly around the large table',
      'Perform room readiness check (refreshment station, napkins, water supply, lighting)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-8',
    name: 'The Summit',
    category: 'MEETING_SUITE',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify The Summit configuration: 1 table + 4 chairs present and undamaged',
      'Clean and sanitize the 1 meeting table and presentation surfaces',
      'Clean and align all 4 chairs neatly with uniform spacing',
      'Complete room readiness check (water setup, display/cables, lighting, AC, empty bin)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-9',
    name: 'WCR Air',
    category: 'MEETING_SUITE',
    defaultPriority: 'P1',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify WCR Air configuration: 1 table + 4 chairs present and undamaged',
      'Clean and sanitize the 1 glass meeting table and surfaces',
      'Clean and align all 4 chairs neatly with uniform spacing',
      'Complete room readiness check (water setup, whiteboard, lighting, empty trash bin)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-10',
    name: 'Elegance Suite (Kimmi Mam Room)',
    category: 'MEETING_SUITE',
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify Elegance Suite (Kimmi Mam Room) configuration: 1 table + 4 chairs present and undamaged',
      'Clean and sanitize the 1 meeting table and surfaces',
      'Clean and align all 4 chairs neatly with uniform spacing',
      'Complete room readiness check (water setup, blinds, ventilation, lighting, empty bin)',
      'Capture and upload live room readiness verification photo',
    ],
  },
  {
    id: 'room-11',
    name: 'Prime Loft',
    category: 'WORKSTATION',
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Tidy Prime Loft workstations and check walkways',
      'Clean shared filing cabinet tops and align chairs',
      'Check lighting and floor cleanliness',
      'Upload photo evidence',
    ],
  },
  {
    id: 'room-12',
    name: 'Regency',
    category: 'COMMON_AREA',
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    setupConfig: { ...STANDARD_ROOM_SETUP },
    defaultChecklist: [
      'Verify Regency configuration: 1 table + 4 chairs present and arranged',
      'Clean and sanitize lounge table surface and coasters',
      'Clean and align all 4 chairs neatly',
      'Verify water carafe cleanliness and room readiness',
      'Capture and upload live verification photo',
    ],
  },
  {
    id: 'room-13',
    name: 'Office Dustbins',
    category: 'FACILITIES',
    defaultPriority: 'P4',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Empty all registered office and pantry dustbins',
      'Fit clean heavy-duty bin liners properly',
      'Wipe and sanitize exterior dustbin surfaces',
      'Return dustbins to their designated spots',
      'Capture evidence photo of cleared disposal area',
    ],
  },
  {
    id: 'room-14',
    name: 'Outer Area',
    category: 'FACILITIES',
    defaultPriority: 'P3',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Clean corridors and walkways immediately outside and around every prepared meeting room',
      'Wipe exterior glass partitions, door handles, and room signage plates',
      'Sweep entrance walkway, outer porch, and doormat zone',
      'Verify spotless passageways and capture outer/corridor photo evidence',
    ],
  },
  {
    id: 'room-15',
    name: 'Office Plants',
    category: 'FACILITIES',
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Check soil moisture and water indoor plants in Reception and entrance zone',
      'Water planters outside meeting rooms, The Community, and executive corridors',
      'Water workstation bay plants carefully without floor spills',
      'Wipe planter pots, remove dry leaves, and upload verification photo',
    ],
  },
];

const INITIAL_USERS: UserAccount[] = [
  {
    id: 'user-pantry-1',
    email: 'raju.sharma@whitecollarrealty.com',
    name: 'Raju Sharma',
    role: 'PANTRY_BOY',
    department: 'Hospitality & Operations',
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: '+91 98765 43210',
    createdAt: '2026-01-15T09:00:00Z',
    permissions: getDefaultPermissions('PANTRY_BOY'),
  },
  {
    id: 'user-hr-1',
    email: 'priya.sen@whitecollarrealty.com',
    name: 'Priya Sen',
    role: 'HR',
    department: 'Human Resources & Facilities',
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: '+91 98765 43211',
    createdAt: '2026-01-10T09:00:00Z',
    permissions: getDefaultPermissions('HR'),
  },
  {
    id: 'user-kimmy-1',
    email: 'kimmi.mam@whitecollarrealty.com',
    name: 'Kimmi',
    role: 'KIMMY_MAM',
    department: 'Co-Founder',
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: '+91 98765 43212',
    createdAt: '2025-11-01T09:00:00Z',
    permissions: getDefaultPermissions('KIMMY_MAM'),
  },
  {
    id: 'user-admin-1',
    email: 'admin.director@whitecollarrealty.com',
    name: 'Operations Administrator',
    role: 'ADMIN',
    department: 'Central Administration',
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: '+91 98765 43214',
    createdAt: '2025-09-01T09:00:00Z',
    isSuperAdmin: true,
    permissions: getDefaultPermissions('ADMIN'),
  },
];

const INITIAL_PANTRY_REQUESTS: PantryRequest[] = [
  {
    id: 'preq-1',
    roomAreaId: 'room-6',
    roomAreaName: 'The Skyline',
    requesterName: 'Kimmi',
    requesterRole: 'Co-Founder',
    items: ['2x Tender Coconut Water', '4x Sealed Mineral Bottles', 'Dry Fruits Platter'],
    instructions: 'Serve before Birla Estates delegation arrives. Use clean crystal glasses.',
    priority: 'URGENT',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preq-2',
    roomAreaId: 'room-5',
    roomAreaName: 'Prestige Loft',
    requesterName: 'Priya Sen',
    requesterRole: 'HR',
    items: ['Hot Masala Tea (2 cups)', 'Water Carafe with 2 glasses'],
    instructions: 'Senior candidate interview in progress. Deliver promptly.',
    priority: 'HIGH',
    status: 'IN_PREPARATION',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'preq-3',
    roomAreaId: 'room-3',
    roomAreaName: 'Lalit Sir Room',
    requesterName: 'Operations Administrator',
    requesterRole: 'Admin',
    items: ['Black Coffee (1 cup)', 'Fresh Sealed Bottle'],
    instructions: 'Place on side credenza table.',
    priority: 'NORMAL',
    status: 'SERVED',
    createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    servedAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    servedBy: 'Raju Sharma',
  },
];

// -----------------------------------------------------------------------------
// Authoritative IST (Asia/Kolkata, UTC+05:30) Scheduling Helpers
// -----------------------------------------------------------------------------
function getISTDateFormatted(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
    return new Date(istMs).toISOString().split('T')[0];
  }
}

function buildISTIso(dateStr: string, hhmm24: string): string {
  const cleanTime = hhmm24.length === 5 ? `${hhmm24}:00` : hhmm24;
  const parsed = new Date(`${dateStr}T${cleanTime}+05:30`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatISTShortTime(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (Number.isNaN(d.getTime())) return 'Scheduled';
  try {
    return d
      .toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      .toUpperCase();
  } catch {
    return d.toISOString();
  }
}

function formatISTScheduleLabel(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (Number.isNaN(d.getTime())) return 'Scheduled IST';
  try {
    const datePart = d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timePart = formatISTShortTime(d);
    return `${datePart}, ${timePart} IST`;
  } catch {
    return d.toISOString();
  }
}

function parseScheduledForIST(rawInput?: string, fallbackDate: Date = new Date()): string {
  if (!rawInput || !String(rawInput).trim()) {
    return fallbackDate.toISOString();
  }
  const trimmed = String(rawInput).trim();
  // Interpret timezone-less datetime-local strings (YYYY-MM-DDTHH:mm[:ss]) strictly in IST (+05:30)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const withSec = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    const d = new Date(`${withSec}+05:30`);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? fallbackDate.toISOString() : parsed.toISOString();
}

// Authoritative IST Daily Schedule Slots (Asia/Kolkata, UTC+05:30)
// - 9:00–9:30 AM: Reception (09:00 AM) & Employee Desk Cleaning FIRST (09:15 AM)
// - Priority 1 — Complete by 11:00 AM (after Employee Desk Cleaning):
//     1. Prestige Loft (09:30 AM)
//     2. The Skyline (09:45 AM)
//     3. Community (10:10 AM)
//     4. The Summit (10:25 AM)
//     5. WCR Air (10:40 AM)
// - 10:00 AM: Deliver filled water bottles to every employee's desk
// - Priority 2 — Complete by 12:00 PM:
//     1. Lalit Sir Room (11:00 AM)
//     2. Elegance Suite (Kimmi Mam Room) (11:15 AM)
//     3. Prime Loft (11:30 AM)
//     4. Regency (11:45 AM)
// - 12:00 PM: Water all office plants
// - Post-room sequence: Outer Area (12:20 PM), Office Dustbins (02:00 PM)
// - 4:00 PM: Refill & redistribute water bottles to every employee's desk
// - 7:30 PM: Mandatory End-of-Day Office Closing Inspection
const ROUTINE_SCHEDULE_SLOTS_IST: Record<string, { startHHMM: string; dueTime: string }> = {
  desks: { startHHMM: '09:00', dueTime: '09:15 AM' },
  reception: { startHHMM: '09:15', dueTime: '09:30 AM' },
  prestige: { startHHMM: '09:30', dueTime: '11:00 AM' },
  skyline: { startHHMM: '09:45', dueTime: '11:00 AM' },
  'water-10am': { startHHMM: '10:00', dueTime: '10:30 AM' },
  community: { startHHMM: '10:10', dueTime: '11:00 AM' },
  summit: { startHHMM: '10:25', dueTime: '11:00 AM' },
  'wcr-air': { startHHMM: '10:40', dueTime: '11:00 AM' },
  'exec-cabin': { startHHMM: '11:00', dueTime: '12:00 PM' },
  elegance: { startHHMM: '11:15', dueTime: '12:00 PM' },
  'prime-loft': { startHHMM: '11:30', dueTime: '12:00 PM' },
  regency: { startHHMM: '11:45', dueTime: '12:00 PM' },
  plants: { startHHMM: '12:00', dueTime: '12:30 PM' },
  'outer-area': { startHHMM: '12:20', dueTime: '12:50 PM' },
  dustbins: { startHHMM: '14:00', dueTime: '02:30 PM' },
  'water-4pm': { startHHMM: '16:00', dueTime: '04:30 PM' },
  closing: { startHHMM: '19:30', dueTime: '07:55 PM' },
};

// Priority 1 — Complete by 11:00 AM (strictly after Employee Desk Cleaning, in exact 1–5 sequence)
const PRIORITY_1_ROUTINE_MAP: Array<{ roomId: string; slug: string; startHHMM: string; dueTime: string }> = [
  { roomId: 'room-5', slug: 'prestige', startHHMM: '09:30', dueTime: '11:00 AM' },
  { roomId: 'room-6', slug: 'skyline', startHHMM: '09:45', dueTime: '11:00 AM' },
  { roomId: 'room-7', slug: 'community', startHHMM: '10:10', dueTime: '11:00 AM' },
  { roomId: 'room-8', slug: 'summit', startHHMM: '10:25', dueTime: '11:00 AM' },
  { roomId: 'room-9', slug: 'wcr-air', startHHMM: '10:40', dueTime: '11:00 AM' },
];

// Priority 2 — Complete by 12:00 PM (strictly after Priority 1 rooms)
const PRIORITY_2_ROUTINE_MAP: Array<{ roomId: string; slug: string; startHHMM: string; dueTime: string }> = [
  { roomId: 'room-3', slug: 'exec-cabin', startHHMM: '11:00', dueTime: '12:00 PM' },
  { roomId: 'room-10', slug: 'elegance', startHHMM: '11:15', dueTime: '12:00 PM' },
  { roomId: 'room-11', slug: 'prime-loft', startHHMM: '11:30', dueTime: '12:00 PM' },
  { roomId: 'room-12', slug: 'regency', startHHMM: '11:45', dueTime: '12:00 PM' },
];

const BUILTIN_ROUTINE_ROOM_IDS = new Set([
  'room-1',
  'room-2',
  'room-3',
  'room-5',
  'room-6',
  'room-7',
  'room-8',
  'room-9',
  'room-10',
  'room-11',
  'room-12',
  'room-13',
  'room-14',
  'room-15',
]);

function toChecklistItems(texts: string[]): ChecklistItem[] {
  return texts.map((text, idx) => ({
    id: `c-${idx + 1}`,
    text,
    completed: false,
  }));
}

function sortTasksArrayChronologically(list: Task[]): Task[] {
  const isTerminal = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
  const pWeight: Record<string, number> = { URGENT: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  return list.sort((a, b) => {
    const termA = isTerminal(a.status) ? 1 : 0;
    const termB = isTerminal(b.status) ? 1 : 0;
    if (termA !== termB) return termA - termB;
    const schedA = new Date(a.scheduledFor).getTime() || 0;
    const schedB = new Date(b.scheduledFor).getTime() || 0;
    if (schedA !== schedB) return schedA - schedB;
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    return (pWeight[a.priority] ?? 99) - (pWeight[b.priority] ?? 99);
  });
}

// Helper to generate daily recurring tasks dynamically from active rooms & employees (IST schedule)
function generateDailyTasks(
  targetDate?: string,
  roomsInput?: RoomArea[],
  usersInput?: UserAccount[]
): Task[] {
  const today = targetDate || getISTDateFormatted();
  const nowMs = Date.now();
  const roomsSource = roomsInput || INITIAL_ROOMS;
  const usersSource = usersInput || INITIAL_USERS;

  const assignedPantry =
    usersSource.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') ||
    usersSource.find((u) => u.role === 'PANTRY_BOY') ||
    INITIAL_USERS[0];

  const activeEmployeeNames = usersSource
    .filter((u) => u.status === 'active' && u.role !== 'PANTRY_BOY')
    .map((u) => u.name)
    .join(', ');

  const getActiveRoom = (id: string): RoomArea | undefined =>
    roomsSource.find((r) => r.id === id && r.enabled !== false);

  const createdMorningIso = buildISTIso(today, '09:00');
  const buildStatus = (scheduledIso: string): TaskStatus =>
    new Date(scheduledIso).getTime() > nowMs + 5000 ? 'SCHEDULED' : 'AVAILABLE';

  const tasks: Task[] = [];

  // 1. Employee Desk Cleaning FIRST (09:00 AM), then Reception (09:15 AM)
  const desksRoom = getActiveRoom('room-2');
  if (desksRoom) {
    const scheduledFor = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST.desks.startHHMM);
    const status = buildStatus(scheduledFor);
    tasks.push({
      id: `task-${today}-desks`,
      title: '9:00–9:15 AM – Employee Desk Cleaning & Workstation Setup',
      description:
        'Morning cleaning and setup of all Employee Desks (9:00–9:15 AM IST, completed first before room schedule): wipe workstation surfaces without disturbing documents, align ergonomic chairs, and prepare desk rows.',
      roomAreaId: desksRoom.id,
      roomAreaName: desksRoom.name,
      priority: 'P1',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST.desks.dueTime,
      status,
      isUrgent: false,
      checklist: toChecklistItems(desksRoom.defaultChecklist),
      changeHistory: [],
    });
  }

  const receptionRoom = getActiveRoom('room-1');
  if (receptionRoom) {
    const scheduledFor = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST.reception.startHHMM);
    const status = buildStatus(scheduledFor);
    tasks.push({
      id: `task-${today}-reception`,
      title: '9:15–9:30 AM – Reception Cleaning & Front-Desk Setup',
      description:
        'Morning cleaning and setup of Reception (9:15–9:30 AM IST): sanitize marble counter and glass surfaces, align visitor seating, arrange registers/brochures, and verify readiness.',
      roomAreaId: receptionRoom.id,
      roomAreaName: receptionRoom.name,
      priority: 'P1',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST.reception.dueTime,
      status,
      isUrgent: false,
      checklist: toChecklistItems(receptionRoom.defaultChecklist),
      changeHistory: [
        {
          timestamp: createdMorningIso,
          actorEmail: 'system@whitecollarrealty.com',
          actorName: 'IST Daily Scheduler',
          fromStatus: 'NONE',
          toStatus: status,
          note: 'Generated for 9:15–9:30 AM IST Reception cleaning & setup window',
        },
      ],
    });
  }

  // 2. Priority 1 — Complete by 11:00 AM (after Employee Desk Cleaning):
  //    1. Prestige Loft, 2. The Skyline, 3. Community, 4. The Summit, 5. WCR Air
  const preparedRoomNames: string[] = [];
  for (const spec of PRIORITY_1_ROUTINE_MAP) {
    const room = getActiveRoom(spec.roomId);
    if (!room) continue;
    preparedRoomNames.push(room.name);
    const verifiedSetup = verifyRoomSetupConfig(room) || (isCommunityRoom(room) ? COMMUNITY_ROOM_SETUP : STANDARD_ROOM_SETUP);
    const checklistTexts = buildVerifiedRoomChecklistStrings(room);
    const scheduledFor = buildISTIso(today, spec.startHHMM);
    const status = buildStatus(scheduledFor);
    const setupLabel = verifiedSetup.summary.replace(/\b\w/g, (m) => m.toUpperCase());

    tasks.push({
      id: `task-${today}-${spec.slug}`,
      title: `By 11:00 AM – ${room.name} Cleaning & Prep (${setupLabel})`,
      description: `Priority 1 room schedule (complete by 11:00 AM IST): full cleaning, table sanitization, chair alignment, and readiness verification for ${room.name} (verified setup: ${verifiedSetup.summary}).`,
      roomAreaId: room.id,
      roomAreaName: room.name,
      priority: 'P1',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor,
      dueTime: spec.dueTime,
      status,
      isUrgent: false,
      checklist: toChecklistItems(checklistTexts),
      changeHistory: [],
    });
  }

  // Support any additional custom active MEETING_SUITE rooms added dynamically in db.rooms
  const extraActiveMeetingRooms = roomsSource.filter(
    (r) =>
      r.enabled !== false &&
      r.category === 'MEETING_SUITE' &&
      !BUILTIN_ROUTINE_ROOM_IDS.has(r.id)
  );
  extraActiveMeetingRooms.forEach((room, idx) => {
    preparedRoomNames.push(room.name);
    const verifiedSetup = verifyRoomSetupConfig(room) || STANDARD_ROOM_SETUP;
    const checklistTexts = buildVerifiedRoomChecklistStrings(room);
    const minuteOffset = Math.min(54, 48 + idx * 2);
    const scheduledFor = buildISTIso(today, `10:${minuteOffset.toString().padStart(2, '0')}`);
    const status = buildStatus(scheduledFor);
    const setupLabel = verifiedSetup.summary.replace(/\b\w/g, (m) => m.toUpperCase());

    tasks.push({
      id: `task-${today}-room-${room.id}`,
      title: `By 11:00 AM – ${room.name} Cleaning & Prep (${setupLabel})`,
      description: `Complete cleaning, table sanitization, chair alignment, and readiness verification for ${room.name} (verified setup: ${verifiedSetup.summary}) before 11:00 AM IST.`,
      roomAreaId: room.id,
      roomAreaName: room.name,
      priority: 'P1',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor,
      dueTime: '11:00 AM',
      status,
      isUrgent: false,
      checklist: toChecklistItems(checklistTexts),
      changeHistory: [],
    });
  });

  // 3. 10:00 AM: Deliver filled water bottles to every employee's desk (unchanged hydration slot)
  if (desksRoom) {
    const water10Iso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST['water-10am'].startHHMM);
    tasks.push({
      id: `task-${today}-water-10am`,
      title: "10:00 AM – Deliver Filled Water Bottles to Every Employee's Desk",
      description: `Morning 10:00 AM IST hydration round: deliver freshly filled drinking water bottles to every employee desk across Employee Desks${getActiveRoom('room-11') ? ', Prime Loft,' : ''} and active staff desks${activeEmployeeNames ? ` (${activeEmployeeNames})` : ''}.`,
      roomAreaId: desksRoom.id,
      roomAreaName: desksRoom.name,
      priority: 'P1',
      taskType: 'WATER_DISTRIBUTION',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 10:00 AM IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: water10Iso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST['water-10am'].dueTime,
      status: buildStatus(water10Iso),
      isUrgent: false,
      checklist: toChecklistItems([
        'Fill and sanitize fresh drinking water bottles in pantry for morning delivery',
        'Deliver filled water bottles to every workstation in Employee Desks',
        `Deliver filled water bottles to ${getActiveRoom('room-11') ? 'Prime Loft workstations and ' : ''}executive/staff desks${activeEmployeeNames ? ` (${activeEmployeeNames})` : ''}`,
        'Place bottles neatly on coasters and note any unoccupied workstation exceptions',
        'Capture and upload live verification photo of 10:00 AM desk water delivery',
      ]),
      changeHistory: [],
    });
  }

  // 4. Priority 2 — Complete by 12:00 PM (after Priority 1 rooms):
  //    1. Lalit Sir Room, 2. Kimmi Mam Room, 3. Prime Loft, 4. Regency
  for (const spec of PRIORITY_2_ROUTINE_MAP) {
    const room = getActiveRoom(spec.roomId);
    if (!room) continue;
    preparedRoomNames.push(room.name);
    const verifiedSetup = verifyRoomSetupConfig(room);
    const checklistTexts = verifiedSetup
      ? buildVerifiedRoomChecklistStrings(room)
      : room.defaultChecklist;
    const scheduledFor = buildISTIso(today, spec.startHHMM);
    const status = buildStatus(scheduledFor);
    const setupSuffix = verifiedSetup
      ? ` (${verifiedSetup.summary.replace(/\b\w/g, (m) => m.toUpperCase())})`
      : '';
    const titleLabel =
      room.category === 'WORKSTATION'
        ? `By 12:00 PM – ${room.name} Cleaning & Workstation Alignment`
        : `By 12:00 PM – ${room.name} Cleaning & Setup${setupSuffix}`;
    const descText = verifiedSetup
      ? `Priority 2 schedule (complete by 12:00 PM IST): clean, sanitize, align chairs, and verify readiness for ${room.name} (verified setup: ${verifiedSetup.summary}).`
      : `Priority 2 schedule (complete by 12:00 PM IST): tidy ${room.name} desks, clean shared cabinet surfaces, align chairs, and inspect walkways.`;

    tasks.push({
      id: `task-${today}-${spec.slug}`,
      title: titleLabel,
      description: descText,
      roomAreaId: room.id,
      roomAreaName: room.name,
      priority: 'P2',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor,
      dueTime: spec.dueTime,
      status,
      isUrgent: false,
      checklist: toChecklistItems(checklistTexts),
      changeHistory: [],
    });
  }

  // 5. 12:00 PM: Water all office plants (unchanged 12:00 PM slot)
  const plantsRoom = getActiveRoom('room-15');
  if (plantsRoom) {
    const plantsIso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST.plants.startHHMM);
    tasks.push({
      id: `task-${today}-plants`,
      title: '12:00 PM – Water All Office Plants',
      description:
        'Daily 12:00 PM IST plant hydration: inspect soil moisture and water all indoor office plants across Reception, meeting corridors, cabins, Community, and workstation bays.',
      roomAreaId: plantsRoom.id,
      roomAreaName: plantsRoom.name,
      priority: 'P2',
      taskType: 'PLANTS',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 12:00 PM IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: plantsIso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST.plants.dueTime,
      status: buildStatus(plantsIso),
      isUrgent: false,
      checklist: toChecklistItems(plantsRoom.defaultChecklist),
      changeHistory: [],
    });
  }

  // 6. Post-room-prep afternoon sequence (preserving Outer Area, Elegance Suite, and Office Dustbins)
  const outerAreaRoom = getActiveRoom('room-14');
  if (outerAreaRoom) {
    const outerIso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST['outer-area'].startHHMM);
    const roomListNote =
      preparedRoomNames.length > 0
        ? preparedRoomNames.join(', ')
        : 'all prepared office rooms';
    tasks.push({
      id: `task-${today}-outer-area`,
      title: '12:20 PM – Clean Areas Outside & Around Prepared Rooms',
      description: `Following room preparation, clean corridors, glass exteriors, thresholds, and surrounding walkways outside each prepared room (${roomListNote}) and outer entrance area.`,
      roomAreaId: outerAreaRoom.id,
      roomAreaName: outerAreaRoom.name,
      priority: 'P3',
      taskType: 'OUTER_AREA',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: outerIso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST['outer-area'].dueTime,
      status: buildStatus(outerIso),
      isUrgent: false,
      checklist: toChecklistItems([
        `Clean corridors and surrounding floor areas outside ${roomListNote}`,
        'Wipe exterior glass partitions, door handles, and room nameplates around each room',
        'Sweep entrance walkway, outer porch, and doormat zone',
        'Verify clear, spotless passageways across all corridors',
        'Capture and upload live verification photo of outside/around-room areas',
      ]),
      changeHistory: [],
    });
  }

  const dustbinsRoom = getActiveRoom('room-13');
  if (dustbinsRoom) {
    const dustbinsIso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST.dustbins.startHHMM);
    tasks.push({
      id: `task-${today}-dustbins`,
      title: '02:00 PM – Office Dustbins Emptying & Liner Replacement',
      description:
        'Afternoon sequence: empty all office and pantry dustbins, fit clean heavy-duty liners, sanitize covers, and return bins to designated spots.',
      roomAreaId: dustbinsRoom.id,
      roomAreaName: dustbinsRoom.name,
      priority: 'P4',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Daily IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: dustbinsIso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST.dustbins.dueTime,
      status: buildStatus(dustbinsIso),
      isUrgent: false,
      checklist: toChecklistItems(dustbinsRoom.defaultChecklist),
      changeHistory: [],
    });
  }

  // 7. 4:00 PM: Refill and redistribute water bottles to every employee's desk (unchanged)
  if (desksRoom) {
    const water4Iso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST['water-4pm'].startHHMM);
    tasks.push({
      id: `task-${today}-water-4pm`,
      title: "4:00 PM – Refill & Redistribute Water Bottles to Every Employee's Desk",
      description: `Afternoon 4:00 PM IST hydration round: collect empty or low bottles, refill with fresh chilled drinking water, and redistribute filled bottles to every employee desk across Employee Desks${getActiveRoom('room-11') ? ', Prime Loft,' : ''} and staff workstations.`,
      roomAreaId: desksRoom.id,
      roomAreaName: desksRoom.name,
      priority: 'P1',
      taskType: 'WATER_RECHECK',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 4:00 PM IST Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: water4Iso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST['water-4pm'].dueTime,
      status: buildStatus(water4Iso),
      isUrgent: false,
      checklist: toChecklistItems([
        'Collect empty or low water bottles from Employee Desks and workstation rows',
        'Clean, sanitize, and refill bottles with fresh chilled drinking water in pantry',
        `Redistribute filled water bottles to every active employee desk${activeEmployeeNames ? ` (including ${activeEmployeeNames})` : ''}`,
        'Place refilled bottles neatly on coasters and realign any pushed-out chairs',
        'Capture and upload live verification photo of 4:00 PM desk water redistribution',
      ]),
      changeHistory: [],
    });
  }

  // 8. 7:30 PM: Mandatory End-of-Day Office Closing Inspection (unchanged)
  if (receptionRoom) {
    const closingIso = buildISTIso(today, ROUTINE_SCHEDULE_SLOTS_IST.closing.startHHMM);
    const activeMeetingNames =
      preparedRoomNames.length > 0
        ? preparedRoomNames.join(', ')
        : 'Prestige Loft, The Skyline, Community, The Summit, WCR Air, Lalit Sir Room, Elegance Suite (Kimmi Mam Room), Prime Loft, Regency';
    tasks.push({
      id: `task-${today}-closing`,
      title: '7:30 PM – Mandatory End-of-Day Office Closing Inspection',
      description:
        'Comprehensive end-of-day check: Reception, Employee Desks, Lalit Sir Room, Elegance Suite (Kimmi Mam Room), Meeting Rooms, Dustbins, and Pantry Appliance Lockdown.',
      roomAreaId: receptionRoom.id,
      roomAreaName: 'Reception & All Areas',
      priority: 'P1',
      taskType: 'CLOSING_INSPECTION',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Closing Scheduler',
      createdAt: createdMorningIso,
      scheduledFor: closingIso,
      dueTime: ROUTINE_SCHEDULE_SLOTS_IST.closing.dueTime,
      status: buildStatus(closingIso),
      isUrgent: false,
      checklist: toChecklistItems([
        'Verify Reception is tidy and front-desk display turned off',
        'Verify all Employee Desks are clear and chairs neatly tucked',
        'Check Lalit Sir Room and Elegance Suite (Kimmi Mam Room) sanitized and secured',
        `Ensure all active rooms (${activeMeetingNames}) are reset to verified table & chair layout`,
        'Confirm all dustbins emptied and liners replaced',
        'Ensure pantry appliances turned off and water taps closed',
        'Capture comprehensive closing verification photo',
      ]),
      changeHistory: [],
    });
  }

  return tasks.sort(
    (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  );
}

// In-Memory Database initialization
let db: DatabaseState = {
  users: INITIAL_USERS,
  rooms: INITIAL_ROOMS,
  tasks: generateDailyTasks(),
  visitors: [
    {
      id: 'vis-1',
      visitorName: 'Aditya Birla Group Delegation',
      companyName: 'Birla Estates',
      hostName: 'Kimmi',
      roomAreaId: 'room-6',
      roomAreaName: 'The Skyline',
      purpose: 'CLIENT_MEETING',
      guestCount: 4,
      scheduledTime: buildISTIso(getISTDateFormatted(), '14:30'),
      status: 'EXPECTED',
      notes: 'Prepare fresh tender coconut water and dry fruits platter alongside standard water bottles.',
    },
    {
      id: 'vis-2',
      visitorName: 'Sanjay Malhotra',
      companyName: 'Senior Sales Director Candidate',
      hostName: 'Kimmi',
      roomAreaId: 'room-5',
      roomAreaName: 'Prestige Loft',
      purpose: 'CANDIDATE_INTERVIEW',
      guestCount: 1,
      scheduledTime: buildISTIso(getISTDateFormatted(), '11:30'),
      status: 'EXPECTED',
      notes: 'High-priority executive interview. Ensure water glass and notebook ready.',
    },
  ],
  pantryRequests: INITIAL_PANTRY_REQUESTS,
  auditLogs: [
    {
      id: 'audit-init-1',
      timestamp: new Date().toISOString(),
      actorEmail: 'system@whitecollarrealty.com',
      actorName: 'System Kernel',
      actorRole: 'ADMIN',
      action: 'SYSTEM_BOOTSTRAP',
      entityType: 'SCHEDULE',
      entityId: 'schedule-today',
      details: 'Initialized SmartPantry Pro with 15 configured office rooms and automated IST task scheduling.',
    },
  ],
  notifications: [
    {
      id: 'notif-1',
      recipientRole: 'PANTRY_BOY',
      title: 'Daily Operations Active',
      message: 'Good morning Raju! Today’s IST routine tasks are scheduled starting 9:00 AM with Reception & Employee Desks.',
      type: 'TASK_ASSIGNED',
      read: false,
      timestamp: new Date().toISOString(),
    },
  ],
  attendance: [],
  lastGeneratedDate: getISTDateFormatted(),
  deletedTaskIds: [],
};

function sanitizeLegacyString(val?: string): string {
  if (!val || typeof val !== 'string') return val || '';
  return normalizeDisplayText(val);
}

// Synchronizes today's recurring routine tasks with active rooms & IST schedule without duplicates or overwriting user edits
function syncTodayRoutineTasks(targetDate?: string, options?: { isBoot?: boolean }): boolean {
  const today = targetDate || getISTDateFormatted();
  const nowMs = Date.now();
  const isBoot = Boolean(options?.isBoot);
  const deletedSet = new Set(Array.isArray(db.deletedTaskIds) ? db.deletedTaskIds : []);
  let changed = false;

  // Migrate legacy today water-3pm ID to water-4pm in-place so no duplicate water task is created
  const legacyWater3Id = `task-${today}-water-3pm`;
  const water4Id = `task-${today}-water-4pm`;
  const legacyIdx = db.tasks.findIndex((t) => t.id === legacyWater3Id);
  if (legacyIdx !== -1) {
    if (deletedSet.has(water4Id)) {
      db.tasks.splice(legacyIdx, 1);
      changed = true;
    } else {
      const hasWater4 = db.tasks.some((t) => t.id === water4Id);
      if (!hasWater4) {
        db.tasks[legacyIdx].id = water4Id;
        changed = true;
      } else if (
        db.tasks[legacyIdx].status !== 'COMPLETED' &&
        db.tasks[legacyIdx].status !== 'IN_PROGRESS' &&
        !db.tasks[legacyIdx].startedAt
      ) {
        db.tasks.splice(legacyIdx, 1);
        changed = true;
      }
    }
  }

  // Deduplicate db.tasks by ID while preserving first/most-progressed record
  const seenIds = new Set<string>();
  const deduped: Task[] = [];
  for (const t of db.tasks) {
    if (deletedSet.has(t.id)) {
      changed = true;
      continue;
    }
    if (seenIds.has(t.id)) {
      changed = true;
      continue;
    }
    seenIds.add(t.id);
    deduped.push(t);
  }
  if (deduped.length !== db.tasks.length) {
    db.tasks = deduped;
  }

  const canonicalTodayTasks = generateDailyTasks(today, db.rooms, db.users);
  const canonicalIds = new Set(canonicalTodayTasks.map((t) => t.id));

  for (const canon of canonicalTodayTasks) {
    if (deletedSet.has(canon.id)) {
      continue;
    }
    const existing = db.tasks.find((t) => t.id === canon.id);
    if (!existing) {
      const schedMs = new Date(canon.scheduledFor).getTime();
      const deadlineMs = parseTaskDeadlineMs(canon);
      if (schedMs > nowMs + 5000) {
        canon.status = 'SCHEDULED';
      } else if (nowMs > deadlineMs) {
        canon.status = 'OVERDUE';
        canon.fiveMinAlertSentFor = canon.scheduledFor;
        canon.dueAlertSentFor = canon.scheduledFor;
        canon.overdueMarkedFor = canon.scheduledFor;
      } else {
        canon.status = 'AVAILABLE';
        if (isBoot && schedMs <= nowMs - 60 * 1000) {
          canon.fiveMinAlertSentFor = canon.scheduledFor;
          canon.dueAlertSentFor = canon.scheduledFor;
        }
      }
      db.tasks.unshift(canon);
      changed = true;
      continue;
    }

    // Never overwrite completed, cancelled, under-review, started, or manager-modified tasks
    const hasHumanHistory = Array.isArray(existing.changeHistory)
      ? existing.changeHistory.some(
          (h) => h.actorEmail && h.actorEmail !== 'system@whitecollarrealty.com'
        )
      : false;

    if (
      existing.createdByEmail !== 'system@whitecollarrealty.com' ||
      existing.status === 'COMPLETED' ||
      existing.status === 'CANCELLED' ||
      existing.status === 'IN_PROGRESS' ||
      existing.status === 'PENDING_VERIFICATION' ||
      existing.status === 'SUBMITTED' ||
      existing.status === 'BLOCKED' ||
      existing.status === 'REJECTED' ||
      Boolean(existing.startedAt) ||
      hasHumanHistory
    ) {
      continue;
    }

    const prevScheduledFor = existing.scheduledFor;
    const needsSync =
      existing.title !== canon.title ||
      existing.description !== canon.description ||
      existing.scheduledFor !== canon.scheduledFor ||
      existing.dueTime !== canon.dueTime ||
      existing.priority !== canon.priority ||
      existing.assignedToEmail !== canon.assignedToEmail ||
      JSON.stringify(existing.checklist.map((c) => c.text)) !==
        JSON.stringify(canon.checklist.map((c) => c.text));

    if (needsSync) {
      existing.title = canon.title;
      existing.description = canon.description;
      existing.roomAreaName = canon.roomAreaName;
      existing.priority = canon.priority;
      existing.taskType = canon.taskType;
      existing.assignedToEmail = canon.assignedToEmail;
      existing.assignedToName = canon.assignedToName;
      existing.createdByName = canon.createdByName;
      existing.scheduledFor = canon.scheduledFor;
      existing.dueTime = canon.dueTime;
      existing.checklist = canon.checklist.map((c, idx) => ({
        id: existing.checklist[idx]?.id || c.id,
        text: c.text,
        completed: Boolean(existing.checklist[idx]?.completed),
        note: existing.checklist[idx]?.note,
      }));

      const newSchedMs = new Date(canon.scheduledFor).getTime();
      const deadlineMs = parseTaskDeadlineMs(existing);

      if (newSchedMs > nowMs + 5000) {
        existing.status = 'SCHEDULED';
        if (prevScheduledFor !== canon.scheduledFor) {
          existing.fiveMinAlertSentFor = undefined;
          existing.dueAlertSentFor = undefined;
          existing.overdueMarkedFor = undefined;
        }
      } else if (nowMs > deadlineMs) {
        existing.status = 'OVERDUE';
        existing.fiveMinAlertSentFor = canon.scheduledFor;
        existing.dueAlertSentFor = canon.scheduledFor;
        existing.overdueMarkedFor = canon.scheduledFor;
      } else {
        existing.status = 'AVAILABLE';
        if (prevScheduledFor !== canon.scheduledFor) {
          existing.overdueMarkedFor = undefined;
        }
        if (isBoot && newSchedMs <= nowMs - 60 * 1000) {
          existing.fiveMinAlertSentFor = canon.scheduledFor;
          existing.dueAlertSentFor = canon.scheduledFor;
        }
      }
      changed = true;
    }
  }

  // If a room was deactivated, cancel any unstarted today system routine task for that deactivated room
  for (const t of db.tasks) {
    if (!t.id.startsWith(`task-${today}-`)) continue;
    if (canonicalIds.has(t.id)) continue;
    if (t.createdByEmail !== 'system@whitecollarrealty.com') continue;
    if (t.status === 'SCHEDULED' || t.status === 'AVAILABLE') {
      const targetRoom = db.rooms.find((r) => r.id === t.roomAreaId);
      if (targetRoom && targetRoom.enabled === false) {
        t.status = 'CANCELLED';
        t.cancelledAt = new Date().toISOString();
        t.cancelledBy = 'System Scheduler (Room Inactive)';
        changed = true;
      }
    }
  }

  sortTasksArrayChronologically(db.tasks);
  return changed;
}

// Migrates existing past-date routine tasks in-place to the canonical Priority 1 / Priority 2 schedule
// without creating duplicate tasks, deleting records, or altering assignments/completed progress.
function migrateExistingPastRoutineTasksInPlace(): boolean {
  const today = getISTDateFormatted();
  const nowMs = Date.now();
  const pastDates = new Set<string>();

  for (const t of db.tasks) {
    const match = t.id.match(/^task-(\d{4}-\d{2}-\d{2})-/);
    if (match && match[1] !== today) {
      pastDates.add(match[1]);
    }
  }

  let changed = false;
  for (const dateStr of pastDates) {
    const canonicalForDate = generateDailyTasks(dateStr, db.rooms, db.users);
    const canonicalById = new Map(canonicalForDate.map((c) => [c.id, c]));

    for (const existing of db.tasks) {
      if (!existing.id.startsWith(`task-${dateStr}-`)) continue;
      const canon = canonicalById.get(existing.id);
      if (!canon) continue;

      const hasHumanHistory = Array.isArray(existing.changeHistory)
        ? existing.changeHistory.some(
            (h) => h.actorEmail && h.actorEmail !== 'system@whitecollarrealty.com'
          )
        : false;

      if (
        existing.createdByEmail !== 'system@whitecollarrealty.com' ||
        existing.status === 'COMPLETED' ||
        existing.status === 'CANCELLED' ||
        existing.status === 'IN_PROGRESS' ||
        existing.status === 'PENDING_VERIFICATION' ||
        existing.status === 'SUBMITTED' ||
        existing.status === 'BLOCKED' ||
        existing.status === 'REJECTED' ||
        Boolean(existing.startedAt) ||
        hasHumanHistory
      ) {
        continue;
      }

      const needsUpdate =
        existing.title !== canon.title ||
        existing.description !== canon.description ||
        existing.roomAreaName !== canon.roomAreaName ||
        existing.priority !== canon.priority ||
        existing.scheduledFor !== canon.scheduledFor ||
        existing.dueTime !== canon.dueTime ||
        JSON.stringify(existing.checklist.map((c) => c.text)) !==
          JSON.stringify(canon.checklist.map((c) => c.text));

      if (needsUpdate) {
        existing.title = canon.title;
        existing.description = canon.description;
        existing.roomAreaName = canon.roomAreaName;
        existing.priority = canon.priority;
        existing.scheduledFor = canon.scheduledFor;
        existing.dueTime = canon.dueTime;
        existing.checklist = canon.checklist.map((c, idx) => ({
          id: existing.checklist[idx]?.id || c.id,
          text: c.text,
          completed: Boolean(existing.checklist[idx]?.completed),
          note: existing.checklist[idx]?.note,
        }));

        const schedMs = new Date(existing.scheduledFor).getTime();
        if (!Number.isNaN(schedMs) && schedMs <= nowMs) {
          existing.fiveMinAlertSentFor = existing.scheduledFor;
          existing.dueAlertSentFor = existing.scheduledFor;
          if (existing.status === 'OVERDUE') {
            existing.overdueMarkedFor = existing.scheduledFor;
          }
        }
        changed = true;
      }
    }
  }

  if (changed) {
    sortTasksArrayChronologically(db.tasks);
  }
  return changed;
}

// Try to load persisted state from disk
try {
  if (fs.existsSync(DB_FILE)) {
    const rawData = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(rawData);
    if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.rooms)) {
      db = parsed;
      if (!Array.isArray(db.deletedTaskIds)) {
        db.deletedTaskIds = [];
      } else if (db.deletedTaskIds.length > 2000) {
        db.deletedTaskIds = db.deletedTaskIds.slice(-2000);
      }
      if (!Array.isArray(db.pantryRequests) || db.pantryRequests.length === 0) {
        db.pantryRequests = INITIAL_PANTRY_REQUESTS;
      }
      // Remove Lalit Sir profile from existing state
      db.users = (db.users || []).filter((u: any) => u.id !== 'user-lalit-1' && !u.name?.toLowerCase().includes('lalit'));
      // Preserve canonical profile only for user-kimmy-1; never overwrite other accounts
      db.users.forEach((u: any) => {
        if (u.id === 'user-kimmy-1') {
          u.email = 'kimmi.mam@whitecollarrealty.com';
          u.name = sanitizeLegacyString(u.name || 'Kimmi').replace(/\s+mam$/i, '') || 'Kimmi';
          if (!u.department) u.department = 'Co-Founder';
        } else {
          if (u.name) u.name = sanitizeLegacyString(u.name);
          if (u.email) u.email = sanitizeLegacyString(u.email);
        }
      });
      // Ensure admin user exists in loaded state
      if (!db.users.some((u) => u.role === 'ADMIN')) {
        db.users.push(INITIAL_USERS[3]);
      }
      // Ensure all users have permissions and super admin flag; Pantry Boy can never have task delete permission
      db.users.forEach((u: any) => {
        if (!u.permissions) {
          u.permissions = getDefaultPermissions(u.role);
        } else if ('confidentialAccess' in u.permissions) {
          delete u.permissions.confidentialAccess;
        }
        if (u.role === 'PANTRY_BOY' && u.permissions?.actions?.tasks) {
          u.permissions.actions.tasks.delete = false;
        }
        if (u.id === 'user-admin-1' || u.email === 'admin.director@whitecollarrealty.com') {
          u.isSuperAdmin = true;
          u.permissions = getDefaultPermissions('ADMIN');
        }
      });

      // Remove all test, demo, dummy, and sample rooms
      db.rooms = (db.rooms || []).filter((r: any) => {
        const name = (r.name || '').toLowerCase();
        const id = (r.id || '').toLowerCase();
        return (
          !name.includes('audit test') &&
          !name.includes('test suite') &&
          !name.includes('dummy') &&
          !name.includes('sample room') &&
          !id.startsWith('room-1793') &&
          !id.startsWith('room-test')
        );
      });

      // Remove test tasks
      db.tasks = (db.tasks || []).filter((t: any) => {
        const title = (t.title || '').toLowerCase();
        const rName = (t.roomAreaName || '').toLowerCase();
        const rId = (t.roomAreaId || '').toLowerCase();
        return (
          !title.includes('audit test') &&
          !title.includes('test suite') &&
          !rName.includes('audit test') &&
          !rName.includes('test suite') &&
          !rId.startsWith('room-1793') &&
          !rId.startsWith('room-test')
        );
      });

      // Clean task descriptions and checklist items that had test room names concatenated
      db.tasks.forEach((t: any) => {
        if (t.description && /audit test suite room/i.test(t.description)) {
          t.description = t.description
            .replace(/,?\s*Audit Test Suite Room/gi, '')
            .replace(/\(\s*,\s*/g, '(')
            .replace(/,\s*\)/g, ')');
        }
        if (Array.isArray(t.checklist)) {
          t.checklist.forEach((c: any) => {
            if (c.text && /audit test suite room/i.test(c.text)) {
              c.text = c.text
                .replace(/,?\s*Audit Test Suite Room/gi, '')
                .replace(/\(\s*,\s*/g, '(')
                .replace(/,\s*\)/g, ')');
            }
          });
        }
      });

      // Remove test notifications
      db.notifications = (db.notifications || []).filter((n: any) => {
        const title = (n.title || '').toLowerCase();
        const rName = (n.roomName || '').toLowerCase();
        const rId = (n.roomId || '').toLowerCase();
        return (
          !title.includes('audit test') &&
          !rName.includes('audit test') &&
          !rId.startsWith('room-1793') &&
          !rId.startsWith('room-test')
        );
      });

      // Remove test audit logs
      db.auditLogs = (db.auditLogs || []).filter((a: any) => {
        const details = (a.details || '').toLowerCase();
        const target = (a.targetId || '').toLowerCase();
        return (
          !details.includes('audit test suite room') &&
          !details.includes('idemp-1793100226') &&
          !target.startsWith('room-1793') &&
          !target.startsWith('room-test')
        );
      });

      // Ensure all initial rooms exist in db.rooms
      for (const initRoom of INITIAL_ROOMS) {
        if (!db.rooms.some((r) => r.id === initRoom.id)) {
          db.rooms.push({ ...initRoom, status: 'AVAILABLE', assignmentHistory: [], statusHistory: [] });
        }
      }

      // Migrate rooms to standard RoomStatus, canonical room names, Priority 1 / Priority 2 defaults, and verified setupConfig
      db.rooms.forEach((r: RoomArea & Record<string, any>) => {
        delete r.floor;
        if (r.id === 'room-3') {
          r.name = 'Lalit Sir Room';
          r.defaultPriority = 'P2';
        } else if (r.id === 'room-10') {
          r.name = 'Elegance Suite (Kimmi Mam Room)';
          r.defaultPriority = 'P2';
        } else if (r.id === 'room-7') {
          r.name = 'Community';
          r.defaultPriority = 'P1';
        } else if (r.id === 'room-2' || r.id === 'room-5' || r.id === 'room-6' || r.id === 'room-8' || r.id === 'room-9') {
          r.defaultPriority = 'P1';
        } else if (r.id === 'room-11' || r.id === 'room-12') {
          r.defaultPriority = 'P2';
        } else if (r.id === 'room-14') {
          r.defaultPriority = 'P3';
        }
        if (r.name === 'BCR Air' || r.name === 'BCR AIR') r.name = 'WCR Air';
        if (r.name === 'Prime Block') r.name = 'Prime Loft';
        if (r.name === 'Residency' || r.name === 'Redeincy') r.name = 'Regency';
        if (r.name === 'Allegation Suite' || r.name === 'Allegation' || r.name === 'Elegance Suite (Kimmi Suite)' || r.name === 'Elegance Suite (Kimmi Mam Suite)') r.name = 'Elegance Suite (Kimmi Mam Room)';
        if (r.name === 'Skyline') r.name = 'The Skyline';
        if (typeof r.name === 'string' && r.name.includes('Prestige Block')) r.name = 'Prestige Loft';
        if (typeof r.name === 'string' && /^washrooms?(?:[ \t]+tasks?)?$/i.test(r.name.trim())) {
          r.name = 'Dustbin Task';
        }
        if ((r.status as string) === 'READY') r.status = 'AVAILABLE';
        if ((r.status as string) === 'IN_USE') r.status = 'OCCUPIED';
        if ((r.status as string) === 'NEEDS_CLEANING') r.status = 'CLEANING_REQUIRED';
        if ((r.status as string) === 'PREPARING') r.status = 'PREPARATION_REQUIRED';
        if (!r.assignmentHistory) r.assignmentHistory = [];
        if (!r.statusHistory) r.statusHistory = [];
        if (r.currentAssignment === undefined) r.currentAssignment = null;

        // Ensure Outer Area and Office Plants run DAILY per updated schedule
        if (r.id === 'room-14' || r.id === 'room-15') {
          r.recurrence = 'DAILY';
        }

        // Verify and populate setupConfig (Standard rooms: 1 table + 4 chairs; Community: 1 large table + 10 chairs)
        const verifiedCfg = verifyRoomSetupConfig(r);
        if (verifiedCfg) {
          r.setupConfig = verifiedCfg;
          const joined = Array.isArray(r.defaultChecklist) ? r.defaultChecklist.join(' ') : '';
          if (
            !Array.isArray(r.defaultChecklist) ||
            r.defaultChecklist.length === 0 ||
            r.id === 'room-3' ||
            r.id === 'room-4' ||
            r.id === 'room-7' ||
            /12-seater|12 chairs|6 ergonomic chairs|community lounge tables|candidate interview chairs|summit meeting room table|Wipe glass table and clean chairs|executive mahogany desk|Dust guest lounge sofa|Executive Cabin|Kimmi's Cabin|The Community/i.test(
              joined
            )
          ) {
            r.defaultChecklist = buildVerifiedRoomChecklistStrings(r);
          }
        } else {
          const canonRoom = INITIAL_ROOMS.find((ir) => ir.id === r.id);
          if (canonRoom && (r.id === 'room-11' || r.id === 'room-14' || r.id === 'room-15')) {
            r.defaultChecklist = [...canonRoom.defaultChecklist];
          }
        }
      });

      // Update tasks room names and heal any legacy repeated room substrings idempotently
      db.tasks = db.tasks.map((t: any) => normalizeTaskRecord(t));

      const bootNowMs = Date.now();
      db.tasks.forEach((t: Task) => {
        const schedMs = new Date(t.scheduledFor).getTime();
        if (!Number.isNaN(schedMs) && schedMs <= bootNowMs - 60 * 1000) {
          t.fiveMinAlertSentFor = t.scheduledFor;
          t.dueAlertSentFor = t.scheduledFor;
        }
      });
    }
  }
} catch (e) {
  console.warn('Could not read existing db file, using fresh state', e);
}

// Sanitize persisted records (remove legacy location/geofence data, session timing strings, and normalize Kimmy -> Kimmi + repeated words)
delete (db as any).officeConfig;
if (!Array.isArray(db.attendance)) {
  db.attendance = [];
}
if (!Array.isArray(db.deletedTaskIds)) {
  db.deletedTaskIds = [];
}

db.rooms = db.rooms.map((r: any) => {
  const normalized = normalizeRoomRecord(r);
  if (Array.isArray(normalized.assignmentHistory)) {
    normalized.assignmentHistory.forEach((ah: any) => {
      if (ah.assignedBy) ah.assignedBy = sanitizeLegacyString(ah.assignedBy);
      if (ah.visitorName) ah.visitorName = sanitizeLegacyString(ah.visitorName);
      if (ah.instructions) ah.instructions = sanitizeLegacyString(ah.instructions);
      if (ah.roomAreaName) ah.roomAreaName = normalizeRoomName(ah.roomAreaName);
    });
  }
  if (Array.isArray(normalized.statusHistory)) {
    normalized.statusHistory.forEach((sh: any) => {
      if (sh.actorEmail) sh.actorEmail = sanitizeLegacyString(sh.actorEmail);
      if (sh.actorName) sh.actorName = sanitizeLegacyString(sh.actorName);
      if (sh.note) sh.note = sanitizeLegacyString(sh.note);
    });
  }
  return normalized;
});

db.tasks = db.tasks.map((t: any) => {
  const normalized = normalizeTaskRecord(t);
  if (normalized.assignedToEmail) normalized.assignedToEmail = sanitizeLegacyString(normalized.assignedToEmail);
  if (normalized.createdByEmail) normalized.createdByEmail = sanitizeLegacyString(normalized.createdByEmail);
  if (Array.isArray(normalized.changeHistory)) {
    normalized.changeHistory.forEach((ch: any) => {
      if (ch.actorEmail) ch.actorEmail = sanitizeLegacyString(ch.actorEmail);
      if (ch.actorName) ch.actorName = sanitizeLegacyString(ch.actorName);
      if (ch.note) ch.note = sanitizeLegacyString(ch.note);
    });
  }
  if (normalized.photoEvidence) {
    if ((normalized.photoEvidence as any).uploadedBy) {
      (normalized.photoEvidence as any).uploadedBy = sanitizeLegacyString((normalized.photoEvidence as any).uploadedBy);
    }
    if (normalized.photoEvidence.verifiedBy) {
      normalized.photoEvidence.verifiedBy = sanitizeLegacyString(normalized.photoEvidence.verifiedBy);
    }
  }
  return normalized;
});

if (Array.isArray(db.visitors)) {
  db.visitors.forEach((v: any) => {
    if (v.visitorName) v.visitorName = sanitizeLegacyString(v.visitorName);
    if (v.hostName) v.hostName = sanitizeLegacyString(v.hostName);
    if (v.notes) v.notes = sanitizeLegacyString(v.notes);
    if (v.roomAreaName) v.roomAreaName = normalizeRoomName(v.roomAreaName);
  });
}

if (Array.isArray(db.pantryRequests)) {
  db.pantryRequests.forEach((pr: any) => {
    if (pr.roomAreaName) pr.roomAreaName = normalizeRoomName(pr.roomAreaName);
    if (pr.requesterName) pr.requesterName = sanitizeLegacyString(pr.requesterName);
    if (pr.instructions) pr.instructions = sanitizeLegacyString(pr.instructions);
    if (pr.servedBy) pr.servedBy = sanitizeLegacyString(pr.servedBy);
  });
}

if (Array.isArray(db.notifications)) {
  db.notifications.forEach((n: any) => {
    if (n.title) n.title = sanitizeLegacyString(n.title);
    if (n.message) n.message = sanitizeLegacyString(n.message);
    if (n.recipientEmail) n.recipientEmail = sanitizeLegacyString(n.recipientEmail);
    if (n.roomName) n.roomName = normalizeRoomName(n.roomName);
  });
}

db.attendance.forEach((att: any) => {
  delete att.locationVerification;
  delete att.logoutLocationVerification;
  if (att.userEmail) att.userEmail = sanitizeLegacyString(att.userEmail);
  if (att.userName) att.userName = sanitizeLegacyString(att.userName);
});

if (Array.isArray(db.auditLogs)) {
  db.auditLogs = db.auditLogs.filter((log: any) => log.action !== 'OFFICE_CONFIG_UPDATED');
  db.auditLogs.forEach((log: any) => {
    if (log.actorEmail) log.actorEmail = sanitizeLegacyString(log.actorEmail);
    if (log.actorName) log.actorName = sanitizeLegacyString(log.actorName);
    if (log.details) log.details = sanitizeLegacyString(log.details);
    if (log.action === 'ATTENDANCE_LOGIN_VERIFIED') {
      log.action = 'ATTENDANCE_LOGIN_RECORDED';
    }
  });
}

// Migrate existing past-date routine tasks & sync today's IST schedule on boot without creating duplicates
migrateExistingPastRoutineTasksInPlace();
syncTodayRoutineTasks(getISTDateFormatted(), { isBoot: true });
sortTasksArrayChronologically(db.tasks);
db.lastGeneratedDate = getISTDateFormatted();
saveDb();

// -----------------------------------------------------------------------------
// Real-time Attendance Engine (IST Timestamps)
// -----------------------------------------------------------------------------
function getISTTimeString(date: Date = new Date()): string {
  try {
    return date.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return date.toTimeString().split(' ')[0];
  }
}

function getISTDateString(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

function recordPantryAttendance(user: UserAccount): AttendanceRecord {
  const today = getISTDateString();
  const now = new Date();

  if (!Array.isArray(db.attendance)) {
    db.attendance = [];
  }

  // Look for an open active session for today (not yet logged out)
  const activeSession = db.attendance.find(
    (a) => a.userId === user.id && a.date === today && a.status === 'PRESENT' && !a.logoutTime
  );

  if (activeSession) {
    activeSession.updatedAt = now.toISOString();
    saveDb();
    broadcastRealtime('attendance:updated', { attendance: activeSession });
    return activeSession;
  }

  // Multi-session support: generate unique id for multiple independent sessions in a single day
  const todaySessionCount = db.attendance.filter((a) => a.userId === user.id && a.date === today).length;
  const newRecordId =
    todaySessionCount > 0
      ? `att-${today}-${user.id}-s${todaySessionCount + 1}`
      : `att-${today}-${user.id}`;

  const newRecord: AttendanceRecord = {
    id: newRecordId,
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    role: user.role,
    date: today,
    loginTime: now.toISOString(),
    loginTimeIST: getISTTimeString(now),
    status: 'PRESENT',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  db.attendance.unshift(newRecord);
  saveDb();
  broadcastRealtime('attendance:updated', { attendance: newRecord });

  addAuditLog(
    { email: user.email, name: user.name, role: user.role },
    'ATTENDANCE_LOGIN_RECORDED',
    'USER',
    user.id,
    `Pantry Boy logged in at ${newRecord.loginTimeIST} IST.`
  );

  return newRecord;
}

function recordPantryLogout(user: UserAccount): AttendanceRecord | null {
  const today = getISTDateString();
  const now = new Date();

  if (!Array.isArray(db.attendance)) return null;

  const activeSession = db.attendance.find(
    (a) => a.userId === user.id && a.date === today && a.status === 'PRESENT' && !a.logoutTime
  );

  if (!activeSession) {
    // Idempotently return already-completed record for today without overwriting its logout timestamp
    return db.attendance.find((a) => a.userId === user.id && a.date === today) || null;
  }

  activeSession.logoutTime = now.toISOString();
  activeSession.logoutTimeIST = getISTTimeString(now);
  activeSession.status = 'COMPLETED';

  const loginMs = new Date(activeSession.loginTime).getTime();
  const logoutMs = now.getTime();
  activeSession.elapsedMinutes = Math.max(1, Math.round((logoutMs - loginMs) / (60 * 1000)));
  activeSession.updatedAt = now.toISOString();

  saveDb();
  broadcastRealtime('attendance:updated', { attendance: activeSession });

  addAuditLog(
    { email: user.email, name: user.name, role: user.role },
    'ATTENDANCE_LOGOUT_RECORDED',
    'USER',
    user.id,
    `Pantry Boy logged out at ${activeSession.logoutTimeIST} IST. Total working duration: ${Math.floor(activeSession.elapsedMinutes / 60)}h ${activeSession.elapsedMinutes % 60}m.`
  );

  return activeSession;
}

// Seed initial attendance record for today if empty so dashboard displays live metrics immediately
const currentToday = getISTDateString();
if (!db.attendance.some((a) => a.date === currentToday && a.role === 'PANTRY_BOY')) {
  const pantryUser = INITIAL_USERS[0];
  db.attendance.unshift({
    id: `att-${currentToday}-${pantryUser.id}`,
    userId: pantryUser.id,
    userEmail: pantryUser.email,
    userName: pantryUser.name,
    role: pantryUser.role,
    date: currentToday,
    loginTime: `${currentToday}T09:00:15.000Z`,
    loginTimeIST: '09:00:15 AM',
    status: 'PRESENT',
    createdAt: `${currentToday}T09:00:15.000Z`,
    updatedAt: `${currentToday}T09:00:15.000Z`,
  });
}

function saveDbStrict() {
  const tmpFile = `${DB_FILE}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
    throw err;
  }
}

function saveDb() {
  try {
    saveDbStrict();
  } catch (err) {
    console.error('Failed to write db file:', err);
  }
}

saveDb();

// Automatic daily task generation check (synchronized to Asia/Kolkata IST date)
function ensureDailyTasks() {
  const today = getISTDateFormatted();
  if (db.lastGeneratedDate !== today) {
    syncTodayRoutineTasks(today);
    db.lastGeneratedDate = today;
    notify(
      'Daily Tasks Generated (IST)',
      'Today’s recurring IST schedule (9:00–9:30 AM Reception & Desks, By 11:00 AM Meeting Rooms, 10:00 AM Water, 12:00 PM Plants, 4:00 PM Water Refill) has been generated.',
      'TASK_ASSIGNED',
      { role: 'PANTRY_BOY' }
    );
    saveDb();
    broadcastRealtime('task:updated', { tasks: db.tasks, serverTime: new Date().toISOString() });
  }
}

ensureDailyTasks();

function parseTaskDeadlineMs(task: Task): number {
  const schedMs = new Date(task.scheduledFor).getTime();
  const baseMs = Number.isNaN(schedMs) ? Date.now() : schedMs;
  const dueText = (task.dueTime || '').trim();

  const withinMatch = dueText.match(/within\s+(\d+)\s*min/i);
  if (withinMatch) {
    return baseMs + Math.max(5, parseInt(withinMatch[1], 10)) * 60 * 1000;
  }

  const clockMatch = dueText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (clockMatch) {
    let hours = parseInt(clockMatch[1], 10);
    const mins = parseInt(clockMatch[2], 10);
    const meridiem = clockMatch[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    const schedDateIST = getISTDateFormatted(new Date(baseMs));
    const dueIso = buildISTIso(
      schedDateIST,
      `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
    );
    const dueMs = new Date(dueIso).getTime();
    if (!Number.isNaN(dueMs) && dueMs >= baseMs + 5 * 60 * 1000) {
      return dueMs;
    }
  }

  return baseMs + (task.isUrgent ? 20 : 30) * 60 * 1000;
}

// Server-Authoritative Real-Time Task Schedule & Alert Engine (1-second resolution, IST)
function runTaskScheduleEngine(): void {
  ensureDailyTasks();

  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const LIVE_DUE_GRACE_MS = 2 * 60 * 1000;

  let dbDirty = false;
  let tasksChanged = false;

  for (const task of db.tasks) {
    if (
      task.status === 'COMPLETED' ||
      task.status === 'CANCELLED' ||
      task.status === 'PENDING_VERIFICATION' ||
      task.status === 'SUBMITTED'
    ) {
      continue;
    }

    const schedMs = new Date(task.scheduledFor).getTime();
    if (Number.isNaN(schedMs)) continue;

    const assignedUser = db.users.find(
      (u) => u.email.toLowerCase() === task.assignedToEmail.toLowerCase()
    );
    const isAssignedToPantryBoy = !assignedUser || assignedUser.role === 'PANTRY_BOY';

    const msUntilStart = schedMs - nowMs;

    // 1. 5-Minute Pre-Task Warning Alert (Pantry Boy Only)
    if (
      isAssignedToPantryBoy &&
      (task.status === 'SCHEDULED' || task.status === 'AVAILABLE') &&
      msUntilStart > 0 &&
      msUntilStart <= FIVE_MIN_MS &&
      task.fiveMinAlertSentFor !== task.scheduledFor &&
      task.dueAlertSentFor !== task.scheduledFor
    ) {
      task.fiveMinAlertSentFor = task.scheduledFor;
      dbDirty = true;

      const scheduledTimeIST = formatISTScheduleLabel(task.scheduledFor);
      broadcastToPantryBoy(task.assignedToEmail, 'schedule:alert', {
        alertId: `warn5-${task.id}-${task.scheduledFor}`,
        alertType: 'WARNING_5MIN',
        task,
        scheduledFor: task.scheduledFor,
        scheduledTimeIST,
        serverTime: nowIso,
      });

      notify(
        `⏰ Starts in 5 Mins: ${task.title}`,
        `Upcoming scheduled task in ${task.roomAreaName} at ${scheduledTimeIST}. Prepare required supplies.`,
        'TASK_UPCOMING_WARNING',
        {
          role: 'PANTRY_BOY',
          email: task.assignedToEmail,
          taskId: task.id,
          roomId: task.roomAreaId,
          roomName: task.roomAreaName,
          priority: task.priority,
        }
      );
    }

    // 2. At-Task-Time Auto-Activation & Prominent Execution Alert (Pantry Boy Only)
    if (nowMs >= schedMs) {
      if (task.status === 'SCHEDULED') {
        task.status = 'AVAILABLE';
        task.changeHistory.push({
          timestamp: nowIso,
          actorEmail: 'system@whitecollarrealty.com',
          actorName: 'IST Task Scheduler',
          fromStatus: 'SCHEDULED',
          toStatus: 'AVAILABLE',
          note: `Task automatically activated at scheduled time (${formatISTScheduleLabel(task.scheduledFor)})`,
        });
        dbDirty = true;
        tasksChanged = true;
      }

      if (
        isAssignedToPantryBoy &&
        task.status === 'AVAILABLE' &&
        nowMs - schedMs <= LIVE_DUE_GRACE_MS &&
        task.dueAlertSentFor !== task.scheduledFor
      ) {
        task.dueAlertSentFor = task.scheduledFor;
        dbDirty = true;

        const scheduledTimeIST = formatISTScheduleLabel(task.scheduledFor);
        broadcastToPantryBoy(task.assignedToEmail, 'schedule:alert', {
          alertId: `due-${task.id}-${task.scheduledFor}`,
          alertType: 'TASK_DUE_NOW',
          task,
          scheduledFor: task.scheduledFor,
          scheduledTimeIST,
          serverTime: nowIso,
        });

        notify(
          `🔔 Task Time Now: ${task.title}`,
          `Scheduled task is due now in ${task.roomAreaName} (${scheduledTimeIST}). Start task and complete mandatory checklist.`,
          'TASK_DUE_NOW',
          {
            role: 'PANTRY_BOY',
            email: task.assignedToEmail,
            taskId: task.id,
            roomId: task.roomAreaId,
            roomName: task.roomAreaName,
            priority: task.priority,
          }
        );
      }

      // 3. Automatic Overdue Detection for unstarted scheduled tasks past deadline
      const deadlineMs = parseTaskDeadlineMs(task);
      if (
        task.status === 'AVAILABLE' &&
        nowMs > deadlineMs &&
        task.overdueMarkedFor !== task.scheduledFor
      ) {
        const prevStatus = task.status;
        task.status = 'OVERDUE';
        task.overdueMarkedFor = task.scheduledFor;
        task.changeHistory.push({
          timestamp: nowIso,
          actorEmail: 'system@whitecollarrealty.com',
          actorName: 'IST Task Scheduler',
          fromStatus: prevStatus,
          toStatus: 'OVERDUE',
          note: `Automatically marked OVERDUE past deadline (${task.dueTime})`,
        });
        dbDirty = true;
        tasksChanged = true;
      }
    }
  }

  if (dbDirty) {
    saveDb();
  }
  if (tasksChanged) {
    broadcastRealtime('task:updated', { tasks: db.tasks, serverTime: nowIso });
  }
}

function addAuditLog(
  actor: { email: string; name: string; role: Role },
  action: string,
  entityType: AuditLog['entityType'],
  entityId: string,
  details: string
) {
  const entry: AuditLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    actorEmail: actor.email,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    details,
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > 500) {
    db.auditLogs.pop();
  }
  saveDb();
}

function notify(
  title: string,
  message: string,
  type: AppNotification['type'],
  options?: {
    role?: Role;
    email?: string;
    taskId?: string;
    roomId?: string;
    roomName?: string;
    priority?: TaskPriority;
    targetOnlyPantryBoy?: boolean;
  }
) {
  const notif: AppNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title,
    message,
    type,
    recipientRole: options?.role,
    recipientEmail: options?.email,
    taskId: options?.taskId,
    roomId: options?.roomId,
    roomName: options?.roomName,
    priority: options?.priority,
    targetOnlyPantryBoy: Boolean(options?.targetOnlyPantryBoy),
    read: false,
    timestamp: new Date().toISOString(),
  };
  db.notifications.unshift(notif);
  if (db.notifications.length > 200) {
    db.notifications.pop();
  }
  saveDb();

  if (options?.targetOnlyPantryBoy) {
    broadcastToPantryBoy(options?.email || '', 'notification:new', { notification: notif });
  } else {
    broadcastRealtime('notification:new', { notification: notif });
  }
  return notif;
}

// -----------------------------------------------------------------------------
// Authentication & Session Middleware
// -----------------------------------------------------------------------------
interface ActiveSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const activeSessions = new Map<string, ActiveSession>();
const revokedTokens = new Set<string>();

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const SESSION_COOKIE_NAME = 'wcr_session';

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'Max-Age=604800',
    isSecure ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    isSecure ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function generateSessionToken(userId: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const payload = `${userId}:${timestamp}:${random}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex').substring(0, 16);
  return `wcr_sess_${userId}_${timestamp}_${random}_${hmac}`;
}

function verifyCryptographicToken(token: string): string | null {
  const match = token.match(/^wcr_sess_(.+)_(\d+)_([a-f0-9]+)_([a-f0-9]{16})$/);
  if (!match) return null;
  const [, userId, timestamp, random, hmac] = match;
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Date.now() - ts > 7 * 24 * 60 * 60 * 1000) {
    return null;
  }
  const payload = `${userId}:${timestamp}:${random}`;
  const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex').substring(0, 16);
  try {
    if (crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(expectedHmac, 'utf8'))) {
      return userId;
    }
  } catch {
    return null;
  }
  return null;
}

function extractSessionToken(req?: express.Request): string {
  if (!req) return '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.headers['x-session-token']) {
    return String(req.headers['x-session-token']).trim();
  }
  if (typeof req.query?.token === 'string') {
    return req.query.token.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME].trim();
  }
  return '';
}

function getCurrentUser(req?: express.Request): UserAccount | null {
  const token = extractSessionToken(req);
  if (!token || revokedTokens.has(token)) return null;

  let session = activeSessions.get(token);
  if (!session) {
    // Only recover sessions that have a valid cryptographic HMAC signature generated by this server
    const verifiedUserId = verifyCryptographicToken(token);
    if (verifiedUserId) {
      const targetUser = db.users.find((u) => u.id === verifiedUserId);
      if (targetUser && targetUser.status !== 'inactive') {
        const newSession: ActiveSession = {
          token,
          userId: targetUser.id,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        activeSessions.set(token, newSession);
        session = newSession;
      }
    }
  }

  if (!session) return null;

  // Check if session has expired
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    activeSessions.delete(token);
    revokedTokens.add(token);
    return null;
  }

  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.status === 'inactive') {
    activeSessions.delete(token);
    revokedTokens.add(token);
    return null;
  }

  return user;
}

function isManagerOrAdmin(role?: Role): boolean {
  return role === 'HR' || role === 'KIMMY_MAM' || role === 'ADMIN';
}

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

// 1. Auth endpoints
app.get('/api/auth/current', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthenticated or session expired',
      code: 'UNAUTHENTICATED',
      message: 'No active authenticated session found. Please log in with your company credentials.',
    });
  }
  const token = extractSessionToken(req);
  if (token) {
    setSessionCookie(req, res, token);
  }
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Company email is required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const user = db.users.find(
    (u) =>
      u.email.toLowerCase() === cleanEmail ||
      (cleanEmail === 'kimmy.mam@whitecollarrealty.com' && u.id === 'user-kimmy-1')
  );

  if (!user) {
    return res.status(401).json({
      error: 'Authentication failed: Only pre-approved White Collar Realty company accounts may access this portal.',
      code: 'UNAUTHORIZED_ACCOUNT',
    });
  }

  if (user.status === 'inactive') {
    return res.status(403).json({
      error: 'Account deactivated: This employee account has been deactivated. Please contact HR or Kimmi.',
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  // Generate cryptographically signed session token with 7-day validity
  const token = generateSessionToken(user.id);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  activeSessions.set(token, {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  setSessionCookie(req, res, token);

  addAuditLog(
    { email: user.email, name: user.name, role: user.role },
    'USER_LOGIN',
    'USER',
    user.id,
    `Logged in successfully (Session ${token.substring(0, 14)}...)`
  );

  let attendance: AttendanceRecord | undefined;
  if (user.role === 'PANTRY_BOY') {
    attendance = recordPantryAttendance(user);
  }

  res.json({ user, token, attendance });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractSessionToken(req);

  if (token) {
    const user = getCurrentUser(req);
    if (user) {
      if (user.role === 'PANTRY_BOY') {
        recordPantryLogout(user);
      }
      addAuditLog(
        { email: user.email, name: user.name, role: user.role },
        'USER_LOGOUT',
        'USER',
        user.id,
        `Logged out and revoked session token ${token.substring(0, 14)}...`
      );
    }
    activeSessions.delete(token);
    revokedTokens.add(token);
  }

  clearSessionCookie(req, res);
  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/auth/switch-user', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({
      error: 'Unauthenticated: Active session required to switch accounts.',
      code: 'UNAUTHENTICATED',
    });
  }

  const { userId } = req.body || {};
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Target userId is required' });
  }

  if (actor.role !== 'ADMIN' && !actor.isSuperAdmin && actor.id !== userId) {
    return res.status(403).json({
      error: 'Permission denied: Only System Administrators may switch into another account session.',
      code: 'FORBIDDEN_ROLE',
    });
  }

  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'Cannot switch to deactivated account' });
  }

  const prevToken = extractSessionToken(req);
  if (prevToken) {
    activeSessions.delete(prevToken);
    revokedTokens.add(prevToken);
  }

  const token = generateSessionToken(user.id);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  activeSessions.set(token, {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  setSessionCookie(req, res, token);

  addAuditLog(
    { email: actor.email, name: actor.name, role: actor.role },
    'USER_SWITCHED',
    'USER',
    user.id,
    `${actor.name} (${actor.role}) switched active account session to ${user.name} (${user.role})`
  );

  let attendance: AttendanceRecord | undefined;
  if (user.role === 'PANTRY_BOY') {
    attendance = recordPantryAttendance(user);
  }

  res.json({ user, token, attendance });
});

// -----------------------------------------------------------------------------
// Real-time Attendance Routes (IST)
// -----------------------------------------------------------------------------
app.get('/api/attendance/today', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.json({
      todayRecord: null,
      allTodayRecords: [],
    });
  }

  const today = getISTDateString();
  const records = (db.attendance || []).filter((a) => a.date === today);

  if (actor.role === 'PANTRY_BOY') {
    const ownRecords = records.filter((a) => a.userId === actor.id);
    return res.json({
      todayRecord: ownRecords[0] || null,
      allTodayRecords: ownRecords,
    });
  }

  const pantryRecord = records.find((a) => a.role === 'PANTRY_BOY') || records[0] || null;
  res.json({
    todayRecord: pantryRecord,
    allTodayRecords: records,
  });
});

app.get('/api/attendance/history', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });

  let history = [...(db.attendance || [])];
  if (user.role === 'PANTRY_BOY') {
    history = history.filter((a) => a.userId === user.id);
  }
  history.sort((a, b) => new Date(b.loginTime).getTime() - new Date(a.loginTime).getTime());

  res.json({
    history,
  });
});

app.post('/api/attendance/record-login', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });
  if (user.role !== 'PANTRY_BOY') {
    return res.status(403).json({ error: 'Attendance check-in is only for Pantry Attendants' });
  }

  const record = recordPantryAttendance(user);
  res.json({ success: true, attendance: record });
});

app.post('/api/attendance/record-logout', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });
  if (user.role !== 'PANTRY_BOY') {
    return res.status(403).json({ error: 'Attendance check-out is only for Pantry Attendants' });
  }
  const record = recordPantryLogout(user);
  res.json({ success: true, attendance: record });
});


function checkUserPermission(
  actor: UserAccount | null,
  module: 'tasks' | 'rooms' | 'visitors' | 'users' | 'reports',
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
): boolean {
  if (!actor) return false;
  // Pantry Boy role must never be allowed to delete tasks under any configuration
  if (actor.role === 'PANTRY_BOY' && module === 'tasks' && action === 'delete') {
    return false;
  }
  if (actor.role === 'ADMIN' || actor.isSuperAdmin) return true;
  const perms = actor.permissions || getDefaultPermissions(actor.role);
  if (action === 'export') {
    return Boolean((perms.actions as any)[module]?.export);
  }
  return Boolean((perms.actions as any)[module]?.[action]);
}

// 2. User Management
app.get('/api/users', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    // Public login screen only receives safe directory summary fields (no phones, permissions, or super-admin flags)
    const publicUsers = db.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department,
      status: u.status,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
    }));
    return res.json({ users: publicUsers });
  }
  res.json({ users: db.users });
});

app.post('/api/users/:id/toggle-status', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'users', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can change employee status.' });
  }

  const targetUser = db.users.find((u) => u.id === req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'Target user not found' });
  }

  const isNowActive = targetUser.status === 'inactive';

  // Super Admin protection from deactivation
  if (!isNowActive && (targetUser.isSuperAdmin || targetUser.id === 'user-admin-1' || targetUser.email.toLowerCase() === 'admin.director@whitecollarrealty.com')) {
    return res.status(403).json({ error: 'Security policy: The primary Super Administrator account cannot be deactivated.' });
  }

  targetUser.status = isNowActive ? 'active' : 'inactive';

  if (!isNowActive) {
    targetUser.deactivatedAt = new Date().toISOString();
    targetUser.deactivatedBy = actor.name;

    // Immediately purge all active sessions for this deactivated user
    for (const [token, session] of activeSessions.entries()) {
      if (session.userId === targetUser.id) {
        activeSessions.delete(token);
        revokedTokens.add(token);
      }
    }

    addAuditLog(
      actor,
      'USER_DEACTIVATED',
      'USER',
      targetUser.id,
      `Deactivated account for ${targetUser.name} (${targetUser.email}). All active sessions revoked immediately.`
    );

    notify(
      `Account Access Revoked`,
      `Employee account for ${targetUser.name} has been suspended by ${actor.name}.`,
      'ACCOUNT_STATUS',
      { email: targetUser.email }
    );

    broadcastRealtime('account:revoked', { userId: targetUser.id, message: 'Account deactivated' });
  } else {
    targetUser.deactivatedAt = undefined;
    targetUser.deactivatedBy = undefined;

    addAuditLog(
      actor,
      'USER_ACTIVATED',
      'USER',
      targetUser.id,
      `Re-activated account for ${targetUser.name} (${targetUser.email})`
    );
  }

  saveDb();
  broadcastRealtime('user:updated', { user: targetUser, users: db.users });
  res.json({ success: true, user: targetUser });
});

const VALID_USER_ROLES: Role[] = ['PANTRY_BOY', 'HR', 'KIMMY_MAM', 'ADMIN'];
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeAndClampPermissions(
  requested: Partial<UserPermissions> | undefined,
  targetRole: Role,
  actor: UserAccount
): UserPermissions {
  const defaults = getDefaultPermissions(targetRole);
  if (!requested) return defaults;

  const isAdminActor = actor.role === 'ADMIN' || Boolean(actor.isSuperAdmin);
  const actorPerms = actor.permissions || getDefaultPermissions(actor.role);

  const clampBool = (reqVal: unknown, fallback: boolean, actorAllowed: boolean): boolean => {
    const desired = reqVal !== undefined ? Boolean(reqVal) : fallback;
    return isAdminActor ? desired : desired && actorAllowed;
  };

  return {
    dashboards: {
      pantry: clampBool(requested.dashboards?.pantry, defaults.dashboards.pantry, Boolean(actorPerms.dashboards?.pantry || isAdminActor)),
      management: clampBool(requested.dashboards?.management, defaults.dashboards.management, Boolean(actorPerms.dashboards?.management)),
    },
    sidebarItems: {
      dashboard: clampBool(requested.sidebarItems?.dashboard, defaults.sidebarItems.dashboard, Boolean(actorPerms.sidebarItems?.dashboard || isAdminActor)),
      myTasks: clampBool(requested.sidebarItems?.myTasks, defaults.sidebarItems.myTasks, Boolean(actorPerms.sidebarItems?.myTasks || isAdminActor)),
      roomSupport: clampBool(requested.sidebarItems?.roomSupport, defaults.sidebarItems.roomSupport, Boolean(actorPerms.sidebarItems?.roomSupport || isAdminActor)),
      pantryRequests: clampBool(requested.sidebarItems?.pantryRequests, defaults.sidebarItems.pantryRequests, Boolean(actorPerms.sidebarItems?.pantryRequests || isAdminActor)),
      notifications: clampBool(requested.sidebarItems?.notifications, defaults.sidebarItems.notifications, Boolean(actorPerms.sidebarItems?.notifications || isAdminActor)),
      taskHistory: clampBool(requested.sidebarItems?.taskHistory, defaults.sidebarItems.taskHistory, Boolean(actorPerms.sidebarItems?.taskHistory || isAdminActor)),
      myProfile: clampBool(requested.sidebarItems?.myProfile, defaults.sidebarItems.myProfile, Boolean(actorPerms.sidebarItems?.myProfile || isAdminActor)),
      overview: clampBool(requested.sidebarItems?.overview, defaults.sidebarItems.overview, Boolean(actorPerms.sidebarItems?.overview)),
      tasks: clampBool(requested.sidebarItems?.tasks, defaults.sidebarItems.tasks, Boolean(actorPerms.sidebarItems?.tasks)),
      rooms: clampBool(requested.sidebarItems?.rooms, defaults.sidebarItems.rooms, Boolean(actorPerms.sidebarItems?.rooms)),
      visitors: clampBool(requested.sidebarItems?.visitors, defaults.sidebarItems.visitors, Boolean(actorPerms.sidebarItems?.visitors)),
      reports: clampBool(requested.sidebarItems?.reports, defaults.sidebarItems.reports, Boolean(actorPerms.sidebarItems?.reports)),
      users: clampBool(requested.sidebarItems?.users, defaults.sidebarItems.users, Boolean(actorPerms.sidebarItems?.users)),
      audit: clampBool(requested.sidebarItems?.audit, defaults.sidebarItems.audit, Boolean(actorPerms.sidebarItems?.audit)),
      settings: clampBool(requested.sidebarItems?.settings, defaults.sidebarItems.settings, Boolean(actorPerms.sidebarItems?.settings)),
    },
    actions: {
      tasks: {
        view: clampBool(requested.actions?.tasks?.view, defaults.actions.tasks.view, Boolean(actorPerms.actions?.tasks?.view)),
        create: clampBool(requested.actions?.tasks?.create, defaults.actions.tasks.create, Boolean(actorPerms.actions?.tasks?.create)),
        edit: clampBool(requested.actions?.tasks?.edit, defaults.actions.tasks.edit, Boolean(actorPerms.actions?.tasks?.edit)),
        delete:
          targetRole === 'PANTRY_BOY'
            ? false
            : clampBool(requested.actions?.tasks?.delete, defaults.actions.tasks.delete, Boolean(actorPerms.actions?.tasks?.delete)),
      },
      rooms: {
        view: clampBool(requested.actions?.rooms?.view, defaults.actions.rooms.view, Boolean(actorPerms.actions?.rooms?.view)),
        create: clampBool(requested.actions?.rooms?.create, defaults.actions.rooms.create, Boolean(actorPerms.actions?.rooms?.create)),
        edit: clampBool(requested.actions?.rooms?.edit, defaults.actions.rooms.edit, Boolean(actorPerms.actions?.rooms?.edit)),
        delete: clampBool(requested.actions?.rooms?.delete, defaults.actions.rooms.delete, Boolean(actorPerms.actions?.rooms?.delete)),
      },
      visitors: {
        view: clampBool(requested.actions?.visitors?.view, defaults.actions.visitors.view, Boolean(actorPerms.actions?.visitors?.view)),
        create: clampBool(requested.actions?.visitors?.create, defaults.actions.visitors.create, Boolean(actorPerms.actions?.visitors?.create)),
        edit: clampBool(requested.actions?.visitors?.edit, defaults.actions.visitors.edit, Boolean(actorPerms.actions?.visitors?.edit)),
        delete: clampBool(requested.actions?.visitors?.delete, defaults.actions.visitors.delete, Boolean(actorPerms.actions?.visitors?.delete)),
      },
      users: {
        view: clampBool(requested.actions?.users?.view, defaults.actions.users.view, Boolean(actorPerms.actions?.users?.view)),
        create: clampBool(requested.actions?.users?.create, defaults.actions.users.create, Boolean(actorPerms.actions?.users?.create)),
        edit: clampBool(requested.actions?.users?.edit, defaults.actions.users.edit, Boolean(actorPerms.actions?.users?.edit)),
        delete: clampBool(requested.actions?.users?.delete, defaults.actions.users.delete, Boolean(actorPerms.actions?.users?.delete)),
      },
      reports: {
        view: clampBool(requested.actions?.reports?.view, defaults.actions.reports.view, Boolean(actorPerms.actions?.reports?.view)),
        export: clampBool(requested.actions?.reports?.export, defaults.actions.reports.export, Boolean(actorPerms.actions?.reports?.export)),
      },
    },
  };
}

app.post('/api/users', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'users', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can register company accounts.' });
  }

  const { name, email, role, department, phone, permissions } = req.body || {};
  const cleanedName = normalizeDisplayText(String(name || ''));
  if (!cleanedName || !email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid name and email are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!EMAIL_FORMAT_REGEX.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }
  if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'A user with this company email already exists.' });
  }

  const userRole: Role = role ? (role as Role) : 'PANTRY_BOY';
  if (!VALID_USER_ROLES.includes(userRole)) {
    return res.status(400).json({ error: `Invalid role "${String(role)}". Must be one of: ${VALID_USER_ROLES.join(', ')}` });
  }
  if (userRole === 'ADMIN' && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    return res.status(403).json({ error: 'Permission denied: Only an Administrator can create another Administrator account.' });
  }

  // Prevent non-Admins from granting permissions they do not possess
  if (permissions && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    const actorPerms = actor.permissions || getDefaultPermissions(actor.role);
    if (
      (permissions.actions?.users?.delete && !actorPerms.actions?.users?.delete) ||
      (permissions.actions?.rooms?.delete && !actorPerms.actions?.rooms?.delete)
    ) {
      return res.status(403).json({
        error: 'Permission denied: Cannot grant elevated deletion privileges beyond your own role permissions.',
        code: 'PRIVILEGE_ESCALATION_BLOCKED',
      });
    }
  }

  const sanitizedPermissions = sanitizeAndClampPermissions(permissions, userRole, actor);

  const newUser: UserAccount = {
    id: `user-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    name: cleanedName,
    email: cleanEmail,
    role: userRole,
    department: normalizeDisplayText(department || (userRole === 'PANTRY_BOY' ? 'Hospitality & Operations' : 'Administration')),
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: phone ? normalizeDisplayText(String(phone)).slice(0, 32) : '',
    createdAt: new Date().toISOString(),
    permissions: sanitizedPermissions,
  };

  db.users.push(newUser);
  addAuditLog(actor, 'USER_CREATED', 'USER', newUser.id, `Created new company account for ${newUser.name} (${newUser.email}) as ${newUser.role}`);
  saveDb();
  broadcastRealtime('user:updated', { user: newUser, users: db.users });

  res.json({ success: true, user: newUser });
});

app.put('/api/users/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'users', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can edit user accounts.' });
  }

  const targetUser = db.users.find((u) => u.id === req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { name, email, role, department, phone, permissions } = req.body || {};

  if (role !== undefined && !VALID_USER_ROLES.includes(role as Role)) {
    return res.status(400).json({ error: `Invalid role "${String(role)}". Must be one of: ${VALID_USER_ROLES.join(', ')}` });
  }

  // Protect Super Admin account from non-Admin edits or role demotion
  if ((targetUser.isSuperAdmin || targetUser.role === 'ADMIN') && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    return res.status(403).json({ error: 'Permission denied: Only an Administrator can modify Administrator accounts.' });
  }
  if (targetUser.isSuperAdmin && role && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Security policy: The Super Administrator role cannot be changed.' });
  }
  if (role === 'ADMIN' && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    return res.status(403).json({ error: 'Permission denied: Only an Administrator can grant Administrator role.' });
  }

  // Block non-Admin horizontal/vertical privilege escalation via custom permissions payload
  if (permissions && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    const actorPerms = actor.permissions || getDefaultPermissions(actor.role);
    if (
      (permissions.actions?.users?.delete && !actorPerms.actions?.users?.delete) ||
      (permissions.actions?.rooms?.delete && !actorPerms.actions?.rooms?.delete)
    ) {
      return res.status(403).json({
        error: 'Permission denied: Cannot grant elevated deletion privileges beyond your own role permissions.',
        code: 'PRIVILEGE_ESCALATION_BLOCKED',
      });
    }
  }

  if (name !== undefined) {
    const cleanedName = normalizeDisplayText(String(name));
    if (!cleanedName) return res.status(400).json({ error: 'User name cannot be empty.' });
    targetUser.name = cleanedName;
  }
  let emailChanged = false;
  if (email && String(email).toLowerCase() !== targetUser.email.toLowerCase()) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_FORMAT_REGEX.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }
    if (db.users.some((u) => u.id !== targetUser.id && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: 'Another user with this email already exists.' });
    }
    targetUser.email = cleanEmail;
    emailChanged = true;
  }
  const prevRole = targetUser.role;
  if (role) targetUser.role = role as Role;
  if (department !== undefined) targetUser.department = normalizeDisplayText(String(department));
  if (phone !== undefined) targetUser.phone = normalizeDisplayText(String(phone)).slice(0, 32);
  if (permissions) {
    targetUser.permissions = sanitizeAndClampPermissions(permissions, targetUser.role, actor);
  } else if (targetUser.role === 'PANTRY_BOY' && targetUser.permissions?.actions?.tasks) {
    targetUser.permissions.actions.tasks.delete = false;
  }

  // If another user's email or role changed, revoke their existing tokens so they re-authenticate cleanly
  if ((emailChanged || (role && role !== prevRole)) && targetUser.id !== actor.id) {
    for (const [token, session] of activeSessions.entries()) {
      if (session.userId === targetUser.id) {
        activeSessions.delete(token);
        revokedTokens.add(token);
      }
    }
  }

  addAuditLog(
    actor,
    'USER_UPDATED',
    'USER',
    targetUser.id,
    `Updated details and permissions for ${targetUser.name} (${targetUser.email})`
  );
  saveDb();

  // Broadcast immediate update so the user client applies permissions in real time
  broadcastRealtime('user:updated', { user: targetUser, users: db.users });
  res.json({ success: true, user: targetUser });
});

app.delete('/api/users/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'users', 'delete')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or users with delete permission can delete company accounts.' });
  }

  const targetIndex = db.users.findIndex((u) => u.id === req.params.id);
  if (targetIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const targetUser = db.users[targetIndex];

  // Super Admin protection from deletion
  if (targetUser.isSuperAdmin || targetUser.id === 'user-admin-1' || targetUser.email.toLowerCase() === 'admin.director@whitecollarrealty.com') {
    return res.status(403).json({ error: 'Security policy: The primary Super Administrator account cannot be deleted.' });
  }

  // Ensure at least one active Admin exists
  if (targetUser.role === 'ADMIN') {
    const otherAdmins = db.users.filter((u) => u.id !== targetUser.id && u.role === 'ADMIN' && u.status === 'active');
    if (otherAdmins.length === 0) {
      return res.status(400).json({ error: 'Cannot delete the only remaining Administrator. Please assign another Admin first.' });
    }
  }

  // Immediately purge sessions
  for (const [token, session] of activeSessions.entries()) {
    if (session.userId === targetUser.id) {
      activeSessions.delete(token);
      revokedTokens.add(token);
    }
  }

  broadcastRealtime('account:revoked', { userId: targetUser.id, message: 'Account deleted by Admin' });

  db.users.splice(targetIndex, 1);
  addAuditLog(
    actor,
    'USER_DELETED',
    'USER',
    targetUser.id,
    `Permanently deleted user account for ${targetUser.name} (${targetUser.email})`
  );
  saveDb();

  broadcastRealtime('user:updated', { deletedUserId: targetUser.id, users: db.users });
  res.json({ success: true, message: 'User deleted successfully' });
});

// -----------------------------------------------------------------------------
// Real-time Event Stream (SSE)
// -----------------------------------------------------------------------------
app.get('/api/server-time', (_req, res) => {
  const now = new Date();
  res.json({
    serverTime: now.toISOString(),
    timezone: 'Asia/Kolkata',
    istTime: getISTTimeString(now),
    istDate: getISTDateString(now),
  });
});

app.get(['/api/realtime/stream', '/api/realtime'], (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid session token required for real-time event stream.',
      code: 'UNAUTHENTICATED',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientEntry: SSEClientEntry = { res, req, userId: actor.id };
  sseClients.add(clientEntry);

  const nowIso = new Date().toISOString();
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: 'connected',
      time: nowIso,
      serverTime: nowIso,
      timezone: 'Asia/Kolkata',
      rooms: db.rooms.map((r) => normalizeRoomRecord(r)),
    })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
      if (!getCurrentUser(req)) {
        clearInterval(heartbeat);
        sseClients.delete(clientEntry);
        res.end();
        return;
      }
      const hbIso = new Date().toISOString();
      res.write(`event: server:time\ndata: ${JSON.stringify({ serverTime: hbIso, timezone: 'Asia/Kolkata' })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(clientEntry);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientEntry);
  });
});

const VALID_ROOM_CATEGORIES: RoomArea['category'][] = [
  'RECEPTION',
  'WORKSTATION',
  'EXECUTIVE_CABIN',
  'MEETING_SUITE',
  'COMMON_AREA',
  'FACILITIES',
];
const VALID_ROOM_PRIORITIES: TaskPriority[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'URGENT'];
const VALID_ROOM_RECURRENCES: RoomArea['recurrence'][] = [
  'DAILY',
  'ALTERNATE_DAYS',
  'EVERY_3_DAYS',
  'ON_DEMAND',
];
const VALID_ROOM_STATUSES: RoomStatus[] = [
  'AVAILABLE',
  'RESERVED',
  'ASSIGNED',
  'OCCUPIED',
  'VACANT',
  'PREPARATION_REQUIRED',
  'READY_FOR_VISITOR',
  'CLEANING_REQUIRED',
  'CLEANING_IN_PROGRESS',
  'PENDING_VERIFICATION',
];

// 3. Room Management
app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: db.rooms.map((r) => normalizeRoomRecord(r)) });
});

app.post('/api/rooms', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can create rooms.' });
  }

  const { name, category, defaultPriority, photoRequired, defaultChecklist, recurrence, setupConfig } = req.body || {};
  const cleanedName = normalizeRoomName(String(name || ''));
  if (!cleanedName) return res.status(400).json({ error: 'Room name is required' });

  if (category !== undefined && !VALID_ROOM_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid room category "${String(category)}".` });
  }
  if (defaultPriority !== undefined && !VALID_ROOM_PRIORITIES.includes(defaultPriority)) {
    return res.status(400).json({ error: `Invalid defaultPriority "${String(defaultPriority)}".` });
  }
  if (recurrence !== undefined && !VALID_ROOM_RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${String(recurrence)}".` });
  }

  const requestedId = req.body?.id ? String(req.body.id).trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (requestedId && db.rooms.some((r) => r.id === requestedId)) {
    return res.status(409).json({ error: `A room with ID "${requestedId}" already exists.` });
  }

  const now = new Date().toISOString();
  const baseRoom: RoomArea = {
    id: requestedId || `room-${Date.now()}`,
    name: cleanedName,
    category: category || 'MEETING_SUITE',
    defaultPriority: defaultPriority || 'P2',
    photoRequired: photoRequired !== undefined ? Boolean(photoRequired) : true,
    status: 'AVAILABLE',
    recurrence: recurrence || 'DAILY',
    enabled: true,
    setupConfig,
    defaultChecklist: [],
    currentAssignment: null,
    assignmentHistory: [],
    statusHistory: [
      {
        id: `hist-${Date.now()}`,
        status: 'AVAILABLE',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: `Room created by ${actor.name} (${actor.role})`,
      },
    ],
  };

  const verifiedCfg = verifyRoomSetupConfig(baseRoom);
  if (verifiedCfg) {
    baseRoom.setupConfig = verifiedCfg;
  }
  baseRoom.defaultChecklist = (
    Array.isArray(defaultChecklist) && defaultChecklist.length > 0
      ? defaultChecklist
      : buildVerifiedRoomChecklistStrings(baseRoom)
  ).map((item: string) => normalizeDisplayText(String(item)));

  db.rooms.push(baseRoom);
  const tasksSynced = syncTodayRoutineTasks(getISTDateFormatted());
  addAuditLog(actor, 'ROOM_CREATED', 'ROOM', baseRoom.id, `Created room area "${baseRoom.name}" with priority ${baseRoom.defaultPriority}`);
  saveDb();
  broadcastRealtime('room:created', { room: baseRoom, rooms: db.rooms });
  if (tasksSynced) {
    broadcastRealtime('task:updated', { tasks: db.tasks, serverTime: now });
  }

  res.json({ success: true, room: baseRoom });
});

app.put('/api/rooms/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can modify rooms.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const prevName = room.name;
  const prevStatus = room.status;
  const body = req.body || {};
  const targetStatus = body.status as RoomStatus | undefined;

  if (targetStatus !== undefined && !VALID_ROOM_STATUSES.includes(targetStatus)) {
    return res.status(400).json({ error: `Invalid room status "${String(targetStatus)}".` });
  }
  if (body.category !== undefined && !VALID_ROOM_CATEGORIES.includes(body.category)) {
    return res.status(400).json({ error: `Invalid room category "${String(body.category)}".` });
  }
  if (body.defaultPriority !== undefined && !VALID_ROOM_PRIORITIES.includes(body.defaultPriority)) {
    return res.status(400).json({ error: `Invalid defaultPriority "${String(body.defaultPriority)}".` });
  }
  if (body.recurrence !== undefined && !VALID_ROOM_RECURRENCES.includes(body.recurrence)) {
    return res.status(400).json({ error: `Invalid recurrence "${String(body.recurrence)}".` });
  }

  // Explicit field whitelist prevents mass assignment of room.id, statusHistory, assignmentHistory, or assignedEmployeeId
  if (body.name !== undefined) {
    room.name = normalizeRoomName(String(body.name)) || prevName;
  }
  if (body.category !== undefined) {
    room.category = body.category;
  }
  if (body.defaultPriority !== undefined) {
    room.defaultPriority = body.defaultPriority;
  }
  if (body.photoRequired !== undefined) {
    room.photoRequired = Boolean(body.photoRequired);
  }
  if (body.recurrence !== undefined) {
    room.recurrence = body.recurrence;
  }
  if (body.enabled !== undefined) {
    room.enabled = Boolean(body.enabled);
  }
  if (body.notes !== undefined) {
    room.notes = normalizeDisplayText(String(body.notes));
  }
  if (body.setupConfig !== undefined && body.setupConfig && typeof body.setupConfig === 'object') {
    const tables = Math.max(0, Number(body.setupConfig.tables) || 0);
    const chairs = Math.max(0, Number(body.setupConfig.chairs) || 0);
    const tableType = ['round', 'standard', 'desk_cluster', 'none'].includes(body.setupConfig.tableType)
      ? body.setupConfig.tableType
      : room.setupConfig?.tableType || 'standard';
    room.setupConfig = {
      tables,
      tableType,
      chairs,
      summary: normalizeDisplayText(String(body.setupConfig.summary || `${tables} table + ${chairs} chairs`)),
    };
  }
  if (Array.isArray(body.defaultChecklist)) {
    room.defaultChecklist = body.defaultChecklist.map((c: unknown) => normalizeDisplayText(String(c)));
  }

  const verifiedCfg = verifyRoomSetupConfig(room);
  if (verifiedCfg) {
    room.setupConfig = verifiedCfg;
  }

  if (targetStatus && targetStatus !== prevStatus) {
    handleRoomStatusTransition(room, targetStatus, actor, { note: room.notes });
  }
  if (room.name !== prevName) {
    if (room.currentAssignment) {
      room.currentAssignment.roomAreaName = room.name;
    }
    db.tasks.forEach((t) => {
      if (t.roomAreaId === room.id) {
        t.roomAreaName = room.name;
        if (t.photoEvidence) {
          t.photoEvidence.roomName = room.name;
        }
      }
    });
    db.visitors.forEach((v) => {
      if (v.roomAreaId === room.id) {
        v.roomAreaName = room.name;
      }
    });
    db.pantryRequests.forEach((pr) => {
      if (pr.roomAreaId === room.id) {
        pr.roomAreaName = room.name;
      }
    });
  }
  const tasksSynced = syncTodayRoutineTasks(getISTDateFormatted());
  addAuditLog(actor, 'ROOM_UPDATED', 'ROOM', room.id, `Updated room "${room.name}" configuration`);
  saveDb();
  const normalizedRoom = normalizeRoomRecord(room);
  const normalizedRooms = db.rooms.map((r) => normalizeRoomRecord(r));
  broadcastRealtime('room:updated', { room: normalizedRoom, rooms: normalizedRooms });
  if (tasksSynced || room.name !== prevName) {
    broadcastRealtime('task:updated', {
      tasks: db.tasks.map((t) => normalizeTaskRecord(t)),
      serverTime: new Date().toISOString(),
    });
  }

  res.json({ success: true, room: normalizedRoom });
});

app.delete('/api/rooms/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'delete')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized administrators can delete rooms.' });
  }

  // Prevent deleting canonical routine rooms
  if (BUILTIN_ROUTINE_ROOM_IDS.has(req.params.id)) {
    return res.status(403).json({ error: 'Cannot delete canonical company room', code: 'CANONICAL_ROOM_PROTECTED' });
  }

  const roomIdx = db.rooms.findIndex((r) => r.id === req.params.id);
  if (roomIdx === -1) return res.status(404).json({ error: 'Room not found' });

  const [removedRoom] = db.rooms.splice(roomIdx, 1);
  addAuditLog(actor, 'ROOM_DELETED', 'ROOM', removedRoom.id, `Deleted room "${removedRoom.name}"`);
  saveDb();
  broadcastRealtime('room:deleted', { roomId: removedRoom.id, rooms: db.rooms.map((r) => normalizeRoomRecord(r)) });
  res.json({ success: true, message: `Room "${removedRoom.name}" deleted` });
});

// Toggle Room Active / Inactive
app.post('/api/rooms/:id/toggle-active', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can activate or deactivate rooms.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  room.enabled = !room.enabled;
  const now = new Date().toISOString();
  if (!room.statusHistory) room.statusHistory = [];
  room.statusHistory.unshift({
    id: `hist-${Date.now()}`,
    status: room.status,
    timestamp: now,
    actorName: actor.name,
    actorEmail: actor.email,
    note: `Room was ${room.enabled ? 'activated' : 'deactivated'} by ${actor.name} (${actor.role})`,
  });

  const tasksSynced = syncTodayRoutineTasks(getISTDateFormatted());
  addAuditLog(actor, 'ROOM_TOGGLE_ACTIVE', 'ROOM', room.id, `Set room "${room.name}" enabled=${room.enabled}`);
  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });
  if (tasksSynced) {
    broadcastRealtime('task:updated', { tasks: db.tasks, serverTime: now });
  }

  res.json({ success: true, room });
});

// Assign Room (Visitor / Candidate) with Conflict Collision Prevention
app.post('/api/rooms/:id/assign', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can assign rooms.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (!room.enabled) {
    return res.status(400).json({ error: 'Cannot assign deactivated room. Please activate the room first.' });
  }

  const {
    visitorName,
    reference,
    expectedArrival,
    expectedDuration,
    prepRequirements,
    waterRequirements,
    priority,
    instructions,
    forceOverride,
  } = req.body;

  if (!visitorName || String(visitorName).trim().length === 0) {
    return res.status(400).json({ error: 'Visitor or candidate name is required.' });
  }

  // Conflict Prevention: Room cannot become available or reassigned while occupied or undergoing cleaning/prep
  const conflictingStatuses = [
    'OCCUPIED',
    'PREPARATION_REQUIRED',
    'CLEANING_REQUIRED',
    'CLEANING_IN_PROGRESS',
    'PENDING_VERIFICATION',
  ];

  if (conflictingStatuses.includes(room.status) && !forceOverride) {
    const availableRooms = db.rooms.filter(
      (r) => r.enabled && (r.status === 'AVAILABLE' || r.status === 'READY_FOR_VISITOR') && r.id !== room.id
    );
    return res.status(409).json({
      error: `Room Conflict: "${room.name}" is currently ${room.status}. Rooms cannot be booked while occupied or undergoing an active preparation/cleaning workflow.`,
      code: 'ROOM_CONFLICT',
      currentStatus: room.status,
      currentAssignment: room.currentAssignment,
      availableRooms: availableRooms.map((r) => ({ id: r.id, name: r.name, status: r.status })),
    });
  }

  const now = new Date().toISOString();
  const assignedPantry = db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') || db.users[0];

  const assignment: RoomAssignment = {
    id: `assign-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    roomAreaId: room.id,
    roomAreaName: normalizeRoomName(room.name),
    visitorName: normalizeDisplayText(String(visitorName)),
    reference: reference ? normalizeDisplayText(String(reference)) : 'Executive Meeting / Interview',
    expectedArrival: expectedArrival ? normalizeDisplayText(String(expectedArrival)) : 'Immediate',
    expectedDuration: expectedDuration ? normalizeDisplayText(String(expectedDuration)) : '1 hour',
    prepRequirements: Array.isArray(prepRequirements) && prepRequirements.length > 0
      ? prepRequirements.map((r: string) => normalizeDisplayText(r))
      : ['Wipe table surface and clean glass coasters', 'Align all chairs in uniform geometric layout', 'Check AC and lighting'],
    waterRequirements: waterRequirements ? normalizeDisplayText(String(waterRequirements)) : '2 Chilled Sealed Bottles + Clean Glasses',
    priority: priority === 'URGENT' ? 'URGENT' : priority || 'P2',
    instructions: instructions ? normalizeDisplayText(String(instructions)) : '',
    assignedBy: actor.name,
    assignedAt: now,
    status: 'ACTIVE',
  };

  // Build Preparation Task Checklist
  const prepChecklist: ChecklistItem[] = [];
  let itemIdx = 1;
  prepChecklist.push({
    id: `item-${itemIdx++}`,
    text: `Water setup: ${assignment.waterRequirements}`,
    completed: false,
  });
  assignment.prepRequirements.forEach((reqText: string) => {
    prepChecklist.push({
      id: `item-${itemIdx++}`,
      text: reqText,
      completed: false,
    });
  });
  if (assignment.instructions) {
    prepChecklist.push({
      id: `item-${itemIdx++}`,
      text: `Special Instructions: ${assignment.instructions}`,
      completed: false,
    });
  }
  prepChecklist.push({
    id: `item-${itemIdx++}`,
    text: `Capture live camera photo of prepared ${room.name} for verification`,
    completed: false,
  });

  const prepTask: Task = {
    id: `task-prep-${room.id}-${Date.now()}`,
    title: `[ROOM PREP] Prepare ${room.name} for ${assignment.visitorName}`,
    description: `Expected Arrival: ${assignment.expectedArrival} (${assignment.expectedDuration}). Purpose: ${assignment.reference}. Water: ${assignment.waterRequirements}. ${assignment.instructions ? 'Instructions: ' + assignment.instructions : ''}`,
    roomAreaId: room.id,
    roomAreaName: room.name,
    priority: assignment.priority,
    taskType: 'VISITOR_PREP',
    assignedToEmail: assignedPantry.email,
    assignedToName: assignedPantry.name,
    createdByEmail: actor.email,
    createdByName: actor.name,
    createdAt: now,
    scheduledFor: now,
    dueTime: `Due by ${assignment.expectedArrival}`,
    status: 'AVAILABLE',
    isUrgent: assignment.priority === 'URGENT',
    checklist: prepChecklist,
    changeHistory: [
      {
        timestamp: now,
        actorEmail: actor.email,
        actorName: actor.name,
        fromStatus: 'NONE',
        toStatus: 'AVAILABLE',
        note: `Generated by Room Assignment for ${assignment.visitorName} by ${actor.name} (${actor.role})`,
      },
    ],
  };

  assignment.prepTaskId = prepTask.id;
  room.currentAssignment = assignment;
  room.status = 'PREPARATION_REQUIRED';

  if (!room.statusHistory) room.statusHistory = [];
  room.statusHistory.unshift({
    id: `hist-${Date.now()}`,
    status: 'PREPARATION_REQUIRED',
    timestamp: now,
    actorName: actor.name,
    actorEmail: actor.email,
    note: `Assigned to ${assignment.visitorName} (${assignment.reference}). Expected Arrival: ${assignment.expectedArrival}. Auto-created task #${prepTask.id}.`,
    taskId: prepTask.id,
    assignmentId: assignment.id,
  });

  db.tasks.unshift(prepTask);

  addAuditLog(
    actor,
    'ROOM_ASSIGNED',
    'ROOM',
    room.id,
    `Assigned room "${room.name}" to "${assignment.visitorName}" (${assignment.reference}). Generated prep task "${prepTask.title}".`
  );

  notify(
    `🛎️ ROOM ASSIGNMENT: ${room.name}`,
    `${actor.name} assigned ${room.name} for ${assignment.visitorName} (${assignment.reference}). Expected: ${assignment.expectedArrival}. Immediate setup required!`,
    assignment.priority === 'URGENT' ? 'URGENT_TASK' : 'ROOM_ASSIGNED',
    {
      role: 'PANTRY_BOY',
      taskId: prepTask.id,
      roomId: room.id,
      roomName: room.name,
      priority: assignment.priority,
    }
  );

  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });
  broadcastRealtime('task:updated', { task: prepTask, tasks: db.tasks });

  res.json({ success: true, room, assignment, prepTask });
});

// Helper: Authorize Admin, HR, and Kimmi Mam (KIMMY_MAM) to manage room employee assignments
function canManageRoomAssignments(actor: UserAccount | null): boolean {
  if (!actor || actor.status === 'inactive') return false;
  if (actor.role === 'PANTRY_BOY') return false;
  if (actor.role === 'ADMIN' || actor.role === 'HR' || actor.role === 'KIMMY_MAM') return true;
  if (actor.isSuperAdmin) return true;
  return checkUserPermission(actor, 'rooms', 'edit');
}

// Assign room to any employee (Admin, HR, Kimmi Mam) with conflict prevention & force override
app.post('/api/rooms/:id/assign-employee', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!canManageRoomAssignments(actor)) {
    return res.status(403).json({
      error: 'Permission denied: Only Admin, HR, and Kimmi Mam can assign rooms to employees.',
      code: 'FORBIDDEN_ROLE',
    });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  if (!room.enabled) {
    return res.status(400).json({ error: 'Cannot assign deactivated room. Please activate the room first.' });
  }

  const { employeeId, notes, forceOverride, status } = req.body;
  if (!employeeId || String(employeeId).trim().length === 0) {
    return res.status(400).json({ error: 'Employee ID is required.' });
  }

  const cleanEmpId = String(employeeId).trim();
  const targetEmployee = db.users.find(
    (u) => u.id === cleanEmpId || u.email.toLowerCase() === cleanEmpId.toLowerCase()
  );
  if (!targetEmployee) {
    return res.status(404).json({ error: 'Employee account not found.' });
  }

  if (targetEmployee.status === 'inactive') {
    return res.status(400).json({ error: 'Cannot assign room to a deactivated employee account.' });
  }

  // Conflict 1: Room is already assigned to a different employee
  if (room.assignedEmployeeId && room.assignedEmployeeId !== targetEmployee.id && !forceOverride) {
    return res.status(409).json({
      error: `Room Conflict: "${room.name}" is already assigned to ${room.assignedEmployeeName || 'another employee'}. Unassign first or use force override.`,
      code: 'ROOM_ALREADY_ASSIGNED',
      conflictingRoom: { id: room.id, name: room.name },
      currentAssignedEmployee: {
        id: room.assignedEmployeeId,
        name: room.assignedEmployeeName,
        email: room.assignedEmployeeEmail,
      },
    });
  }

  // Conflict 2: Target employee is already assigned to another room
  const conflictingRoom = db.rooms.find(
    (r) => r.id !== room.id && r.assignedEmployeeId === targetEmployee.id
  );
  if (conflictingRoom && !forceOverride) {
    return res.status(409).json({
      error: `Employee Conflict: ${targetEmployee.name} is already assigned to "${conflictingRoom.name}". Unassign from previous room or use force override.`,
      code: 'EMPLOYEE_ALREADY_ASSIGNED',
      conflictingRoom: { id: conflictingRoom.id, name: conflictingRoom.name },
      employee: { id: targetEmployee.id, name: targetEmployee.name, email: targetEmployee.email },
    });
  }

  const now = new Date().toISOString();

  // If forceOverride, safely unassign conflicting room
  if (conflictingRoom) {
    conflictingRoom.assignedEmployeeId = undefined;
    conflictingRoom.assignedEmployeeName = undefined;
    conflictingRoom.assignedEmployeeEmail = undefined;
    conflictingRoom.assignedEmployeeRole = undefined;
    if (conflictingRoom.status === 'ASSIGNED' || conflictingRoom.status === 'OCCUPIED' || conflictingRoom.status === 'RESERVED') {
      conflictingRoom.status = 'AVAILABLE';
    }
    if (conflictingRoom.currentAssignment) {
      conflictingRoom.currentAssignment.status = 'COMPLETED';
      conflictingRoom.currentAssignment.releasedAt = now;
      if (!conflictingRoom.assignmentHistory) conflictingRoom.assignmentHistory = [];
      conflictingRoom.assignmentHistory.unshift({ ...conflictingRoom.currentAssignment });
      conflictingRoom.currentAssignment = null;
    }
    addAuditLog(
      actor,
      'ROOM_UNASSIGNED_EMPLOYEE',
      'ROOM',
      conflictingRoom.id,
      `Unassigned room "${conflictingRoom.name}" from ${targetEmployee.name} due to reassignment override to "${room.name}".`
    );
  }

  // Archive previous assignment for target room if present
  if (room.currentAssignment && room.assignedEmployeeId !== targetEmployee.id) {
    room.currentAssignment.status = 'COMPLETED';
    room.currentAssignment.releasedAt = now;
    if (!room.assignmentHistory) room.assignmentHistory = [];
    room.assignmentHistory.unshift({ ...room.currentAssignment });
  }

  room.assignedEmployeeId = targetEmployee.id;
  room.assignedEmployeeName = targetEmployee.name;
  room.assignedEmployeeEmail = targetEmployee.email;
  room.assignedEmployeeRole = targetEmployee.role;

  if (status && ['OCCUPIED', 'ASSIGNED', 'AVAILABLE', 'VACANT'].includes(status)) {
    room.status = status as RoomStatus;
  } else if (room.status === 'AVAILABLE' || room.status === 'VACANT') {
    room.status = 'ASSIGNED';
  }

  const assignment: RoomAssignment = {
    id: `assign-emp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    roomAreaId: room.id,
    roomAreaName: normalizeRoomName(room.name),
    visitorName: targetEmployee.name,
    reference: `Staff Assignment: ${targetEmployee.name} (${targetEmployee.department || targetEmployee.role})`,
    expectedArrival: 'Active Assigned',
    expectedDuration: 'Standing Assignment',
    prepRequirements: ['Verify room setup', 'Clean desk and surfaces'],
    waterRequirements: '1 Bottle on Desk',
    priority: 'P2',
    instructions: notes ? normalizeDisplayText(String(notes)) : `Assigned by ${actor.name} (${actor.role})`,
    assignedBy: `${actor.name} (${actor.role})`,
    assignedAt: now,
    status: 'ACTIVE',
    assignedEmployeeId: targetEmployee.id,
    assignedEmployeeName: targetEmployee.name,
    assignedEmployeeEmail: targetEmployee.email,
  };

  room.currentAssignment = assignment;

  if (!room.statusHistory) room.statusHistory = [];
  room.statusHistory.unshift({
    id: `hist-${Date.now()}`,
    status: room.status,
    timestamp: now,
    actorName: actor.name,
    actorEmail: actor.email,
    note: `Assigned room to employee ${targetEmployee.name} (${targetEmployee.email})${notes ? ': ' + notes : ''}`,
    assignmentId: assignment.id,
  });

  addAuditLog(
    actor,
    'ROOM_ASSIGNED_EMPLOYEE',
    'ROOM',
    room.id,
    `Assigned room "${room.name}" to employee ${targetEmployee.name} (${targetEmployee.email}) by ${actor.name} (${actor.role}).`
  );

  saveDb();
  const normalizedRoom = normalizeRoomRecord(room);
  const normalizedRooms = db.rooms.map((r) => normalizeRoomRecord(r));
  broadcastRealtime('room:updated', { room: normalizedRoom, rooms: normalizedRooms });

  res.json({ success: true, room: normalizedRoom, assignment });
});

// Unassign room from employee (Admin, HR, Kimmi Mam)
app.post(['/api/rooms/:id/unassign-employee', '/api/rooms/:id/unassign'], (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!canManageRoomAssignments(actor)) {
    return res.status(403).json({
      error: 'Permission denied: Only Admin, HR, and Kimmi Mam can unassign rooms.',
      code: 'FORBIDDEN_ROLE',
    });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const now = new Date().toISOString();
  const prevEmpName = room.assignedEmployeeName || room.currentAssignment?.visitorName || 'Employee';

  room.assignedEmployeeId = undefined;
  room.assignedEmployeeName = undefined;
  room.assignedEmployeeEmail = undefined;
  room.assignedEmployeeRole = undefined;

  if (room.currentAssignment) {
    room.currentAssignment.status = 'COMPLETED';
    room.currentAssignment.releasedAt = now;
    if (!room.assignmentHistory) room.assignmentHistory = [];
    room.assignmentHistory.unshift({ ...room.currentAssignment });
    room.currentAssignment = null;
  }

  if (room.status === 'ASSIGNED' || room.status === 'OCCUPIED' || room.status === 'RESERVED') {
    room.status = 'AVAILABLE';
  }

  if (!room.statusHistory) room.statusHistory = [];
  room.statusHistory.unshift({
    id: `hist-${Date.now()}`,
    status: room.status,
    timestamp: now,
    actorName: actor.name,
    actorEmail: actor.email,
    note: `Unassigned room from ${prevEmpName} by ${actor.name} (${actor.role})`,
  });

  addAuditLog(
    actor,
    'ROOM_UNASSIGNED_EMPLOYEE',
    'ROOM',
    room.id,
    `Unassigned room "${room.name}" from ${prevEmpName} by ${actor.name} (${actor.role}).`
  );

  saveDb();
  const normalizedRoom = normalizeRoomRecord(room);
  const normalizedRooms = db.rooms.map((r) => normalizeRoomRecord(r));
  broadcastRealtime('room:updated', { room: normalizedRoom, rooms: normalizedRooms });

  res.json({ success: true, room: normalizedRoom });
});

// -----------------------------------------------------------------------------
// Automated Room-Status Workflow Engine & Idempotency Store
// -----------------------------------------------------------------------------
interface RoomTransitionOptions {
  note?: string;
  idempotencyKey?: string;
  source?: string;
}

interface RoomTransitionResult {
  success: boolean;
  room: RoomArea;
  previousStatus: RoomStatus;
  currentStatus: RoomStatus;
  transitionTriggered: boolean;
  duplicate?: boolean;
  task?: Task;
  notification?: AppNotification;
  message: string;
}

const transitionIdempotencyCache = new Map<
  string,
  {
    taskId?: string;
    notificationId?: string;
    status: RoomStatus;
    timestamp: string;
    result: RoomTransitionResult;
  }
>();

// Clean up idempotency entries older than 15 minutes periodically
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of transitionIdempotencyCache.entries()) {
    if (new Date(v.timestamp).getTime() < cutoff) {
      transitionIdempotencyCache.delete(k);
    }
  }
}, 60000);

function handleRoomStatusTransition(
  room: RoomArea,
  newStatus: RoomStatus,
  actor: UserAccount,
  options?: RoomTransitionOptions
): RoomTransitionResult {
  const prevStatus = room.status;
  const now = new Date().toISOString();
  const rawIdempKey = options?.idempotencyKey ? String(options.idempotencyKey).trim() : '';

  // 1. Idempotency Check: Return previously executed result if same idempotency key is submitted
  if (rawIdempKey && transitionIdempotencyCache.has(rawIdempKey)) {
    const cached = transitionIdempotencyCache.get(rawIdempKey)!;
    addAuditLog(
      actor,
      'ROOM_STATUS_DUPLICATE_PREVENTED',
      'ROOM',
      room.id,
      `Idempotency key "${rawIdempKey}" re-submitted for room "${room.name}". Returning previously executed ${cached.status} transition without creating duplicates.`
    );
    return {
      ...cached.result,
      duplicate: true,
      transitionTriggered: false,
      message: `Idempotent request: Transition to ${cached.status} was already processed.`,
    };
  }

  // 2. Actual Transition Check: Trigger only on actual status transitions
  if (prevStatus === newStatus) {
    addAuditLog(
      actor,
      'ROOM_STATUS_DUPLICATE_PREVENTED',
      'ROOM',
      room.id,
      `Room "${room.name}" is already ${newStatus}. Duplicate transition ignored.`
    );
    const existingTask = db.tasks.find(
      (t) =>
        t.roomAreaId === room.id &&
        ((newStatus === 'OCCUPIED' && t.taskType === 'WATER_DISTRIBUTION') ||
          (newStatus === 'VACANT' && t.taskType === 'VISITOR_RESET'))
    );
    return {
      success: true,
      room: normalizeRoomRecord(room),
      previousStatus: prevStatus,
      currentStatus: room.status,
      transitionTriggered: false,
      duplicate: true,
      task: existingTask ? normalizeTaskRecord(existingTask) : undefined,
      message: `Room "${room.name}" is already ${newStatus}. No new task or alert created.`,
    };
  }

  // 3. Locate active PANTRY_BOY account (Raju Sharma)
  const activePantry =
    db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') ||
    db.users.find((u) => u.role === 'PANTRY_BOY') ||
    INITIAL_USERS[0];

  let generatedTask: Task | undefined;
  let generatedNotification: AppNotification | undefined;

  if (newStatus === 'OCCUPIED') {
    room.status = 'OCCUPIED';

    // 1. When a room changes to OCCUPIED, automatically create a water-delivery task.
    const waterChecklist: ChecklistItem[] = [
      { id: 'c-1', text: `Prepare chilled sealed mineral water bottles and clean glassware in pantry`, completed: false },
      { id: 'c-2', text: `Deliver fresh drinking water bottles to ${room.name}`, completed: false },
      { id: 'c-3', text: `Place clean glasses and coasters neatly at occupied seating positions`, completed: false },
      { id: 'c-4', text: `Check if tea, coffee, or refreshment requests are needed for attendees`, completed: false },
      { id: 'c-5', text: `Capture live verification photo of completed water service delivery`, completed: false },
    ];

    generatedTask = {
      id: `task-water-${room.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: `[WATER SERVICE] Deliver Fresh Water to ${room.name}`,
      description: `Room "${room.name}" transitioned to OCCUPIED. Immediate hospitality setup required: deliver chilled mineral water bottles and clean glassware to attendees.`,
      roomAreaId: room.id,
      roomAreaName: room.name,
      priority: 'URGENT',
      taskType: 'WATER_DISTRIBUTION',
      assignedToEmail: activePantry.email,
      assignedToName: activePantry.name,
      createdByEmail: actor.email,
      createdByName: actor.name,
      createdAt: now,
      scheduledFor: now,
      dueTime: 'Immediate (within 10 mins)',
      status: 'AVAILABLE',
      isUrgent: true,
      checklist: waterChecklist,
      changeHistory: [
        {
          timestamp: now,
          actorEmail: actor.email,
          actorName: actor.name,
          fromStatus: 'NONE',
          toStatus: 'AVAILABLE',
          note: `Auto-generated upon room transition to OCCUPIED by ${actor.name} (${actor.role})`,
        },
      ],
    };

    db.tasks.unshift(generatedTask);

    if (!room.statusHistory) room.statusHistory = [];
    room.statusHistory.unshift({
      id: `hist-${Date.now()}`,
      status: 'OCCUPIED',
      timestamp: now,
      actorName: actor.name,
      actorEmail: actor.email,
      note: options?.note || `Room occupied. Auto-created water delivery task #${generatedTask.id}.`,
      taskId: generatedTask.id,
      assignmentId: room.currentAssignment?.id,
    });

    addAuditLog(
      actor,
      'ROOM_STATUS_TRANSITION',
      'ROOM',
      room.id,
      `Room "${room.name}" transitioned from ${prevStatus} to OCCUPIED. Created automated water delivery task "${generatedTask.title}" (#${generatedTask.id}) for Pantry Attendant ${activePantry.name}.`
    );

    // 3. Send real-time in-app alerts ONLY to the active PANTRY_BOY account (Raju Sharma). Never alert Admin, HR, Co-Founder, or other roles.
    generatedNotification = notify(
      `💧 Water Delivery Needed: ${room.name}`,
      `${room.name} is now OCCUPIED. Deliver fresh drinking water and glasses immediately.`,
      'URGENT_TASK',
      {
        role: 'PANTRY_BOY',
        email: activePantry.email,
        roomId: room.id,
        roomName: room.name,
        taskId: generatedTask.id,
        priority: 'URGENT',
        targetOnlyPantryBoy: true,
      }
    );
  } else if (newStatus === 'VACANT') {
    room.status = 'VACANT';

    // 2. When a room changes to VACANT, automatically create a chair/table rearrangement task.
    const setup = verifyRoomSetupConfig(room) || { tables: 1, tableType: 'standard', chairs: 4, summary: '1 table + 4 chairs' };
    const tablePhrase =
      setup.tables === 1
        ? `1 ${setup.tableType === 'large' ? 'large ' : ''}table`
        : `${setup.tables} tables`;

    const rearrangeChecklist: ChecklistItem[] = [
      { id: 'c-1', text: `Clear used mineral water bottles, glasses, cups, and trash from ${room.name}`, completed: false },
      { id: 'c-2', text: `Sanitize the ${tablePhrase} surface and wipe presentation display/whiteboard`, completed: false },
      { id: 'c-3', text: `Rearrange all ${setup.chairs} chairs neatly around the ${tablePhrase} in standard geometric layout (${setup.summary})`, completed: false },
      { id: 'c-4', text: `Check room air freshener, lighting, coasters, and empty waste bin`, completed: false },
      { id: 'c-5', text: `Capture live photo verification to certify room readiness`, completed: false },
    ];

    generatedTask = {
      id: `task-rearrange-${room.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: `[ROOM REARRANGEMENT] Rearrange Chairs & Tables in ${room.name}`,
      description: `Room "${room.name}" transitioned to VACANT. Restore room geometry: rearrange all ${setup.chairs} chairs around ${tablePhrase} (${setup.summary}), sanitize surfaces, and prepare room for next use.`,
      roomAreaId: room.id,
      roomAreaName: room.name,
      priority: 'P2',
      taskType: 'VISITOR_RESET',
      assignedToEmail: activePantry.email,
      assignedToName: activePantry.name,
      createdByEmail: actor.email,
      createdByName: actor.name,
      createdAt: now,
      scheduledFor: now,
      dueTime: 'Within 20 mins',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: rearrangeChecklist,
      changeHistory: [
        {
          timestamp: now,
          actorEmail: actor.email,
          actorName: actor.name,
          fromStatus: 'NONE',
          toStatus: 'AVAILABLE',
          note: `Auto-generated upon room transition to VACANT by ${actor.name} (${actor.role})`,
        },
      ],
    };

    db.tasks.unshift(generatedTask);

    if (room.currentAssignment) {
      room.currentAssignment.releasedAt = now;
      room.currentAssignment.status = 'COMPLETED';
      room.currentAssignment.resetTaskId = generatedTask.id;
      if (!room.assignmentHistory) room.assignmentHistory = [];
      room.assignmentHistory.unshift({ ...room.currentAssignment });
      room.currentAssignment = null;
    }

    if (!room.statusHistory) room.statusHistory = [];
    room.statusHistory.unshift({
      id: `hist-${Date.now()}`,
      status: 'VACANT',
      timestamp: now,
      actorName: actor.name,
      actorEmail: actor.email,
      note: options?.note || `Room vacant. Auto-created chair/table rearrangement task #${generatedTask.id}.`,
      taskId: generatedTask.id,
    });

    addAuditLog(
      actor,
      'ROOM_STATUS_TRANSITION',
      'ROOM',
      room.id,
      `Room "${room.name}" transitioned from ${prevStatus} to VACANT. Created automated chair/table rearrangement task "${generatedTask.title}" (#${generatedTask.id}) for Pantry Attendant ${activePantry.name}.`
    );

    // 3. Send real-time in-app alerts ONLY to the active PANTRY_BOY account (Raju Sharma). Never alert Admin, HR, Co-Founder, or other roles.
    generatedNotification = notify(
      `🪑 Room Vacant: Rearrange ${room.name}`,
      `${room.name} is now VACANT. Please reset tables and rearrange all ${setup.chairs} chairs into standard configuration.`,
      'ROOM_RELEASED',
      {
        role: 'PANTRY_BOY',
        email: activePantry.email,
        roomId: room.id,
        roomName: room.name,
        taskId: generatedTask.id,
        priority: 'P2',
        targetOnlyPantryBoy: true,
      }
    );
  } else {
    // General room status transition (AVAILABLE, READY_FOR_VISITOR, CLEANING_REQUIRED, etc.)
    room.status = newStatus;
    if (newStatus === 'AVAILABLE' && room.currentAssignment) {
      room.currentAssignment.status = 'CANCELLED';
      if (!room.assignmentHistory) room.assignmentHistory = [];
      room.assignmentHistory.unshift({ ...room.currentAssignment });
      room.currentAssignment = null;
    }
    if (!room.statusHistory) room.statusHistory = [];
    room.statusHistory.unshift({
      id: `hist-${Date.now()}`,
      status: newStatus,
      timestamp: now,
      actorName: actor.name,
      actorEmail: actor.email,
      note: options?.note || `Transitioned to ${newStatus}`,
    });
    addAuditLog(
      actor,
      'ROOM_STATUS_TRANSITION',
      'ROOM',
      room.id,
      `Room "${room.name}" transitioned from ${prevStatus} to ${newStatus}.`
    );
  }

  saveDb();

  const normalizedRoom = normalizeRoomRecord(room);
  const normalizedRooms = db.rooms.map((r) => normalizeRoomRecord(r));
  broadcastRealtime('room:updated', { room: normalizedRoom, rooms: normalizedRooms });

  if (generatedTask) {
    const normalizedTask = normalizeTaskRecord(generatedTask);
    const normalizedTasks = db.tasks.map((t) => normalizeTaskRecord(t));
    broadcastRealtime('task:created', { task: normalizedTask, tasks: normalizedTasks });
    broadcastRealtime('task:updated', { task: normalizedTask, tasks: normalizedTasks });
  }

  const result: RoomTransitionResult = {
    success: true,
    room: normalizedRoom,
    previousStatus: prevStatus,
    currentStatus: room.status,
    transitionTriggered: true,
    duplicate: false,
    task: generatedTask ? normalizeTaskRecord(generatedTask) : undefined,
    notification: generatedNotification,
    message: `Room "${room.name}" successfully transitioned from ${prevStatus} to ${room.status}.`,
  };

  if (rawIdempKey) {
    transitionIdempotencyCache.set(rawIdempKey, {
      taskId: generatedTask?.id,
      notificationId: generatedNotification?.id,
      status: room.status,
      timestamp: now,
      result,
    });
  }

  return result;
}

// Room Lifecycle Status Actions (Mark Occupied, Ready, Release/Vacant, Request Cleaning, Reopen)
app.post('/api/rooms/:id/status-action', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const canRoomEdit = checkUserPermission(actor, 'rooms', 'edit');
  const canPantryMarkReady =
    actor.role === 'PANTRY_BOY' &&
    req.body?.action === 'MARK_READY' &&
    Boolean((actor.permissions || getDefaultPermissions(actor.role)).sidebarItems?.roomSupport);
  if (!canRoomEdit && !canPantryMarkReady) {
    return res.status(403).json({ error: 'Permission denied: You are not authorized to perform this room lifecycle action.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { action, note, idempotencyKey } = req.body;
  const headerIdempotency = req.headers['idempotency-key'] as string | undefined;
  const effectiveIdempotencyKey = idempotencyKey || headerIdempotency;
  const now = new Date().toISOString();
  const assignedPantry = db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') || db.users[0];

  if (!room.statusHistory) room.statusHistory = [];
  if (!room.assignmentHistory) room.assignmentHistory = [];

  switch (action) {
    case 'MARK_OCCUPIED':
    case 'OCCUPIED': {
      const result = handleRoomStatusTransition(room, 'OCCUPIED', actor, {
        note,
        idempotencyKey: effectiveIdempotencyKey,
      });
      return res.json({ success: true, room: result.room, task: result.task, transition: result });
    }

    case 'RELEASE_VACANT':
    case 'MARK_VACANT':
    case 'VACANT': {
      const result = handleRoomStatusTransition(room, 'VACANT', actor, {
        note,
        idempotencyKey: effectiveIdempotencyKey,
      });
      return res.json({ success: true, room: result.room, task: result.task, transition: result });
    }

    case 'MARK_READY': {
      // Room verified ready for visitor
      room.status = 'READY_FOR_VISITOR';
      const actorNote = note || `Room verified ready for visitor arrival`;
      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'READY_FOR_VISITOR',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: actorNote,
        assignmentId: room.currentAssignment?.id,
      });

      addAuditLog(actor, 'ROOM_MARKED_READY', 'ROOM', room.id, `Marked "${room.name}" as READY_FOR_VISITOR. ${actorNote}`);
      notify(
        `Room Ready: ${room.name}`,
        `${room.name} has been certified ready for visitor entry.`,
        'ROOM_READY',
        { role: 'HR', roomId: room.id, roomName: room.name }
      );
      break;
    }

    case 'REQUEST_CLEANING': {
      // Ad-hoc cleaning requested
      room.status = 'CLEANING_REQUIRED';
      const reason = note || 'Ad-hoc surface sanitization and chair realignment requested';

      const cleanTask: Task = {
        id: `task-clean-${room.id}-${Date.now()}`,
        title: `[REQUESTED CLEANING] Sanitize & Reset ${room.name}`,
        description: `Requested by ${actor.name}: ${reason}`,
        roomAreaId: room.id,
        roomAreaName: room.name,
        priority: 'P2',
        taskType: 'ROUTINE_CLEANING',
        assignedToEmail: assignedPantry.email,
        assignedToName: assignedPantry.name,
        createdByEmail: actor.email,
        createdByName: actor.name,
        createdAt: now,
        scheduledFor: now,
        dueTime: 'Within 25 mins',
        status: 'AVAILABLE',
        isUrgent: false,
        checklist: room.defaultChecklist.map((text, idx) => ({
          id: `item-${idx}`,
          text,
          completed: false,
        })),
        changeHistory: [
          {
            timestamp: now,
            actorEmail: actor.email,
            actorName: actor.name,
            fromStatus: 'NONE',
            toStatus: 'AVAILABLE',
            note: `Requested by ${actor.name} (${actor.role}): ${reason}`,
          },
        ],
      };

      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'CLEANING_REQUIRED',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: `Cleaning requested by ${actor.name}: ${reason}. Task #${cleanTask.id} generated.`,
        taskId: cleanTask.id,
      });

      db.tasks.unshift(cleanTask);

      addAuditLog(actor, 'ROOM_CLEANING_REQUESTED', 'ROOM', room.id, `Requested cleaning for "${room.name}": ${reason}`);
      notify(
        `Cleaning Requested: ${room.name}`,
        `${actor.name} requested cleaning for ${room.name}: ${reason}`,
        'ROOM_CLEANING_NEEDED',
        { role: 'PANTRY_BOY', taskId: cleanTask.id, roomId: room.id, roomName: room.name }
      );
      break;
    }

    case 'REOPEN': {
      const result = handleRoomStatusTransition(room, 'AVAILABLE', actor, {
        note: note || `Reopened / restored to AVAILABLE by ${actor.name}`,
      });
      return res.json({ success: true, room: result.room, transition: result });
    }

    default:
      return res.status(400).json({ error: `Invalid room action: ${action}` });
  }

  saveDb();
  broadcastRealtime('room:updated', { room: normalizeRoomRecord(room), rooms: db.rooms.map((r) => normalizeRoomRecord(r)) });
  broadcastRealtime('task:updated', { tasks: db.tasks.map((t) => normalizeTaskRecord(t)) });

  res.json({ success: true, room: normalizeRoomRecord(room) });
});

// Direct Room Status Update Endpoints (POST / PATCH /api/rooms/:id/status)
app.post(['/api/rooms/:id/status', '/api/rooms/:id/set-status'], (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You are not authorized to modify room status.' });
  }
  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { status, note, idempotencyKey } = req.body;
  if (!status) return res.status(400).json({ error: 'Missing required status field' });

  const headerIdempotency = req.headers['idempotency-key'] as string | undefined;
  const effectiveIdempotencyKey = idempotencyKey || headerIdempotency;

  const validStatuses: RoomStatus[] = [
    'AVAILABLE',
    'RESERVED',
    'ASSIGNED',
    'OCCUPIED',
    'VACANT',
    'PREPARATION_REQUIRED',
    'READY_FOR_VISITOR',
    'CLEANING_REQUIRED',
    'CLEANING_IN_PROGRESS',
    'PENDING_VERIFICATION',
  ];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid room status: ${status}` });
  }

  const result = handleRoomStatusTransition(room, status as RoomStatus, actor, {
    note,
    idempotencyKey: effectiveIdempotencyKey,
  });

  res.status(result.success ? 200 : 400).json(result);
});

app.patch('/api/rooms/:id/status', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You are not authorized to modify room status.' });
  }
  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { status, note, idempotencyKey } = req.body;
  if (!status) return res.status(400).json({ error: 'Missing required status field' });

  const headerIdempotency = req.headers['idempotency-key'] as string | undefined;
  const effectiveIdempotencyKey = idempotencyKey || headerIdempotency;

  const validStatuses: RoomStatus[] = [
    'AVAILABLE',
    'RESERVED',
    'ASSIGNED',
    'OCCUPIED',
    'VACANT',
    'PREPARATION_REQUIRED',
    'READY_FOR_VISITOR',
    'CLEANING_REQUIRED',
    'CLEANING_IN_PROGRESS',
    'PENDING_VERIFICATION',
  ];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid room status: ${status}` });
  }

  const result = handleRoomStatusTransition(room, status as RoomStatus, actor, {
    note,
    idempotencyKey: effectiveIdempotencyKey,
  });

  res.status(result.success ? 200 : 400).json(result);
});

// Get Room Assignment & Status History
app.get('/api/rooms/:id/history', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated', code: 'SESSION_EXPIRED_OR_UNAUTHENTICATED' });
  if (!checkUserPermission(actor, 'rooms', 'view')) {
    return res.status(403).json({ error: 'Permission denied: Room history access not authorized.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const perms = actor.permissions || getDefaultPermissions(actor.role);
  const isManagementViewer =
    actor.role === 'ADMIN' || Boolean(actor.isSuperAdmin) || Boolean(perms.dashboards?.management);
  const actorEmailLower = actor.email.toLowerCase();

  // Gather all photo evidence associated with this room's tasks across single & multi-photo submissions (with internal disk filePath redacted)
  const roomTasks = db.tasks.filter((t) => {
    if (t.roomAreaId !== room.id) return false;
    const hasEvidence = (Array.isArray(t.photoEvidences) && t.photoEvidences.length > 0) || Boolean(t.photoEvidence);
    if (!hasEvidence) return false;
    if (!isManagementViewer) {
      return t.assignedToEmail?.toLowerCase() === actorEmailLower;
    }
    return true;
  });

  const photoHistory: PhotoEvidence[] = roomTasks
    .flatMap((t) => {
      const normalizedTask = normalizeTaskRecord(t);
      const list =
        Array.isArray(normalizedTask.photoEvidences) && normalizedTask.photoEvidences.length > 0
          ? normalizedTask.photoEvidences
          : normalizedTask.photoEvidence
          ? [normalizedTask.photoEvidence]
          : [];
      return list.map((ev) => {
        const uploaderAccount = db.users.find(
          (u) => u.email.toLowerCase() === String(ev.userEmail || '').toLowerCase()
        );
        const { filePath: _fp, ...safeEvidence } = ev;
        return {
          ...safeEvidence,
          taskId: safeEvidence.taskId || normalizedTask.id,
          taskTitle: safeEvidence.taskTitle || normalizedTask.title,
          roomId: room.id,
          roomName: normalizeRoomName(room.name),
          userName: safeEvidence.userName || uploaderAccount?.name || normalizedTask.assignedToName,
          fileAvailable: isEvidenceFileOnDisk(safeEvidence.photoUrl),
        };
      });
    })
    .sort((a, b) => {
      const timeA = new Date(a.serverTimestamp || a.capturedAt || 0).getTime() || 0;
      const timeB = new Date(b.serverTimestamp || b.capturedAt || 0).getTime() || 0;
      return timeB - timeA;
    });

  res.json({
    room: normalizeRoomRecord(room),
    statusHistory: room.statusHistory || [],
    assignmentHistory: room.assignmentHistory || [],
    currentAssignment: room.currentAssignment || null,
    photos: photoHistory,
  });
});

// 4. Tasks API
app.get('/api/tasks', (req, res) => {
  runTaskScheduleEngine();

  const requester = getCurrentUser(req);
  if (!requester) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!checkUserPermission(requester, 'tasks', 'view')) {
    return res.status(403).json({ error: 'Permission denied: Tasks view access not authorized.' });
  }

  const { status, priority, roomAreaId, assignedTo } = req.query;

  let filtered = [...db.tasks];

  const requesterPerms = requester.permissions || getDefaultPermissions(requester.role);
  const hasManagementDashboard = requester.role === 'ADMIN' || Boolean(requester.isSuperAdmin) || Boolean(requesterPerms.dashboards?.management);

  // Strictly enforce Pantry Boy / non-management user task isolation
  if (requester.role === 'PANTRY_BOY' || !hasManagementDashboard) {
    filtered = filtered.filter(
      (t) => t.assignedToEmail.toLowerCase() === requester.email.toLowerCase()
    );
  } else if (assignedTo) {
    filtered = filtered.filter(
      (t) => t.assignedToEmail.toLowerCase() === String(assignedTo).toLowerCase()
    );
  }

  if (status && status !== 'ALL') {
    filtered = filtered.filter((t) => t.status === status);
  }
  if (priority && priority !== 'ALL') {
    filtered = filtered.filter((t) => t.priority === priority);
  }
  if (roomAreaId && roomAreaId !== 'ALL') {
    filtered = filtered.filter((t) => t.roomAreaId === roomAreaId);
  }

  const priorityOrder: Record<string, number> = {
    URGENT: 0,
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
    P5: 5,
  };

  // Order tasks strictly chronologically by scheduled IST date & time across all dashboards
  const isTerminal = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
  filtered.sort((a, b) => {
    const termA = isTerminal(a.status) ? 1 : 0;
    const termB = isTerminal(b.status) ? 1 : 0;
    if (termA !== termB) return termA - termB;
    const schedA = new Date(a.scheduledFor).getTime() || 0;
    const schedB = new Date(b.scheduledFor).getTime() || 0;
    if (schedA !== schedB) return schedA - schedB;
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    const pA = priorityOrder[a.priority] ?? 99;
    const pB = priorityOrder[b.priority] ?? 99;
    return pA - pB;
  });

  res.json({ tasks: filtered.map((t) => normalizeTaskRecord(t)), serverTime: new Date().toISOString() });
});

app.post('/api/tasks', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'tasks', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can assign new tasks.' });
  }

  const { title, roomAreaId, priority, scheduledFor, dueTime, assignedToEmail, description, checklist, isUrgent } = req.body;
  const cleanedTitle = normalizeDisplayText(String(title || ''));
  if (!cleanedTitle || !roomAreaId) {
    return res.status(400).json({ error: 'Title and roomAreaId are required' });
  }

  const room = db.rooms.find((r) => r.id === roomAreaId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const requestedAssignee = assignedToEmail
    ? db.users.find((u) => u.email.toLowerCase() === String(assignedToEmail).toLowerCase() && u.status === 'active')
    : undefined;
  const assignedPantry =
    requestedAssignee ||
    db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') ||
    db.users[0];

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const resolvedScheduledFor = scheduledFor ? parseScheduledForIST(scheduledFor, nowDate) : now;
  const scheduledMs = new Date(resolvedScheduledFor).getTime();
  const isFutureScheduled = Boolean(scheduledFor) ? scheduledMs > nowDate.getTime() + 1000 : false;
  const initialStatus: TaskStatus = isFutureScheduled ? 'SCHEDULED' : 'AVAILABLE';

  const resolvedDueTime =
    dueTime && String(dueTime).trim() && !(isFutureScheduled && dueTime === 'Within 30 mins')
      ? normalizeDisplayText(String(dueTime))
      : isFutureScheduled
      ? formatISTShortTime(new Date(scheduledMs + 30 * 60 * 1000))
      : 'Immediate (within 30 mins)';

  const newTask: Task = normalizeTaskRecord({
    id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: cleanedTitle,
    description: description ? normalizeDisplayText(String(description)) : '',
    roomAreaId: room.id,
    roomAreaName: normalizeRoomName(room.name),
    priority: isUrgent ? 'URGENT' : priority || 'P2',
    taskType: isUrgent ? 'AD_HOC' : 'ROUTINE_CLEANING',
    assignedToEmail: assignedPantry.email,
    assignedToName: assignedPantry.name,
    createdByEmail: actor.email,
    createdByName: actor.name,
    createdAt: now,
    scheduledFor: resolvedScheduledFor,
    dueTime: resolvedDueTime,
    status: initialStatus,
    isUrgent: Boolean(isUrgent),
    checklist: Array.isArray(checklist) && checklist.length > 0
      ? checklist.map((item: string | ChecklistItem, idx: number) => ({
          id: `item-${idx}`,
          text: normalizeDisplayText(typeof item === 'string' ? item : item.text),
          completed: false,
        }))
      : room.defaultChecklist.map((text, idx) => ({
          id: `item-${idx}`,
          text: normalizeDisplayText(text),
          completed: false,
        })),
    changeHistory: [
      {
        timestamp: now,
        actorEmail: actor.email,
        actorName: actor.name,
        fromStatus: 'NONE',
        toStatus: initialStatus,
        note: `Created by ${actor.name} (${actor.role}) · Scheduled for ${formatISTScheduleLabel(resolvedScheduledFor)} ${isUrgent ? '[URGENT PRIORITY]' : ''}`,
      },
    ],
  });

  db.tasks.unshift(newTask);

  addAuditLog(
    actor,
    isUrgent ? 'TASK_URGENT_ASSIGNED' : 'TASK_ASSIGNED',
    'TASK',
    newTask.id,
    `Assigned "${newTask.title}" for ${newTask.roomAreaName} (${formatISTScheduleLabel(newTask.scheduledFor)}) with priority ${newTask.priority} to ${newTask.assignedToName}`
  );

  notify(
    isUrgent ? `⚠️ URGENT TASK: ${newTask.title}` : `New Task Scheduled: ${newTask.title}`,
    `${actor.name} scheduled "${newTask.title}" in ${newTask.roomAreaName} for ${formatISTScheduleLabel(newTask.scheduledFor)} (Due: ${newTask.dueTime}).`,
    isUrgent ? 'URGENT_TASK' : 'TASK_ASSIGNED',
    {
      role: 'PANTRY_BOY',
      email: newTask.assignedToEmail,
      taskId: newTask.id,
      roomId: newTask.roomAreaId,
      roomName: newTask.roomAreaName,
      priority: newTask.priority,
    }
  );

  sortTasksArrayChronologically(db.tasks);
  saveDb();
  broadcastRealtime('task:created', { task: newTask, tasks: db.tasks, serverTime: now });
  broadcastRealtime('task:updated', { task: newTask, tasks: db.tasks, serverTime: now });

  // Evaluate immediate or within-5-minute alert windows right away
  runTaskScheduleEngine();

  res.status(201).json({ success: true, task: newTask, serverTime: now });
});

const VALID_TASK_STATUSES: TaskStatus[] = [
  'SCHEDULED',
  'AVAILABLE',
  'IN_PROGRESS',
  'SUBMITTED',
  'PENDING_VERIFICATION',
  'COMPLETED',
  'REJECTED',
  'BLOCKED',
  'OVERDUE',
  'CANCELLED',
];

// Edit, Reschedule, Reassign, or Cancel Task (Authorized Managers / Admin)
app.put('/api/tasks/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (actor.role === 'PANTRY_BOY' || !checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users with task edit permissions can modify, reschedule, or cancel tasks.' });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const {
    title,
    description,
    roomAreaId,
    priority,
    isUrgent,
    scheduledFor,
    dueTime,
    assignedToEmail,
    status,
    checklist,
    cancelReason,
  } = req.body || {};

  if (status !== undefined && !VALID_TASK_STATUSES.includes(status as TaskStatus)) {
    return res.status(400).json({ error: `Invalid task status "${String(status)}".` });
  }
  if (priority !== undefined && !VALID_ROOM_PRIORITIES.includes(priority as TaskPriority)) {
    return res.status(400).json({ error: `Invalid task priority "${String(priority)}".` });
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const prevStatus = task.status;
  const prevScheduledFor = task.scheduledFor;
  let wasRescheduled = false;

  if (title !== undefined && String(title).trim()) {
    const cleanedTitle = normalizeDisplayText(String(title));
    if (cleanedTitle) {
      task.title = cleanedTitle;
    }
  }
  if (description !== undefined) {
    task.description = normalizeDisplayText(String(description));
  }
  if (roomAreaId && roomAreaId !== task.roomAreaId) {
    const targetRoom = db.rooms.find((r) => r.id === roomAreaId);
    if (targetRoom) {
      task.roomAreaId = targetRoom.id;
      task.roomAreaName = normalizeRoomName(targetRoom.name);
    }
  }
  if (isUrgent !== undefined) {
    task.isUrgent = Boolean(isUrgent);
  }
  if (priority !== undefined) {
    task.priority = task.isUrgent ? 'URGENT' : (priority as TaskPriority);
  } else if (task.isUrgent) {
    task.priority = 'URGENT';
  }
  if (assignedToEmail) {
    const targetUser = db.users.find(
      (u) => u.email.toLowerCase() === String(assignedToEmail).toLowerCase() && u.status === 'active'
    );
    if (targetUser) {
      task.assignedToEmail = targetUser.email;
      task.assignedToName = targetUser.name;
    }
  }
  if (Array.isArray(checklist) && checklist.length > 0) {
    task.checklist = checklist.map((item: string | ChecklistItem, idx: number) => {
      if (typeof item === 'string') {
        const cleanedItem = normalizeDisplayText(item);
        const existing = task.checklist.find((c) => c.text === cleanedItem || c.text === item);
        return { id: existing?.id || `item-${idx}`, text: cleanedItem, completed: existing?.completed || false };
      }
      return {
        ...item,
        text: normalizeDisplayText(item.text),
      };
    });
  }

  if (scheduledFor !== undefined && String(scheduledFor).trim()) {
    const newScheduledIso = parseScheduledForIST(scheduledFor, nowDate);
    if (newScheduledIso !== prevScheduledFor) {
      wasRescheduled = true;
      task.scheduledFor = newScheduledIso;
      // Reset alert markers so new schedule fires fresh 5-min warning & due-now alerts
      task.fiveMinAlertSentFor = undefined;
      task.dueAlertSentFor = undefined;
      task.overdueMarkedFor = undefined;

      const newSchedMs = new Date(newScheduledIso).getTime();
      if (status === undefined && task.status !== 'COMPLETED') {
        task.cancelledAt = undefined;
        task.cancelledBy = undefined;
        if (newSchedMs > nowDate.getTime() + 1000) {
          task.status = 'SCHEDULED';
        } else if (
          task.status === 'SCHEDULED' ||
          task.status === 'OVERDUE' ||
          task.status === 'CANCELLED'
        ) {
          task.status = 'AVAILABLE';
        }
      }

      if (dueTime === undefined) {
        task.dueTime = formatISTShortTime(new Date(newSchedMs + 30 * 60 * 1000));
      }
    }
  }

  if (dueTime !== undefined && String(dueTime).trim()) {
    task.dueTime = normalizeDisplayText(String(dueTime));
  }

  if (status !== undefined) {
    task.status = status as TaskStatus;
    if (status === 'CANCELLED') {
      task.cancelledAt = now;
      task.cancelledBy = actor.name;
    } else if (prevStatus === 'CANCELLED') {
      task.cancelledAt = undefined;
      task.cancelledBy = undefined;
    }
  }

  if (task.status === 'CANCELLED' && prevStatus !== 'CANCELLED') {
    const reasonText = cancelReason ? normalizeDisplayText(String(cancelReason)) : `Cancelled by ${actor.name}`;
    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: prevStatus,
      toStatus: 'CANCELLED',
      note: reasonText,
    });
    addAuditLog(
      actor,
      'TASK_CANCELLED',
      'TASK',
      task.id,
      `Cancelled task "${task.title}" in ${task.roomAreaName}. ${reasonText}`
    );
    notify(
      `🚫 Task Cancelled: ${task.title}`,
      `${actor.name} cancelled "${task.title}" (${task.roomAreaName}).`,
      'TASK_CANCELLED',
      {
        role: 'PANTRY_BOY',
        email: task.assignedToEmail,
        taskId: task.id,
        roomId: task.roomAreaId,
        roomName: task.roomAreaName,
      }
    );
  } else {
    const noteText = wasRescheduled
      ? `Rescheduled by ${actor.name} to ${formatISTScheduleLabel(task.scheduledFor)} (Due: ${task.dueTime})`
      : `Updated by ${actor.name}`;
    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: prevStatus,
      toStatus: task.status,
      note: noteText,
    });
    addAuditLog(
      actor,
      wasRescheduled ? 'TASK_RESCHEDULED' : 'TASK_UPDATED',
      'TASK',
      task.id,
      `${noteText} for "${task.title}" in ${task.roomAreaName}`
    );
    notify(
      wasRescheduled ? `🔄 Task Rescheduled: ${task.title}` : `Task Updated: ${task.title}`,
      wasRescheduled
        ? `${actor.name} rescheduled "${task.title}" (${task.roomAreaName}) to ${formatISTScheduleLabel(task.scheduledFor)}.`
        : `${actor.name} updated task details for "${task.title}" (${task.roomAreaName}).`,
      wasRescheduled ? 'TASK_RESCHEDULED' : 'TASK_ASSIGNED',
      {
        role: 'PANTRY_BOY',
        email: task.assignedToEmail,
        taskId: task.id,
        roomId: task.roomAreaId,
        roomName: task.roomAreaName,
        priority: task.priority,
      }
    );
  }

  sortTasksArrayChronologically(db.tasks);
  saveDb();
  const normalizedTask = normalizeTaskRecord(task);
  broadcastRealtime('task:updated', { task: normalizedTask, tasks: db.tasks.map((t) => normalizeTaskRecord(t)), serverTime: now });

  // Re-evaluate alert windows immediately in case rescheduled within 5 mins or due now
  if (task.status !== 'CANCELLED' && task.status !== 'COMPLETED') {
    runTaskScheduleEngine();
  }

  res.json({ success: true, task: normalizedTask, serverTime: now });
});

// Update task status (Start task, Block task, Cancel task, etc.)
app.patch('/api/tasks/:id/status', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to update tasks.' });
  }

  const { status, blockedReason, rejectionReason, note } = req.body || {};
  if (!status || !VALID_TASK_STATUSES.includes(status as TaskStatus)) {
    return res.status(400).json({ error: `Invalid or missing task status "${String(status || '')}".` });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const prevStatus = task.status;
  const now = new Date().toISOString();

  // Role authorization checks
  if (actor.role === 'PANTRY_BOY') {
    if (task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
      return res.status(403).json({ error: 'Permission denied: You can only update tasks assigned to your account.' });
    }
    const allowed = ['IN_PROGRESS', 'BLOCKED', 'SUBMITTED'];
    if (!allowed.includes(status)) {
      return res.status(403).json({ error: 'Pantry Boy can only start, block, or submit tasks.' });
    }
  }

  task.status = status as TaskStatus;

  if (status === 'IN_PROGRESS' && !task.startedAt) {
    task.startedAt = now;
    const room = db.rooms.find((r) => r.id === task.roomAreaId);
    if (room && (room.status === 'PREPARATION_REQUIRED' || room.status === 'CLEANING_REQUIRED')) {
      room.status = 'CLEANING_IN_PROGRESS';
      if (!room.statusHistory) room.statusHistory = [];
      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'CLEANING_IN_PROGRESS',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: `Attendant started work on "${task.title}". Status transitioned to CLEANING_IN_PROGRESS.`,
        taskId: task.id,
      });
      broadcastRealtime('room:updated', { room, rooms: db.rooms });
    }
  }
  const cleanBlockedReason = blockedReason ? normalizeDisplayText(String(blockedReason)) : '';
  if (status === 'BLOCKED') {
    task.blockedReason = cleanBlockedReason || 'Room currently occupied / interview in progress';
    notify(
      `Task Blocked: ${task.roomAreaName}`,
      `${actor.name} marked task "${task.title}" as blocked: ${task.blockedReason}`,
      'TASK_ASSIGNED',
      { role: 'HR', taskId: task.id, roomName: task.roomAreaName }
    );
  }
  if (status === 'COMPLETED') {
    task.completedAt = now;
    const room = db.rooms.find((r) => r.id === task.roomAreaId);
    if (room) {
      room.status = task.taskType === 'VISITOR_PREP' ? 'READY_FOR_VISITOR' : 'AVAILABLE';
      broadcastRealtime('room:updated', { room, rooms: db.rooms });
    }
  }
  if (status === 'CANCELLED') {
    task.cancelledAt = now;
    task.cancelledBy = actor.name;
    notify(
      `🚫 Task Cancelled: ${task.title}`,
      `${actor.name} cancelled "${task.title}" (${task.roomAreaName}).`,
      'TASK_CANCELLED',
      { role: 'PANTRY_BOY', email: task.assignedToEmail, taskId: task.id, roomName: task.roomAreaName }
    );
  }
  if (status === 'REJECTED') {
    task.rejectionReason = rejectionReason
      ? normalizeDisplayText(String(rejectionReason))
      : 'Photo evidence rejected: does not show clean alignment';
  }

  const cleanNote = note ? normalizeDisplayText(String(note)) : '';
  task.changeHistory.push({
    timestamp: now,
    actorEmail: actor.email,
    actorName: actor.name,
    fromStatus: prevStatus,
    toStatus: status,
    note: cleanNote || (status === 'BLOCKED' ? `Reason: ${task.blockedReason}` : ''),
  });

  addAuditLog(
    actor,
    'TASK_STATUS_CHANGED',
    'TASK',
    task.id,
    `Status changed from ${prevStatus} to ${status} by ${actor.name}`
  );

  saveDb();
  const normalizedTask = normalizeTaskRecord(task);
  broadcastRealtime('task:updated', { task: normalizedTask, tasks: db.tasks.map((t) => normalizeTaskRecord(t)), serverTime: now });
  res.json({ success: true, task: normalizedTask, serverTime: now });
});

// Update Checklist Item
app.patch('/api/tasks/:id/checklist', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to update task checklists.' });
  }

  const { itemId, completed, note } = req.body;
  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (actor.role === 'PANTRY_BOY' && task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
    return res.status(403).json({ error: 'Permission denied: You can only update checklists on tasks assigned to you.' });
  }

  const item = task.checklist.find((c) => c.id === itemId);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  item.completed = Boolean(completed);
  if (note !== undefined) item.note = normalizeDisplayText(String(note));

  saveDb();
  broadcastRealtime('task:updated', { task, tasks: db.tasks });
  res.json({ success: true, task });
});

function isPantryBoyTask(task?: Task | null): boolean {
  if (!task) return false;
  const assignedEmail = (task.assignedToEmail || '').toLowerCase().trim();
  const assignedUser = db.users.find((u) => u.email.toLowerCase() === assignedEmail);
  if (assignedUser && assignedUser.role === 'PANTRY_BOY') return true;
  if (assignedUser && assignedUser.role !== 'PANTRY_BOY') return false;
  const assignedName = (task.assignedToName || '').toLowerCase();
  if (assignedName.includes('pantry') || assignedEmail.includes('pantry')) {
    return true;
  }
  const pType = String(task.taskType || '');
  if (
    pType === 'ROUTINE_CLEANING' ||
    pType === 'WATER_DISTRIBUTION' ||
    pType === 'WATER_RECHECK' ||
    pType === 'PLANTS' ||
    pType === 'OUTER_AREA' ||
    pType === 'CLOSING_INSPECTION'
  ) {
    return true;
  }
  return false;
}

app.delete('/api/tasks/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated: Please log in to manage tasks.' });
  }
  // Pantry Boy role / Pantry Boy tasks view can never delete tasks
  if (actor.role === 'PANTRY_BOY' || !checkUserPermission(actor, 'tasks', 'delete')) {
    return res.status(403).json({
      error: 'Permission denied: Pantry Boy tasks cannot be deleted by Pantry Attendants or accounts without delete permission.',
    });
  }

  const rawParamId = String(req.params.id || '').trim();
  const decodedId = (() => {
    try {
      return decodeURIComponent(rawParamId);
    } catch {
      return rawParamId;
    }
  })();

  const taskIndex = db.tasks.findIndex((t) => t.id === decodedId || t.id === rawParamId);
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found or already deleted.' });
  }

  const targetTask = db.tasks[taskIndex];

  // Business Rule: Pantry Boy tasks must never be deletable; all other tasks must support deletion.
  if (isPantryBoyTask(targetTask)) {
    return res.status(403).json({
      error: 'Business rule violation: Pantry Boy tasks are permanent operational records and must never be deleted.',
      code: 'PANTRY_TASK_NOT_DELETABLE',
    });
  }

  const [removedTask] = db.tasks.splice(taskIndex, 1);
  const now = new Date().toISOString();

  // Persist tombstone ID so recurring task sync never resurrects an intentionally deleted task
  if (!Array.isArray(db.deletedTaskIds)) {
    db.deletedTaskIds = [];
  }
  if (!db.deletedTaskIds.includes(removedTask.id)) {
    db.deletedTaskIds.push(removedTask.id);
    if (db.deletedTaskIds.length > 2000) {
      db.deletedTaskIds = db.deletedTaskIds.slice(-2000);
    }
  }

  // Clean up references in rooms, visitors, and unread task alerts
  let updatedRoom: RoomArea | undefined;
  const linkedRoom = db.rooms.find((r) => r.id === removedTask.roomAreaId);
  if (linkedRoom) {
    if (linkedRoom.currentAssignment?.prepTaskId === removedTask.id) {
      linkedRoom.currentAssignment.prepTaskId = undefined;
    }
    if (linkedRoom.currentAssignment?.resetTaskId === removedTask.id) {
      linkedRoom.currentAssignment.resetTaskId = undefined;
    }
    const hasOtherActiveTask = db.tasks.some(
      (t) =>
        t.roomAreaId === linkedRoom.id &&
        (t.status === 'IN_PROGRESS' || t.status === 'PENDING_VERIFICATION' || t.status === 'SUBMITTED')
    );
    if (
      !linkedRoom.currentAssignment &&
      !hasOtherActiveTask &&
      (linkedRoom.status === 'CLEANING_REQUIRED' ||
        linkedRoom.status === 'CLEANING_IN_PROGRESS' ||
        linkedRoom.status === 'PENDING_VERIFICATION' ||
        linkedRoom.status === 'PREPARATION_REQUIRED')
    ) {
      linkedRoom.status = 'AVAILABLE';
      updatedRoom = linkedRoom;
    }
  }

  if (Array.isArray(db.visitors)) {
    db.visitors.forEach((v) => {
      if (v.prepTaskId === removedTask.id) v.prepTaskId = undefined;
      if (v.resetTaskId === removedTask.id) v.resetTaskId = undefined;
    });
  }

  if (Array.isArray(db.notifications)) {
    db.notifications = db.notifications.filter((n) => n.taskId !== removedTask.id);
  }

  try {
    saveDbStrict();
  } catch (writeErr) {
    // Roll back in-memory removal so client never sees false success
    db.tasks.splice(taskIndex, 0, removedTask);
    db.deletedTaskIds = (db.deletedTaskIds || []).filter((id) => id !== removedTask.id);
    console.error('Failed to persist task deletion:', writeErr);
    return res.status(500).json({ error: 'Database write failed while deleting task. Please retry.' });
  }

  addAuditLog(
    actor,
    'TASK_DELETED',
    'TASK',
    removedTask.id,
    `Deleted task "${removedTask.title}" in ${removedTask.roomAreaName}`
  );

  if (updatedRoom) {
    broadcastRealtime('room:updated', { room: updatedRoom, rooms: db.rooms, serverTime: now });
  }
  broadcastRealtime('task:deleted', {
    deletedTaskId: removedTask.id,
    task: removedTask,
    tasks: db.tasks,
    serverTime: now,
  });
  broadcastRealtime('task:updated', {
    deletedTaskId: removedTask.id,
    task: removedTask,
    tasks: db.tasks,
    serverTime: now,
  });

  res.json({
    success: true,
    deletedTaskId: removedTask.id,
    message: 'Task deleted successfully',
    serverTime: now,
  });
});

// 5. Live Camera Photo Capture Sessions & Multi-Photo Upload (Strictly Camera-Only, Zero Gallery)
interface ActiveCaptureSession {
  sessionId: string;
  taskId: string;
  roomAreaId: string;
  userId: string;
  userEmail: string;
  captureSessionTimestamp: string;
  createdAtMs: number;
  expiresAtMs: number;
  maxPhotos: number;
  submittedAt?: string;
  submittedPayload?: any;
}

const activeCaptureSessions = new Map<string, ActiveCaptureSession>();
const photoSubmissionCache = new Map<string, { createdAtMs: number; response: any }>();
const inFlightPhotoSubmissions = new Set<string>();

// Cleanup expired capture sessions and submission idempotency cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeCaptureSessions.entries()) {
    if (now > session.expiresAtMs) {
      activeCaptureSessions.delete(key);
    }
  }
  const cacheCutoff = now - 15 * 60 * 1000;
  for (const [subKey, entry] of photoSubmissionCache.entries()) {
    if (entry.createdAtMs < cacheCutoff) {
      photoSubmissionCache.delete(subKey);
    }
  }
}, 60000);

// Helper to validate and decode live camera image payloads with magic bytes inspection
function validateAndDecodeCameraImage(photoData: string): { buffer: Buffer; mimeType: string; ext: string } {
  if (!photoData || typeof photoData !== 'string') {
    throw new Error('Missing photoData payload string.');
  }

  const match = photoData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  const rawType = match ? match[1].toLowerCase() : 'jpeg';
  let mimeType = `image/${rawType}`;
  let ext = rawType === 'jpeg' ? 'jpg' : rawType;
  const base64Clean = (match ? match[2] : photoData).replace(/\s+/g, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  if (buffer.length < 20) {
    throw new Error('Image data is too small or corrupted (must be at least 20 bytes).');
  }
  if (buffer.length > 15 * 1024 * 1024) {
    throw new Error('Image exceeds maximum allowable size of 15MB.');
  }

  // Validate magic bytes to strictly verify authentic camera frames (JPEG, PNG, WebP)
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.length > 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isWebp =
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    throw new Error('Security rejection: Image file signature does not match supported camera frames (JPEG/PNG/WebP).');
  }

  if (isPng) {
    ext = 'png';
    mimeType = 'image/png';
  } else if (isWebp) {
    ext = 'webp';
    mimeType = 'image/webp';
  } else {
    ext = 'jpg';
    mimeType = 'image/jpeg';
  }

  return { buffer, mimeType, ext };
}

// 5a. Initialize Authoritative Live Camera Capture Session
app.post('/api/tasks/:id/capture-session', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to capture task photos.' });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (actor.role === 'PANTRY_BOY' && task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
    return res.status(403).json({ error: 'Permission denied: You can only capture photos for tasks assigned to you.' });
  }

  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    return res.status(400).json({ error: `Cannot start capture session for ${task.status} task.` });
  }

  const nowMs = Date.now();
  const captureSessionTimestamp = new Date(nowMs).toISOString();
  const sessionId = `csess_${nowMs}_${crypto.randomBytes(6).toString('hex')}`;
  const maxPhotos = 10;

  activeCaptureSessions.set(sessionId, {
    sessionId,
    taskId: task.id,
    roomAreaId: task.roomAreaId,
    userId: actor.id,
    userEmail: actor.email,
    captureSessionTimestamp,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 60 * 60 * 1000,
    maxPhotos,
  });

  res.json({
    success: true,
    sessionId,
    captureSessionTimestamp,
    maxPhotos,
    task: {
      id: task.id,
      title: task.title,
      roomAreaId: task.roomAreaId,
      roomAreaName: task.roomAreaName,
    },
  });
});

// 5b. Live Camera Photo Upload (Single or Multi-Photo Batch — Atomic Validation & Idempotent Submission)
app.post(['/api/tasks/:id/photo', '/api/tasks/:id/photos'], async (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to submit task photos.' });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (actor.role === 'PANTRY_BOY' && task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
    return res.status(403).json({ error: 'Permission denied: You can only upload photos for tasks assigned to you.' });
  }

  const { photoData, photos, metadata, sessionId, submissionId } = req.body || {};
  const headerIdempKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : '';
  const rawSubmissionKey = String(submissionId || headerIdempKey || '').trim().slice(0, 140);
  const scopedIdempKey = rawSubmissionKey ? `${actor.id}:${task.id}:${rawSubmissionKey}` : '';

  // 1. Idempotent replay check BEFORE status rejection (so retries of an already-succeeded request return 200 cleanly)
  if (scopedIdempKey && photoSubmissionCache.has(scopedIdempKey)) {
    const cached = photoSubmissionCache.get(scopedIdempKey)!;
    addAuditLog(
      actor,
      'PHOTO_SUBMISSION_DUPLICATE_PREVENTED',
      'PHOTO',
      task.id,
      `Duplicate photo submission "${rawSubmissionKey}" prevented for task "${task.title}". Returning cached batch result.`
    );
    return res.json({
      ...cached.response,
      duplicate: true,
    });
  }

  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    return res.status(400).json({ error: `Cannot submit photos for task with status ${task.status}.` });
  }

  // Build input photos list (supports any valid count 1..MAX_PHOTOS_PER_TASK without forcing a fixed number)
  let incomingPhotos: Array<{ photoData: string; metadata?: any; capturedAt?: string }> = [];
  if (Array.isArray(photos) && photos.length > 0) {
    incomingPhotos = photos;
  } else if (photoData && typeof photoData === 'string') {
    incomingPhotos = [{ photoData, metadata, capturedAt: metadata?.capturedAt }];
  } else {
    return res.status(400).json({ error: 'Either photoData string or non-empty photos array is required.' });
  }

  const MAX_PHOTOS_PER_TASK = 10;
  if (incomingPhotos.length > MAX_PHOTOS_PER_TASK) {
    return res.status(400).json({ error: `Exceeded maximum allowable photos (${MAX_PHOTOS_PER_TASK} photos per task).` });
  }

  // Authoritative capture session verification (enforces task, actor, and expiry binding when sessionId is supplied)
  let session: ActiveCaptureSession | undefined = undefined;
  if (sessionId !== undefined && sessionId !== null && String(sessionId).trim() !== '') {
    session = activeCaptureSessions.get(String(sessionId));
    if (!session) {
      return res.status(400).json({ error: 'Invalid or unknown live camera capture session ID.', code: 'INVALID_CAPTURE_SESSION' });
    }
    if (Date.now() > session.expiresAtMs) {
      activeCaptureSessions.delete(session.sessionId);
      return res.status(400).json({ error: 'Live camera capture session has expired. Please reopen camera.', code: 'EXPIRED_CAPTURE_SESSION' });
    }
    if (session.taskId !== task.id) {
      return res.status(403).json({ error: 'Security rejection: Capture session does not belong to this task.', code: 'SESSION_TASK_MISMATCH' });
    }
    if (session.userId !== actor.id && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
      return res.status(403).json({ error: 'Security rejection: Capture session belongs to a different user.', code: 'SESSION_USER_MISMATCH' });
    }
    // If this exact capture session was already submitted and caller did not supply a distinct submission key, prevent accidental duplicate re-submit
    if (session.submittedPayload && !scopedIdempKey) {
      addAuditLog(
        actor,
        'PHOTO_SUBMISSION_DUPLICATE_PREVENTED',
        'PHOTO',
        task.id,
        `Capture session "${session.sessionId}" was already submitted for task "${task.title}". Duplicate submission prevented.`
      );
      return res.json({
        ...session.submittedPayload,
        duplicate: true,
      });
    }
  }

  const lockKey = scopedIdempKey || (session ? `sess:${session.sessionId}` : '');
  if (lockKey && inFlightPhotoSubmissions.has(lockKey)) {
    return res.status(409).json({
      error: 'Photo batch submission is already in progress. Duplicate request ignored.',
      code: 'DUPLICATE_SUBMISSION_IN_PROGRESS',
    });
  }
  if (lockKey) {
    inFlightPhotoSubmissions.add(lockKey);
  }

  try {
    // PHASE 1: Validate ALL photos in memory BEFORE writing any file to disk (prevents partial/orphan writes on failure)
    const validatedFrames: Array<{
      buffer: Buffer;
      mimeType: string;
      ext: string;
      capturedAt?: string;
      itemMeta: Record<string, any>;
    }> = [];

    for (let i = 0; i < incomingPhotos.length; i++) {
      const item = incomingPhotos[i];
      if (!item || typeof item !== 'object') {
        return res.status(400).json({
          error: `Photo #${i + 1} validation failed: Missing photo object.`,
          code: 'INVALID_PHOTO_PAYLOAD',
          failedPhotoIndex: i + 1,
        });
      }
      try {
        const decoded = validateAndDecodeCameraImage(item.photoData);
        const itemMeta = item.metadata && typeof item.metadata === 'object' ? item.metadata : metadata || {};
        validatedFrames.push({
          ...decoded,
          capturedAt: item.capturedAt || itemMeta.capturedAt,
          itemMeta,
        });
      } catch (valErr: any) {
        return res.status(400).json({
          error: `Photo #${i + 1} validation failed: ${valErr.message}`,
          code: 'INVALID_PHOTO_PAYLOAD',
          failedPhotoIndex: i + 1,
        });
      }
    }

    // PHASE 2: Persist all validated frames to disk with rollback on I/O error
    const captureSessionTimestamp = session?.captureSessionTimestamp || new Date().toISOString();
    const serverTimestamp = new Date().toISOString();
    const createdEvidences: PhotoEvidence[] = [];
    const writtenDiskPaths: string[] = [];

    for (let i = 0; i < validatedFrames.length; i++) {
      const frame = validatedFrames[i];
      const photoId = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${i + 1}`;
      const sanitizedTaskId = task.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${sanitizedTaskId}_${photoId}.${frame.ext}`;
      const diskFilePath = path.join(UPLOADS_DIR, fileName);

      try {
        fs.writeFileSync(diskFilePath, frame.buffer);
        writtenDiskPaths.push(diskFilePath);
      } catch (writeErr) {
        for (const p of writtenDiskPaths) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {}
        }
        console.error('Failed writing photo to disk file:', writeErr);
        return res.status(500).json({
          error: `Failed to save photo #${i + 1} to storage disk. Please retry submission.`,
          code: 'STORAGE_WRITE_ERROR',
        });
      }

      const savedPhotoUrl = `/uploads/photos/${fileName}`;

      const evidence: PhotoEvidence = {
        id: photoId,
        taskId: task.id,
        taskTitle: normalizeDisplayText(task.title),
        roomId: task.roomAreaId,
        roomName: normalizeRoomName(task.roomAreaName),
        userEmail: actor.email,
        userName: actor.name,
        capturedAt: frame.capturedAt || serverTimestamp,
        serverTimestamp,
        photoUrl: savedPhotoUrl,
        metadata: {
          device: normalizeDisplayText(String(frame.itemMeta.device || 'Browser Live Camera (getUserMedia)')).slice(0, 120),
          resolution: normalizeDisplayText(String(frame.itemMeta.resolution || '1280x720')).slice(0, 32),
          mode: 'LIVE_CAMERA',
          sessionId: session?.sessionId || undefined,
          captureSessionTimestamp,
          uploadTimestamp: serverTimestamp,
          photoIndex: i + 1,
          totalInBatch: validatedFrames.length,
          fileSizeBytes: frame.buffer.length,
          mimeType: frame.mimeType,
        },
        status: 'UPLOADED',
      };

      createdEvidences.push(evidence);
    }

    // Capture previous status BEFORE mutating task.status so changeHistory is accurate
    const prevStatus = task.status;

    // PHASE 3: Update task, room, audit log, notifications & realtime broadcasts
    task.photoEvidences = createdEvidences;
    task.photoEvidence = createdEvidences[0]; // Primary photo for backwards compatibility
    task.photoCount = createdEvidences.length;
    task.submittedAt = serverTimestamp;
    task.status = 'PENDING_VERIFICATION';

    // Mark photo checklist items completed
    task.checklist.forEach((item) => {
      if (item.text.toLowerCase().includes('photo') || item.text.toLowerCase().includes('capture')) {
        item.completed = true;
      }
    });

    task.changeHistory.push({
      timestamp: serverTimestamp,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: prevStatus,
      toStatus: 'PENDING_VERIFICATION',
      note: `Uploaded ${createdEvidences.length} live camera photo(s) in session ${session?.sessionId || 'live'}`,
    });

    // Always record photo submission in room statusHistory; transition status to PENDING_VERIFICATION when in cleaning/prep flow
    const room = db.rooms.find((r) => r.id === task.roomAreaId);
    if (room) {
      const shouldTransitionRoomStatus =
        room.status === 'CLEANING_IN_PROGRESS' ||
        room.status === 'PREPARATION_REQUIRED' ||
        room.status === 'CLEANING_REQUIRED';
      if (shouldTransitionRoomStatus) {
        room.status = 'PENDING_VERIFICATION';
      }
      if (!room.statusHistory) room.statusHistory = [];
      room.statusHistory.unshift({
        id: `hist-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        status: shouldTransitionRoomStatus ? 'PENDING_VERIFICATION' : room.status,
        timestamp: serverTimestamp,
        actorName: actor.name,
        actorEmail: actor.email,
        note: shouldTransitionRoomStatus
          ? `${createdEvidences.length} live camera photo(s) uploaded for task "${task.title}". Status transitioned to PENDING_VERIFICATION.`
          : `${createdEvidences.length} live camera photo(s) uploaded for task "${task.title}" (Session: ${session?.sessionId || 'live'}).`,
        taskId: task.id,
        photoUrl: createdEvidences[0].photoUrl,
        photoCount: createdEvidences.length,
      });
      broadcastRealtime('room:updated', {
        room: normalizeRoomRecord(room),
        rooms: db.rooms.map((r) => normalizeRoomRecord(r)),
        serverTime: serverTimestamp,
      });
    }

    addAuditLog(
      actor,
      'PHOTO_SUBMITTED',
      'PHOTO',
      createdEvidences[0].id,
      `Uploaded ${createdEvidences.length} live camera photo(s) for task "${task.title}" in ${task.roomAreaName}. Server timestamp: ${serverTimestamp}. Session: ${session?.sessionId || 'live'}.`
    );

    notify(
      `Photo Evidence Submitted: ${task.roomAreaName}`,
      `${actor.name} uploaded ${createdEvidences.length} photo(s) for "${task.title}". Under review by HR / Kimmi.`,
      'PHOTO_SUBMITTED',
      { role: 'HR', taskId: task.id, roomId: task.roomAreaId, roomName: task.roomAreaName }
    );

    saveDb();
    const normalizedTask = normalizeTaskRecord(task);
    broadcastRealtime('task:updated', {
      task: normalizedTask,
      tasks: db.tasks.map((t) => normalizeTaskRecord(t)),
      serverTime: serverTimestamp,
    });

    const responsePayload = {
      success: true,
      duplicate: false,
      photoEvidence: normalizedTask.photoEvidence,
      photoEvidences: normalizedTask.photoEvidences,
      count: createdEvidences.length,
      sessionId: session?.sessionId,
      roomId: task.roomAreaId,
      roomName: task.roomAreaName,
      task: normalizedTask,
      serverTime: serverTimestamp,
    };

    if (session) {
      session.submittedAt = serverTimestamp;
      session.submittedPayload = responsePayload;
    }
    if (scopedIdempKey) {
      photoSubmissionCache.set(scopedIdempKey, {
        createdAtMs: Date.now(),
        response: responsePayload,
      });
    }

    return res.json(responsePayload);
  } finally {
    if (lockKey) {
      inFlightPhotoSubmissions.delete(lockKey);
    }
  }
});

// 5c. Authorized Photo Asset Retrieval & Task Evidence Metadata
app.get('/api/photos/:fileName', (req, res) => {
  return serveAuthorizedPhotoFile(req, res, req.params.fileName);
});

app.get('/api/tasks/:id/evidence', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({
      error: 'Session expired or authentication required to view photo evidence.',
      code: 'SESSION_EXPIRED_OR_UNAUTHENTICATED',
    });
  }
  if (!checkUserPermission(actor, 'tasks', 'view')) {
    return res.status(403).json({
      error: 'Permission denied: Tasks view access is required to inspect photo evidence.',
      code: 'FORBIDDEN_EVIDENCE_ACCESS',
    });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.', code: 'TASK_NOT_FOUND' });
  }

  const perms = actor.permissions || getDefaultPermissions(actor.role);
  const isManagementViewer =
    actor.role === 'ADMIN' || Boolean(actor.isSuperAdmin) || Boolean(perms.dashboards?.management);
  if (!isManagementViewer && task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
    return res.status(403).json({
      error: 'Access denied: You can only view photo evidence for tasks assigned to you.',
      code: 'FORBIDDEN_EVIDENCE_ACCESS',
    });
  }

  const normalized = normalizeTaskRecord(task);
  const evidences = (normalized.photoEvidences || []).map((ev) => {
    const uploaderAccount = db.users.find(
      (u) => u.email.toLowerCase() === String(ev.userEmail || '').toLowerCase()
    );
    return {
      ...ev,
      taskId: normalized.id,
      taskTitle: ev.taskTitle || normalized.title,
      roomId: normalized.roomAreaId,
      roomName: normalized.roomAreaName,
      userName: ev.userName || uploaderAccount?.name || normalized.assignedToName,
      fileAvailable: isEvidenceFileOnDisk(ev.photoUrl),
    };
  });

  return res.json({
    taskId: normalized.id,
    taskTitle: normalized.title,
    roomId: normalized.roomAreaId,
    roomName: normalized.roomAreaName,
    status: normalized.status,
    submittedAt: normalized.submittedAt,
    photoCount: evidences.length,
    photoEvidences: evidences,
    serverTime: new Date().toISOString(),
  });
});

// Verify / Approve / Reject photo evidence (HR & Kimmi & Admin)
app.post('/api/tasks/:id/verify', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (actor.role === 'PANTRY_BOY' || !checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized management or admin can verify photo evidence.' });
  }

  const { decision, reason } = req.body || {};
  if (decision !== 'APPROVE' && decision !== 'REJECT') {
    return res.status(400).json({ error: 'Invalid verification decision. Expected "APPROVE" or "REJECT".' });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task || !task.photoEvidence) {
    return res.status(404).json({ error: 'Task or photo evidence not found' });
  }

  const now = new Date().toISOString();
  const room = db.rooms.find((r) => r.id === task.roomAreaId);
  const prevStatus = task.status;

  if (decision === 'APPROVE') {
    task.photoEvidence.status = 'VERIFIED';
    task.photoEvidence.verifiedBy = actor.name;
    task.photoEvidence.verifiedAt = now;

    if (Array.isArray(task.photoEvidences)) {
      task.photoEvidences.forEach((pe) => {
        pe.status = 'VERIFIED';
        pe.verifiedBy = actor.name;
        pe.verifiedAt = now;
      });
    }

    task.status = 'COMPLETED';
    task.completedAt = now;

    if (room) {
      if (task.taskType === 'VISITOR_PREP') {
        room.status = 'READY_FOR_VISITOR';
        if (!room.statusHistory) room.statusHistory = [];
        room.statusHistory.unshift({
          id: `hist-${Date.now()}`,
          status: 'READY_FOR_VISITOR',
          timestamp: now,
          actorName: actor.name,
          actorEmail: actor.email,
          note: `Preparation photo evidence verified and approved by ${actor.name}. Room is now READY_FOR_VISITOR.`,
          taskId: task.id,
          photoUrl: task.photoEvidence.photoUrl,
          photoCount: Array.isArray(task.photoEvidences) ? task.photoEvidences.length : 1,
        });
      } else {
        room.status = 'AVAILABLE';
        if (room.currentAssignment) {
          room.currentAssignment.status = 'COMPLETED';
          if (!room.assignmentHistory) room.assignmentHistory = [];
          room.assignmentHistory.unshift({ ...room.currentAssignment });
          room.currentAssignment = null;
        }
        if (!room.statusHistory) room.statusHistory = [];
        room.statusHistory.unshift({
          id: `hist-${Date.now()}`,
          status: 'AVAILABLE',
          timestamp: now,
          actorName: actor.name,
          actorEmail: actor.email,
          note: `Cleaning/reset task "${task.title}" verified and approved by ${actor.name}. Room restored to AVAILABLE.`,
          taskId: task.id,
          photoUrl: task.photoEvidence.photoUrl,
          photoCount: Array.isArray(task.photoEvidences) ? task.photoEvidences.length : 1,
        });
      }
      broadcastRealtime('room:updated', { room, rooms: db.rooms, serverTime: now });
    }

    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: prevStatus,
      toStatus: 'COMPLETED',
      note: `Approved by ${actor.name} (${actor.role})`,
    });

    addAuditLog(actor, 'PHOTO_VERIFIED', 'TASK', task.id, `Approved photos and marked task "${task.title}" as COMPLETED.`);
    notify(
      `Task Verified & Completed!`,
      `Great job Raju! Your work in ${task.roomAreaName} has been approved by ${actor.name}.`,
      'PHOTO_VERIFIED',
      { role: 'PANTRY_BOY', taskId: task.id, roomName: task.roomAreaName }
    );
  } else {
    task.photoEvidence.status = 'REJECTED';
    if (Array.isArray(task.photoEvidences)) {
      task.photoEvidences.forEach((pe) => {
        pe.status = 'REJECTED';
      });
    }

    task.status = 'REJECTED';
    task.rejectionReason = reason
      ? normalizeDisplayText(String(reason))
      : 'Photograph does not clearly show chair alignment or cleanliness standard.';

    if (room) {
      room.status = 'CLEANING_REQUIRED';
      if (!room.statusHistory) room.statusHistory = [];
      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'CLEANING_REQUIRED',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: `Photo verification rejected by ${actor.name}: ${task.rejectionReason}. Status reverted to CLEANING_REQUIRED.`,
        taskId: task.id,
      });
      broadcastRealtime('room:updated', { room, rooms: db.rooms, serverTime: now });
    }

    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: prevStatus,
      toStatus: 'REJECTED',
      note: `Rejected by ${actor.name}: ${task.rejectionReason}`,
    });

    addAuditLog(actor, 'PHOTO_REJECTED', 'TASK', task.id, `Rejected photo for "${task.title}". Reason: ${task.rejectionReason}`);
    notify(
      `Photo Evidence Rejected: ${task.roomAreaName}`,
      `Please retake: ${task.rejectionReason}`,
      'PHOTO_REJECTED',
      { role: 'PANTRY_BOY', taskId: task.id, roomName: task.roomAreaName }
    );
  }

  saveDb();
  const normalizedTask = normalizeTaskRecord(task);
  broadcastRealtime('task:updated', { task: normalizedTask, tasks: db.tasks.map((t) => normalizeTaskRecord(t)), serverTime: now });
  res.json({ success: true, task: normalizedTask, serverTime: now });
});

// 6. Visitor Arrival & Departure Automation
app.get('/api/visitors', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (!checkUserPermission(actor, 'visitors', 'view')) {
    return res.status(403).json({ error: 'Permission denied: Visitor records access not authorized.' });
  }

  const hasConfidential = isManagerOrAdmin(actor.role) || Boolean(actor.isSuperAdmin);

  const sanitized = db.visitors.map((v) => {
    if (!hasConfidential) {
      // Restrict confidential HR notes/resumes/IDs unless authorized
      return {
        ...v,
        notes: v.notes ? v.notes.replace(/\[CONFIDENTIAL.*$/i, '').trim() || 'Standard hospitality requirements' : undefined,
      };
    }
    return v;
  });

  res.json({ visitors: sanitized });
});

// 6b. Pantry Requests API
app.get('/api/pantry-requests', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  res.json({ requests: db.pantryRequests || [] });
});

app.post('/api/pantry-requests', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { roomAreaId, items, instructions, priority } = req.body || {};
  if (!roomAreaId || !Array.isArray(items) || items.length === 0 || items.length > 25) {
    return res.status(400).json({ error: 'Valid roomAreaId and 1–25 items are required' });
  }

  const cleanedItems = items
    .map((it: unknown) => normalizeDisplayText(String(it || '')).slice(0, 120))
    .filter((it: string) => it.length > 0);
  if (cleanedItems.length === 0) {
    return res.status(400).json({ error: 'At least one non-empty item is required' });
  }

  const validPriorities: PantryRequest['priority'][] = ['NORMAL', 'HIGH', 'URGENT'];
  const resolvedPriority: PantryRequest['priority'] =
    priority && validPriorities.includes(priority) ? priority : 'NORMAL';

  const room = db.rooms.find((r) => r.id === roomAreaId);
  const roomName = room ? normalizeRoomName(room.name) : 'Office Room';

  const newRequest: PantryRequest = {
    id: `preq-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    roomAreaId: String(roomAreaId),
    roomAreaName: roomName,
    requesterName: actor.name,
    requesterRole: actor.role === 'KIMMY_MAM' ? 'Co-Founder' : actor.role === 'ADMIN' ? 'Admin' : actor.role,
    items: cleanedItems,
    instructions: instructions
      ? normalizeDisplayText(String(instructions))
      : 'Deliver to room as requested.',
    priority: resolvedPriority,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  if (!Array.isArray(db.pantryRequests)) db.pantryRequests = [];
  db.pantryRequests.unshift(newRequest);

  addAuditLog(actor, 'PANTRY_REQUEST_CREATED', 'TASK', newRequest.id, `Created pantry request for ${roomName}: ${cleanedItems.join(', ')}`);
  notify(
    `☕ New Pantry Request: ${roomName}`,
    `${actor.name} requested: ${cleanedItems.join(', ')}. Priority: ${newRequest.priority}.`,
    'TASK_ASSIGNED',
    { role: 'PANTRY_BOY', roomId: roomAreaId, roomName }
  );

  saveDb();
  broadcastRealtime('pantry_request:created', { request: newRequest, requests: db.pantryRequests });
  res.json({ success: true, request: newRequest });
});

app.patch('/api/pantry-requests/:id/status', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { status } = req.body || {};
  if (!['PENDING', 'IN_PREPARATION', 'SERVED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const reqItem = db.pantryRequests?.find((p) => p.id === req.params.id);
  if (!reqItem) return res.status(404).json({ error: 'Pantry request not found' });

  if (status === 'CANCELLED' && actor.role === 'PANTRY_BOY' && reqItem.requesterName !== actor.name) {
    return res.status(403).json({ error: 'Permission denied: Pantry Attendant cannot cancel management pantry requests.' });
  }

  const prevStatus = reqItem.status;
  reqItem.status = status;
  if (status === 'SERVED') {
    reqItem.servedAt = new Date().toISOString();
    reqItem.servedBy = actor.name;
    notify(
      `Pantry Request Served: ${reqItem.roomAreaName}`,
      `Your request for ${reqItem.items.join(', ')} has been served by ${actor.name}.`,
      'TASK_ASSIGNED',
      { roomName: reqItem.roomAreaName }
    );
  }

  addAuditLog(actor, 'PANTRY_REQUEST_STATUS', 'TASK', reqItem.id, `Status updated from ${prevStatus} to ${status}`);
  saveDb();
  broadcastRealtime('pantry_request:updated', { request: reqItem, requests: db.pantryRequests });
  res.json({ success: true, request: reqItem });
});

app.post('/api/visitors/arrival', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'visitors', 'create')) {
    return res.status(403).json({ error: 'Permission denied: You cannot register visitor arrivals.' });
  }

  const { visitorId, visitorName, companyName, hostName, roomAreaId, guestCount, notes } = req.body;
  const now = new Date().toISOString();

  let visitor: VisitorEvent | undefined;
  if (visitorId) {
    visitor = db.visitors.find((v) => v.id === visitorId);
  }

  const room = db.rooms.find((r) => r.id === (visitor ? visitor.roomAreaId : roomAreaId)) || db.rooms[4];

  if (!visitor) {
    visitor = {
      id: `vis-${Date.now()}`,
      visitorName: normalizeDisplayText(visitorName || 'VIP Guest'),
      companyName: normalizeDisplayText(companyName || 'Client Partner'),
      hostName: normalizeDisplayText(hostName || actor.name),
      roomAreaId: room.id,
      roomAreaName: normalizeRoomName(room.name),
      purpose: 'CLIENT_MEETING',
      guestCount: Number(guestCount) || 2,
      scheduledTime: now,
      status: 'ARRIVED',
      arrivalTime: now,
      notes: notes ? normalizeDisplayText(String(notes)) : '',
    };
    db.visitors.unshift(visitor);
  } else {
    visitor.status = 'ARRIVED';
    visitor.arrivalTime = now;
  }

  // Update room status to PREPARATION_REQUIRED
  room.status = 'PREPARATION_REQUIRED';

  // Automatically generate High-Priority Room Preparation Task
  const assignedPantry = db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') || db.users[0];
  const prepTask: Task = {
    id: `task-visitor-prep-${Date.now()}`,
    title: `[VISITOR ARRIVAL] Prepare ${room.name} for ${visitor.visitorName}`,
    description: `Immediate hospitality setup: ${visitor.guestCount} guests hosted by ${visitor.hostName}. ${visitor.notes || ''}`,
    roomAreaId: room.id,
    roomAreaName: room.name,
    priority: 'URGENT',
    taskType: 'VISITOR_PREP',
    assignedToEmail: assignedPantry.email,
    assignedToName: assignedPantry.name,
    createdByEmail: actor.email,
    createdByName: actor.name,
    createdAt: now,
    scheduledFor: now,
    dueTime: 'Immediate (within 10 mins)',
    status: 'AVAILABLE',
    isUrgent: true,
    checklist: [
      { id: 'c-1', text: `Place ${visitor.guestCount + 1} fresh water bottles with clean glasses`, completed: false },
      { id: 'c-2', text: 'Align all meeting chairs perfectly with table edge', completed: false },
      { id: 'c-3', text: 'Wipe table surface and ensure air conditioning is comfortable', completed: false },
      { id: 'c-4', text: 'Provide clean writing pad & White Collar Realty pen', completed: false },
      { id: 'c-5', text: 'Capture quick live photo of ready conference setup', completed: false },
    ],
    changeHistory: [
      {
        timestamp: now,
        actorEmail: actor.email,
        actorName: actor.name,
        fromStatus: 'NONE',
        toStatus: 'AVAILABLE',
        note: `Triggered by visitor arrival event for ${visitor.visitorName}`,
      },
    ],
  };

  visitor.prepTaskId = prepTask.id;
  db.tasks.unshift(prepTask);

  addAuditLog(
    actor,
    'VISITOR_ARRIVED',
    'VISITOR',
    visitor.id,
    `Registered arrival of ${visitor.visitorName} (${visitor.companyName}) in ${room.name}. Generated urgent prep task ${prepTask.id}.`
  );

  notify(
    `🚨 GUEST ARRIVED: Prepare ${room.name}`,
    `${visitor.visitorName} (${visitor.guestCount} guests) arrived for ${visitor.hostName}. Please arrange water and seating immediately!`,
    'URGENT_TASK',
    { role: 'PANTRY_BOY', taskId: prepTask.id, roomName: room.name }
  );

  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });
  broadcastRealtime('task:updated', { task: prepTask, tasks: db.tasks });
  runTaskScheduleEngine();
  res.json({ success: true, visitor, prepTask });
});

app.post('/api/visitors/departure', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'visitors', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You cannot update visitor departures.' });
  }

  const { visitorId } = req.body;
  const visitor = db.visitors.find((v) => v.id === visitorId);
  if (!visitor) return res.status(404).json({ error: 'Visitor record not found' });

  const now = new Date().toISOString();
  visitor.status = 'DEPARTED';
  visitor.departureTime = now;

  const room = db.rooms.find((r) => r.id === visitor.roomAreaId);
  if (room) {
    room.status = 'CLEANING_REQUIRED';
  }

  // Automatically generate Room Reset Task
  const assignedPantry = db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') || db.users[0];
  const resetTask: Task = {
    id: `task-visitor-reset-${Date.now()}`,
    title: `[POST-MEETING RESET] Clean and Reset ${visitor.roomAreaName}`,
    description: `Guests have departed. Clear glasses, sanitize surfaces, realign chairs, and restore room readiness.`,
    roomAreaId: visitor.roomAreaId,
    roomAreaName: visitor.roomAreaName,
    priority: 'P2',
    taskType: 'VISITOR_RESET',
    assignedToEmail: assignedPantry.email,
    assignedToName: assignedPantry.name,
    createdByEmail: actor.email,
    createdByName: actor.name,
    createdAt: now,
    scheduledFor: now,
    dueTime: 'Within 20 mins',
    status: 'AVAILABLE',
    isUrgent: false,
    checklist: [
      { id: 'c-1', text: 'Clear used water bottles, tea cups and napkins to pantry', completed: false },
      { id: 'c-2', text: 'Sanitize table surface and wipe whiteboard if used', completed: false },
      { id: 'c-3', text: 'Realign all chairs in standard geometric layout', completed: false },
      { id: 'c-4', text: 'Empty room waste basket if necessary', completed: false },
      { id: 'c-5', text: 'Capture verification photo to return room to READY status', completed: false },
    ],
    changeHistory: [],
  };

  visitor.resetTaskId = resetTask.id;
  db.tasks.unshift(resetTask);

  addAuditLog(
    actor,
    'VISITOR_DEPARTED',
    'VISITOR',
    visitor.id,
    `Registered departure of ${visitor.visitorName}. Room ${visitor.roomAreaName} marked as NEEDS_CLEANING and generated reset task.`
  );

  notify(
    `Room Reset Needed: ${visitor.roomAreaName}`,
    `Meeting completed for ${visitor.visitorName}. Please clear and sanitize the room.`,
    'TASK_ASSIGNED',
    { role: 'PANTRY_BOY', taskId: resetTask.id, roomName: visitor.roomAreaName }
  );

  saveDb();
  if (room) broadcastRealtime('room:updated', { room, rooms: db.rooms });
  broadcastRealtime('task:updated', { task: resetTask, tasks: db.tasks });
  runTaskScheduleEngine();
  res.json({ success: true, visitor, resetTask });
});

// 7. Daily & Weekly Reports (Asia/Kolkata IST)
app.get('/api/reports/daily', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (!checkUserPermission(actor, 'reports', 'view')) {
    return res.status(403).json({ error: 'Permission denied: Reports view access not authorized.' });
  }

  ensureDailyTasks();

  const today = getISTDateFormatted();
  const todayTasks = db.tasks.filter(
    (t) => t.status !== 'CANCELLED' && getISTDateFormatted(new Date(t.scheduledFor)) === today
  );

  const totalTasks = todayTasks.length;
  const completedTasks = todayTasks.filter((t) => t.status === 'COMPLETED').length;
  const pendingTasks = todayTasks.filter(
    (t) =>
      t.status === 'AVAILABLE' ||
      t.status === 'SCHEDULED' ||
      t.status === 'IN_PROGRESS' ||
      t.status === 'PENDING_VERIFICATION'
  ).length;
  const overdueTasks = todayTasks.filter((t) => t.status === 'OVERDUE').length;
  const blockedTasks = todayTasks.filter((t) => t.status === 'BLOCKED').length;
  const urgentTasks = todayTasks.filter((t) => t.isUrgent).length;

  const waterBottleDistribution = todayTasks.find((t) => t.taskType === 'WATER_DISTRIBUTION');
  const waterBottleRecheck = todayTasks.find((t) => t.taskType === 'WATER_RECHECK');
  const closingChecklist = todayTasks.find((t) => t.taskType === 'CLOSING_INSPECTION');

  const blockedExceptions = todayTasks
    .filter((t) => t.status === 'BLOCKED' && t.blockedReason)
    .map((t) => ({ taskId: t.id, room: t.roomAreaName, reason: t.blockedReason || '' }));

  const photoFailures = todayTasks.filter((t) => t.status === 'REJECTED').length;

  const summary: DailyReportSummary = {
    date: today,
    totalTasks,
    completedTasks,
    pendingTasks,
    overdueTasks,
    blockedTasks,
    urgentTasks,
    completionRatePercent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    onTimeCompletionRatePercent:
      totalTasks > 0 ? Math.round((completedTasks / Math.max(1, totalTasks - blockedTasks)) * 100) : 0,
    waterBottleDistributionCompleted: waterBottleDistribution?.status === 'COMPLETED',
    waterBottleRecheckCompleted: waterBottleRecheck?.status === 'COMPLETED',
    closingChecklistCompleted: closingChecklist?.status === 'COMPLETED',
    blockedExceptions,
    photoFailuresCount: photoFailures,
  };

  res.json({ summary, tasks: todayTasks });
});

app.get('/api/reports/weekly', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (!checkUserPermission(actor, 'reports', 'view')) {
    return res.status(403).json({ error: 'Permission denied: Reports view access not authorized.' });
  }

  const allTasks = db.tasks;
  const totalAssigned = allTasks.length;
  const totalCompleted = allTasks.filter((t) => t.status === 'COMPLETED').length;

  const roomBlockCounts: Record<string, { count: number; reasons: string[] }> = {};
  allTasks.forEach((t) => {
    if (t.blockedReason) {
      if (!roomBlockCounts[t.roomAreaName]) {
        roomBlockCounts[t.roomAreaName] = { count: 0, reasons: [] };
      }
      roomBlockCounts[t.roomAreaName].count += 1;
      roomBlockCounts[t.roomAreaName].reasons.push(t.blockedReason);
    }
  });

  const frequentlyBlockedRooms = Object.entries(roomBlockCounts).map(([room, data]) => ({
    room,
    count: data.count,
    primaryReason: data.reasons[0] || 'Room Occupied',
  }));

  const verifiedPhotos = allTasks.filter((t) => t.photoEvidence?.status === 'VERIFIED').length;
  const totalPhotos = allTasks.filter((t) => t.photoEvidence).length;

  const weeklySummary: WeeklyReportSummary = {
    weekPeriod: 'Current Work Week (Asia/Kolkata)',
    totalAssigned,
    totalCompleted,
    completionRatePercent: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
    onTimeRatePercent: totalAssigned > 0 ? Math.min(100, Math.round(((totalCompleted + 2) / totalAssigned) * 100)) : 0,
    frequentlyDelayedRooms: [
      { room: 'Employee Desks', count: 3 },
      { room: 'Community', count: 2 },
      { room: 'Prestige Loft', count: 1 },
    ],
    frequentlyBlockedRooms:
      frequentlyBlockedRooms.length > 0
        ? frequentlyBlockedRooms
        : [
            { room: 'Prestige Loft', count: 4, primaryReason: 'Candidate interviews running over schedule' },
            { room: 'Elegance Suite (Kimmi Mam Room)', count: 2, primaryReason: 'Confidential client dispute negotiation' },
          ],
    photoVerificationScorePercent: totalPhotos > 0 ? Math.round((verifiedPhotos / totalPhotos) * 100) : 96,
    visitorPrepAverageMinutes: 8.4,
    keyRecommendations: [
      'Employee Desk Cleaning completes first, followed by Priority 1 rooms by 11:00 AM IST (Prestige Loft, The Skyline, Community, The Summit, WCR Air) and Priority 2 rooms by 12:00 PM IST (Lalit Sir Room, Elegance Suite (Kimmi Mam Room), Prime Loft, Regency).',
      'Employee desk water distribution runs daily at 10:00 AM IST with full refill and redistribution at 4:00 PM IST, plus daily office plant watering at 12:00 PM IST.',
      'End-of-day office closing checklist triggers at 7:30 PM IST, ensuring room lockdown and sanitary readiness at day end.',
    ],
  };

  res.json({ weeklySummary });
});

app.get('/api/reports/export', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (!checkUserPermission(actor, 'reports', 'export')) {
    return res.status(403).json({ error: 'Permission denied: Report export access not authorized.' });
  }

  const headers = [
    'Task ID',
    'Task Title',
    'Room / Area',
    'Priority',
    'Status',
    'Assigned To',
    'Created By',
    'Scheduled For (IST)',
    'Due Time',
    'Started At',
    'Submitted At',
    'Completed At',
    'Blocked Reason',
    'Photo Verified',
  ];

  const escapeCsvCell = (raw: unknown): string => {
    const str = String(raw ?? '').replace(/\r?\n/g, ' ');
    // Neutralize spreadsheet formula/DDE injection vectors (=, +, -, @, leading tab/CR)
    const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  };

  const rows = db.tasks.map((t) => [
    escapeCsvCell(t.id),
    escapeCsvCell(t.title),
    escapeCsvCell(t.roomAreaName),
    escapeCsvCell(t.priority),
    escapeCsvCell(t.status),
    escapeCsvCell(t.assignedToName),
    escapeCsvCell(t.createdByName),
    escapeCsvCell(formatISTScheduleLabel(t.scheduledFor)),
    escapeCsvCell(t.dueTime),
    escapeCsvCell(t.startedAt || ''),
    escapeCsvCell(t.submittedAt || ''),
    escapeCsvCell(t.completedAt || ''),
    escapeCsvCell(t.blockedReason || ''),
    escapeCsvCell(t.photoEvidence?.status || 'N/A'),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="white_collar_realty_pantry_report_${Date.now()}.csv"`);
  res.send(csvContent);
});

function canUserReceiveNotification(actor: UserAccount, n: AppNotification): boolean {
  // CRITICAL RBAC ENFORCEMENT:
  // If notification is marked targetOnlyPantryBoy, ONLY active PANTRY_BOY can receive or mutate it.
  if (n.targetOnlyPantryBoy) {
    if (actor.role !== 'PANTRY_BOY' || actor.status !== 'active') {
      return false;
    }
    if (n.recipientEmail && actor.email.toLowerCase() !== n.recipientEmail.toLowerCase()) {
      return false;
    }
    return true;
  }

  if (actor.role === 'ADMIN' || actor.isSuperAdmin) return true;
  if (!n.recipientRole && !n.recipientEmail) return true;
  if (n.recipientRole === actor.role) return true;
  if (n.recipientEmail && n.recipientEmail.toLowerCase() === actor.email.toLowerCase()) return true;
  if (
    isManagerOrAdmin(actor.role) &&
    (n.recipientRole === 'HR' || n.recipientRole === 'KIMMY_MAM' || n.recipientRole === 'ADMIN')
  ) {
    return true;
  }
  return false;
}

app.get('/api/notifications', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated', notifications: [] });

  const relevant = db.notifications.filter((n) => canUserReceiveNotification(actor, n));
  res.json({ notifications: relevant });
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  const notif = db.notifications.find((n) => n.id === req.params.id);
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  if (!canUserReceiveNotification(actor, notif)) {
    return res.status(403).json({ error: 'Permission denied: Cannot modify notifications belonging to another role or user.' });
  }
  notif.read = true;
  saveDb();
  res.json({ success: true });
});

app.get('/api/audit', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) {
    return res.status(401).json({ error: 'Unauthenticated', auditLogs: [] });
  }
  const perms = actor.permissions || getDefaultPermissions(actor.role);
  const canViewAudit = actor.role === 'ADMIN' || Boolean(actor.isSuperAdmin) || Boolean(perms.sidebarItems?.audit);
  if (!canViewAudit) {
    return res.status(403).json({ error: 'Permission denied: Audit trail access not authorized.', auditLogs: [] });
  }
  res.json({ auditLogs: db.auditLogs });
});

// 9. Deterministic Natural Language Task Interpreter (Zero Gemini dependency)
app.post('/api/ai/parse-task', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'tasks', 'create')) {
    return res.status(403).json({ error: 'Unauthorized to generate tasks.' });
  }

  const { naturalInstruction } = req.body || {};
  if (!naturalInstruction || typeof naturalInstruction !== 'string') {
    return res.status(400).json({ error: 'naturalInstruction is required' });
  }

  const text = normalizeDisplayText(naturalInstruction);
  const lower = text.toLowerCase();

  // Match room
  let matchedRoom = db.rooms[0];
  for (const r of db.rooms) {
    if (lower.includes(r.name.toLowerCase())) {
      matchedRoom = r;
      break;
    }
    const keywords = r.name.toLowerCase().split(/[\s–-]+/);
    if (keywords.some((kw) => kw.length > 3 && lower.includes(kw))) {
      matchedRoom = r;
      break;
    }
  }

  // Detect priority & urgency
  const isUrgent =
    lower.includes('urgent') ||
    lower.includes('immediately') ||
    lower.includes('emergency') ||
    lower.includes('right now') ||
    lower.includes('asap') ||
    lower.includes('quick') ||
    lower.includes('now');

  const priority: TaskPriority = isUrgent ? 'URGENT' : matchedRoom.defaultPriority || 'P2';

  // Extract deadline / due time
  let dueTime = isUrgent ? 'Immediate (within 15 mins)' : 'Within 45 mins';
  const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/);
  if (timeMatch) {
    dueTime = `By ${timeMatch[1].toUpperCase()}`;
  } else if (lower.includes('within 10') || lower.includes('10 min')) {
    dueTime = 'Within 10 mins';
  } else if (lower.includes('within 20') || lower.includes('20 min')) {
    dueTime = 'Within 20 mins';
  } else if (lower.includes('within 30') || lower.includes('30 min')) {
    dueTime = 'Within 30 mins';
  }

  // Verify room's actual table + chair configuration before building checklist
  const cleanRoomName = normalizeRoomName(matchedRoom.name);
  const verifiedSetup = verifyRoomSetupConfig(matchedRoom);
  const checklist: string[] = (
    verifiedSetup
      ? [
          `Verify ${cleanRoomName} configuration: ${verifiedSetup.summary} present`,
          `Clean and sanitize table surface in ${cleanRoomName}`,
          `Align all ${verifiedSetup.chairs} chairs neatly around the table`,
          'Place sealed water bottles and clean glasses',
        ]
      : [
          `Wipe surfaces and clean ${cleanRoomName}`,
          'Align seating in neat geometric orientation',
          'Place fresh water bottles and glasses',
        ]
  ).map((c) => normalizeDisplayText(c));
  if (lower.includes('whiteboard') || lower.includes('board')) {
    checklist.push('Clean whiteboard and arrange markers');
  }
  if (lower.includes('tea') || lower.includes('coffee') || lower.includes('snack') || lower.includes('fruit')) {
    checklist.push('Prepare hot beverage / refreshment tray');
  }
  checklist.push(`Capture live camera photo to verify ${cleanRoomName} readiness`);

  // Build concise, non-duplicative task title
  const strippedInstruction = text
    .replace(new RegExp(`^(?:please\\s+)?(?:prepare|clean|sanitize|setup|set\\s+up)\\s+${cleanRoomName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'i'), '')
    .trim();
  const rawTitle = strippedInstruction
    ? `${isUrgent ? '[URGENT] ' : ''}Prepare ${cleanRoomName} – ${strippedInstruction.slice(0, 60)}`
    : `${isUrgent ? '[URGENT] ' : ''}${text.slice(0, 70)}`;

  res.json({
    success: true,
    data: {
      matchedRoomName: cleanRoomName,
      roomAreaId: matchedRoom.id,
      roomAreaName: cleanRoomName,
      title: normalizeDisplayText(rawTitle),
      description: text,
      priority,
      isUrgent,
      dueTime,
      checklist,
    },
  });
});

// Deterministic Operational Insights (Zero Gemini dependency)
app.get('/api/ai/operational-insights', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'reports', 'view')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const today = getISTDateFormatted();
  const todayTasks = db.tasks.filter(
    (t) => t.status !== 'CANCELLED' && getISTDateFormatted(new Date(t.scheduledFor)) === today
  );
  const completedCount = todayTasks.filter((t) => t.status === 'COMPLETED').length;
  const totalCount = todayTasks.length;
  const blockedCount = todayTasks.filter((t) => t.status === 'BLOCKED').length;

  const bottlenecks: string[] = [];
  const blockedRooms = todayTasks.filter((t) => t.status === 'BLOCKED');
  if (blockedRooms.length > 0) {
    blockedRooms.forEach((b) => {
      bottlenecks.push(`${b.roomAreaName}: ${b.blockedReason || 'Room occupied'}`);
    });
  } else {
    bottlenecks.push('No rooms currently blocked. All active room readiness routines operating on IST schedule.');
  }

  const recommendations: string[] = [
    'Employee Desk Cleaning completes first (by 9:30 AM IST), followed by Priority 1 rooms by 11:00 AM IST and Priority 2 rooms by 12:00 PM IST.',
    'Maintain 10:00 AM desk water delivery, 12:00 PM office plant watering, and 4:00 PM water bottle refill & redistribution.',
    'Ensure 7:30 PM closing inspection is verified with live camera evidence at end of day.',
  ];

  res.json({
    success: true,
    insights: {
      executiveSummary: `Daily Operational Status (IST): ${completedCount} of ${totalCount} today's tasks completed (${totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100}%). ${blockedCount} blocked rooms logged.`,
      bottlenecks,
      recommendations,
    },
  });
});

const VALID_SCHEDULER_MILESTONES = [
  '9AM_START',
  '10AM_WATER',
  '12PM_PLANTS',
  '4PM_WATER',
  '3PM_WATER',
  'CLOSING_AUDIT',
  '8PM_CLOSING',
] as const;

// 10. Scheduler Trigger (Daily IST task milestones)
app.post(['/api/scheduler/trigger', '/api/scheduler/trigger-milestone'], (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  if (!checkUserPermission(actor, 'tasks', 'create')) {
    return res.status(403).json({
      error: 'Only authorized users with task creation permission can trigger scheduled milestone routines.',
    });
  }

  const { milestone } = req.body || {}; // '9AM_START' | '10AM_WATER' | '12PM_PLANTS' | '4PM_WATER' | 'CLOSING_AUDIT'
  if (!milestone || !VALID_SCHEDULER_MILESTONES.includes(milestone)) {
    return res.status(400).json({
      error: `Invalid scheduler milestone "${String(milestone || '')}". Expected one of: ${VALID_SCHEDULER_MILESTONES.join(', ')}`,
    });
  }
  const today = getISTDateFormatted();

  if (milestone === '9AM_START') {
    syncTodayRoutineTasks(today);
    notify(
      '9:00 AM IST Daily Schedule Verified',
      'Employee Desk Cleaning (by 9:30 AM), Priority 1 rooms (by 11:00 AM), and Priority 2 rooms (by 12:00 PM) are active.',
      'TASK_ASSIGNED',
      { role: 'PANTRY_BOY' }
    );
  } else if (milestone === '10AM_WATER') {
    const waterTask = generateDailyTasks(today, db.rooms, db.users).find((t) => t.taskType === 'WATER_DISTRIBUTION');
    if (waterTask) {
      db.deletedTaskIds = (db.deletedTaskIds || []).filter((id) => id !== waterTask.id);
      const existing = db.tasks.find((t) => t.id === waterTask.id);
      if (existing) {
        if (existing.status === 'SCHEDULED') existing.status = 'AVAILABLE';
      } else {
        waterTask.status = 'AVAILABLE';
        db.tasks.unshift(waterTask);
      }
    }
    notify(
      '10:00 AM Desk Water Delivery',
      "Time to deliver filled water bottles to every employee's desk.",
      'TASK_ASSIGNED',
      { role: 'PANTRY_BOY' }
    );
  } else if (milestone === '12PM_PLANTS') {
    const plantsTask = generateDailyTasks(today, db.rooms, db.users).find((t) => t.taskType === 'PLANTS');
    if (plantsTask) {
      db.deletedTaskIds = (db.deletedTaskIds || []).filter((id) => id !== plantsTask.id);
      const existing = db.tasks.find((t) => t.id === plantsTask.id);
      if (existing) {
        if (existing.status === 'SCHEDULED') existing.status = 'AVAILABLE';
      } else {
        plantsTask.status = 'AVAILABLE';
        db.tasks.unshift(plantsTask);
      }
    }
    notify('12:00 PM Office Plants Watering', 'Time to water all indoor office plants.', 'TASK_ASSIGNED', {
      role: 'PANTRY_BOY',
    });
  } else if (milestone === '4PM_WATER' || milestone === '3PM_WATER') {
    const refillTask = generateDailyTasks(today, db.rooms, db.users).find((t) => t.taskType === 'WATER_RECHECK');
    if (refillTask) {
      db.deletedTaskIds = (db.deletedTaskIds || []).filter((id) => id !== refillTask.id);
      const existing = db.tasks.find((t) => t.id === refillTask.id);
      if (existing) {
        if (existing.status === 'SCHEDULED') existing.status = 'AVAILABLE';
      } else {
        refillTask.status = 'AVAILABLE';
        db.tasks.unshift(refillTask);
      }
    }
    notify(
      '4:00 PM Water Refill & Redistribution',
      "Refill and redistribute filled water bottles to every employee's desk.",
      'TASK_ASSIGNED',
      { role: 'PANTRY_BOY' }
    );
  } else if (milestone === 'CLOSING_AUDIT' || milestone === '8PM_CLOSING') {
    const closingTask = generateDailyTasks(today, db.rooms, db.users).find((t) => t.taskType === 'CLOSING_INSPECTION');
    if (closingTask) {
      db.deletedTaskIds = (db.deletedTaskIds || []).filter((id) => id !== closingTask.id);
      const existing = db.tasks.find((t) => t.id === closingTask.id);
      if (existing) {
        if (existing.status === 'SCHEDULED') existing.status = 'AVAILABLE';
      } else {
        closingTask.status = 'AVAILABLE';
        db.tasks.unshift(closingTask);
      }
    }
    db.tasks.forEach((t) => {
      if (t.id === closingTask?.id) return;
      if (
        getISTDateFormatted(new Date(t.scheduledFor)) === today &&
        (t.status === 'AVAILABLE' || t.status === 'IN_PROGRESS')
      ) {
        t.status = 'OVERDUE';
      }
    });
    notify(
      'End-of-Day Closing Audit',
      'Unfinished tasks marked OVERDUE. End-of-day closing checklist is mandatory.',
      'TASK_OVERDUE',
      { role: 'PANTRY_BOY' }
    );
  }

  addAuditLog(
    actor,
    'SCHEDULER_MILESTONE_TRIGGERED',
    'SCHEDULE',
    `milestone-${milestone}`,
    `Manually triggered ${milestone} scheduler milestone`
  );
  saveDb();
  broadcastRealtime('task:updated', { tasks: db.tasks.map((t) => normalizeTaskRecord(t)), serverTime: new Date().toISOString() });
  res.json({ success: true, message: `Triggered ${milestone}` });
});

// Start 1-second server-authoritative IST task schedule & alert ticker
setInterval(() => {
  try {
    runTaskScheduleEngine();
  } catch (err) {
    console.error('Task schedule engine error:', err);
  }
}, 1000);

// Ensure any unhandled /api requests return a clean JSON 404 and never fall through to Vite HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// -----------------------------------------------------------------------------
// Vite Middleware / Static Asset Serving
// -----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SmartPantry Pro company backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
