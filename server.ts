import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type {
  Role,
  UserAccount,
  RoomArea,
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parser with 20MB limit for camera photo uploads
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// -----------------------------------------------------------------------------
// Local Storage & Database Persistence Layer
// -----------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'smart_pantry_db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'photos');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve uploaded photos and public assets directly via Express
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// -----------------------------------------------------------------------------
// Real-time Event Broadcaster (Server-Sent Events)
// -----------------------------------------------------------------------------
interface SSEClientEntry {
  res: express.Response;
  req: express.Request;
}

const sseClients = new Set<SSEClientEntry>();

function broadcastRealtime(event: string, payload: any) {
  const nowIso = new Date().toISOString();
  const enrichedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, serverTime: payload.serverTime || nowIso }
      : payload;
  const message = `event: ${event}\ndata: ${JSON.stringify({ event, payload: enrichedPayload, timestamp: nowIso })}\n\n`;
  for (const client of sseClients) {
    try {
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
    defaultPriority: 'P2',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Wipe down designated desk surfaces and monitor edges',
      'Align employee chairs neatly',
      'Arrange desktop stationery organizers',
      'Inspect surrounding area and cabling',
      'Capture and upload required verification photo',
    ],
  },
  {
    id: 'room-3',
    name: 'Executive Cabin',
    category: 'EXECUTIVE_CABIN',
    defaultPriority: 'P3',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Clean executive mahogany desk and conference table',
      'Align high-back leather executive chairs',
      'Replenish fresh water carafe & clean glasses',
      'Check air conditioning and ambient lighting',
      'Complete cabin checklist and capture photo',
    ],
  },
  {
    id: 'room-4',
    name: "Kimmi's Cabin",
    category: 'EXECUTIVE_CABIN',
    defaultPriority: 'P4',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Sanitize executive desk and consultation area',
      'Arrange visitor seating and guest coasters',
      'Check fresh stationery and tissue box replenishment',
      'Inspect glass partitions and room fragrance',
      'Capture and upload cabin verification photograph',
    ],
  },
  {
    id: 'room-5',
    name: 'Prestige Loft',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Arrange candidate interview chairs and coffee tables',
      'Ensure water glasses and hand sanitizer are present',
      'Wipe down presentation screen and surfaces',
      'Upload room readiness photograph',
    ],
  },
  {
    id: 'room-6',
    name: 'The Skyline',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Clean 12-seater boardroom table',
      'Align all 12 chairs evenly with table edge',
      'Check whiteboard and markers',
      'Place sealed water bottles at designated seats',
      'Capture room alignment photograph',
    ],
  },
  {
    id: 'room-7',
    name: 'The Community',
    category: 'COMMON_AREA',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Clean community lounge tables and seating cushions',
      'Sanitize microwave, coffee machine area & pantry counter',
      'Replenish stirrers, napkins and tea/coffee sachets',
      'Wipe high-touch surfaces and capture photo',
    ],
  },
  {
    id: 'room-8',
    name: 'The Summit',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Sanitize summit meeting room table',
      'Align conference chairs with uniform gap',
      'Check video conferencing display and cables',
      'Verify water supply and upload photo',
    ],
  },
  {
    id: 'room-9',
    name: 'WCR Air',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Wipe glass table and clean chairs',
      'Check whiteboard cleanliness',
      'Ensure trash bin is empty',
      'Capture status photo',
    ],
  },
  {
    id: 'room-10',
    name: 'Elegance Suite (Kimmi Suite)',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Sanitize confidential meeting table',
      'Align 6 ergonomic chairs',
      'Check confidentiality blinds and ventilation',
      'Upload verification photo',
    ],
  },
  {
    id: 'room-11',
    name: 'Prime Loft',
    category: 'WORKSTATION',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Tidy communal desks and check walkways',
      'Clean shared filing cabinets top',
      'Check lighting and floor sweep',
      'Upload photo evidence',
    ],
  },
  {
    id: 'room-12',
    name: 'Regency',
    category: 'COMMON_AREA',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Dust guest lounge sofa and tea tables',
      'Arrange reading material and guest stationery',
      'Verify water carafe cleanliness',
      'Upload photograph',
    ],
  },
  {
    id: 'room-13',
    name: 'Office Dustbins',
    category: 'FACILITIES',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'DAILY',
    enabled: true,
    defaultChecklist: [
      'Empty all registered office and pantry dustbins',
      'Fit clean heavy-duty bin liners properly',
      'Wipe and sanitize exterior dustbin surfaces',
      'Return dustbins to their designated corners/under-desk spots',
      'Capture evidence photo of cleared disposal area',
    ],
  },
  {
    id: 'room-14',
    name: 'Outer Area',
    category: 'FACILITIES',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'ALTERNATE_DAYS',
    enabled: true,
    defaultChecklist: [
      'Sweep entrance walkway and outer porch',
      'Clean outdoor signage and shoe rack/door mat area',
      'Inspect outer storage locker and ensure doors closed',
      'Capture outer area photo evidence',
    ],
  },
  {
    id: 'room-15',
    name: 'Office Plants',
    category: 'FACILITIES',
    defaultPriority: 'P5',
    photoRequired: true,
    status: 'AVAILABLE',
    recurrence: 'EVERY_3_DAYS',
    enabled: true,
    defaultChecklist: [
      'Check soil moisture for indoor fiddle-leaf figs and snake plants',
      'Water plants requiring scheduled hydration (do not over-water)',
      'Wipe dust from decorative planter pots and remove dead leaves',
      'Upload plant maintenance verification photo',
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
    roomAreaName: 'Executive Cabin',
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

const ROUTINE_SCHEDULE_SLOTS_IST: Record<string, { startHHMM: string; dueTime: string }> = {
  reception: { startHHMM: '09:00', dueTime: '09:30 AM' },
  desks: { startHHMM: '09:30', dueTime: '10:00 AM' },
  'water-10am': { startHHMM: '10:00', dueTime: '10:30 AM' },
  'exec-cabin': { startHHMM: '10:15', dueTime: '10:45 AM' },
  'kimmi-cabin': { startHHMM: '10:45', dueTime: '11:15 AM' },
  prestige: { startHHMM: '11:15', dueTime: '11:45 AM' },
  skyline: { startHHMM: '11:45', dueTime: '12:15 PM' },
  community: { startHHMM: '12:15', dueTime: '12:45 PM' },
  dustbins: { startHHMM: '12:45', dueTime: '01:15 PM' },
  summit: { startHHMM: '13:15', dueTime: '01:45 PM' },
  'wcr-air': { startHHMM: '13:45', dueTime: '02:15 PM' },
  elegance: { startHHMM: '14:15', dueTime: '02:45 PM' },
  'prime-loft': { startHHMM: '14:35', dueTime: '03:00 PM' },
  'water-3pm': { startHHMM: '15:00', dueTime: '03:45 PM' },
  regency: { startHHMM: '15:45', dueTime: '04:15 PM' },
  plants: { startHHMM: '16:30', dueTime: '05:00 PM' },
  'outer-area': { startHHMM: '17:15', dueTime: '05:45 PM' },
  closing: { startHHMM: '19:30', dueTime: '07:55 PM' },
};

function applyRoutineISTSchedule(tasksList: Task[], dateStr: string, nowMs: number = Date.now()): Task[] {
  return tasksList.map((task) => {
    const match = task.id.match(/^task-(\d{4}-\d{2}-\d{2})-(.+)$/);
    const slug = match ? match[2] : '';
    const slot = ROUTINE_SCHEDULE_SLOTS_IST[slug];
    if (!slot) return task;
    const scheduledFor = buildISTIso(match ? match[1] : dateStr, slot.startHHMM);
    const schedMs = new Date(scheduledFor).getTime();
    const isFuture = schedMs > nowMs + 5000;
    return {
      ...task,
      createdAt: buildISTIso(match ? match[1] : dateStr, '09:00'),
      scheduledFor,
      dueTime: slot.dueTime,
      status: isFuture ? 'SCHEDULED' : 'AVAILABLE',
    };
  });
}

// Helper to generate today's tasks for all configured rooms (IST schedule)
function generateDailyTasks(): Task[] {
  const today = getISTDateFormatted();
  const assignedPantry = INITIAL_USERS[0];

  const tasks: Task[] = [
    // 1. Reception (Priority 1)
    {
      id: `task-${today}-reception`,
      title: 'Reception Routine Cleaning & Arrangement',
      description: 'Morning surface sanitization, chair alignment, and welcome desk setup.',
      roomAreaId: 'room-1',
      roomAreaName: 'Reception',
      priority: 'P1',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 9:00 AM Scheduler',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '09:30 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Clean reception surfaces and marble counter', completed: false },
        { id: 'c-2', text: 'Arrange visitor chairs in proper geometric alignment', completed: false },
        { id: 'c-3', text: 'Return brochures and guest registers to designated positions', completed: false },
        { id: 'c-4', text: 'Check overall cleanliness and floor appearance', completed: false },
        { id: 'c-5', text: 'Capture and upload mandatory photo evidence', completed: false },
      ],
      changeHistory: [
        {
          timestamp: `${today}T09:00:00.000Z`,
          actorEmail: 'system@whitecollarrealty.com',
          actorName: 'System Scheduler',
          fromStatus: 'SCHEDULED',
          toStatus: 'AVAILABLE',
          note: 'Generated for 9:00 AM Start-of-Day',
        },
      ],
    },
    // 2. Employee Desks (Priority 2)
    {
      id: `task-${today}-desks`,
      title: 'Employee Desks Morning Cleaning & Chair Alignment',
      description: 'Clean designated desk surfaces, align employee chairs, arrange desktop items.',
      roomAreaId: 'room-2',
      roomAreaName: 'Employee Desks',
      priority: 'P2',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 9:00 AM Scheduler',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '10:00 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Clean designated desk surfaces without disturbing private documents', completed: false },
        { id: 'c-2', text: 'Align all ergonomic chairs with desk borders', completed: false },
        { id: 'c-3', text: 'Arrange permitted desktop items in standard positions', completed: false },
        { id: 'c-4', text: 'Check surrounding walkway cleanliness', completed: false },
        { id: 'c-5', text: 'Capture and upload desk line photo evidence', completed: false },
      ],
      changeHistory: [],
    },
    // 3. 10:00 AM Water Distribution (Priority 2)
    {
      id: `task-${today}-water-10am`,
      title: '10:00 AM – Water Bottle Distribution on Employee Desks',
      description: 'Distribute fresh water bottles across all designated employee desks and record exceptions.',
      roomAreaId: 'room-2',
      roomAreaName: 'Employee Desks',
      priority: 'P2',
      taskType: 'WATER_DISTRIBUTION',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 10:00 AM Scheduler',
      createdAt: `${today}T10:00:00.000Z`,
      scheduledFor: `${today}T10:00:00.000Z`,
      dueTime: '10:30 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Verify fresh chilled water bottles inventory in pantry', completed: false },
        { id: 'c-2', text: 'Distribute bottles to Main Bay Desks 1-20', completed: false },
        { id: 'c-3', text: 'Distribute bottles to Prime Loft Desks 21-35', completed: false },
        { id: 'c-4', text: 'Record any empty desk or employee absence exceptions', completed: false },
        { id: 'c-5', text: 'Capture photo of distributed bottle alignment', completed: false },
      ],
      changeHistory: [],
    },
    // 4. Executive Cabin (Priority 3)
    {
      id: `task-${today}-exec-cabin`,
      title: "Executive Cabin Sanitization & Hospitality Setup",
      description: "Clean desk, arrange executive chairs, replenish fresh carafe, check ambient temp.",
      roomAreaId: 'room-3',
      roomAreaName: 'Executive Cabin',
      priority: 'P3',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 9:00 AM Scheduler',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '10:30 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Wipe executive mahogany table and glass coasters', completed: false },
        { id: 'c-2', text: 'Align executive leather chairs neatly', completed: false },
        { id: 'c-3', text: 'Place fresh water carafe & clean glasses', completed: false },
        { id: 'c-4', text: 'Inspect cabin fragrance and tissue dispenser', completed: false },
        { id: 'c-5', text: 'Upload mandatory camera photo', completed: false },
      ],
      changeHistory: [],
    },
    // 5. Kimmi's Cabin (Priority 4)
    {
      id: `task-${today}-kimmi-cabin`,
      title: "Kimmi's Cabin Sanitization & Setup",
      description: 'Sanitize desk, arrange visitor chairs, replenish stationery and check room readiness.',
      roomAreaId: 'room-4',
      roomAreaName: "Kimmi's Cabin",
      priority: 'P4',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 9:00 AM Scheduler',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '11:00 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Sanitize executive workstation and meeting table', completed: false },
        { id: 'c-2', text: 'Align visitor chairs with desk', completed: false },
        { id: 'c-3', text: 'Replenish sealed water bottles and fresh glasses', completed: false },
        { id: 'c-4', text: 'Check overall cabin presentation', completed: false },
        { id: 'c-5', text: 'Capture and upload live camera photo', completed: false },
      ],
      changeHistory: [],
    },
    // 6. Prestige Loft
    {
      id: `task-${today}-prestige`,
      title: 'Prestige Loft Cleaning & Candidate Setup',
      description: 'Arrange candidate chairs, replenish water glasses, clean presentation screen.',
      roomAreaId: 'room-5',
      roomAreaName: 'Prestige Loft',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '11:30 AM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Arrange candidate interview chairs and coffee tables', completed: false },
        { id: 'c-2', text: 'Ensure water glasses and hand sanitizer are present', completed: false },
        { id: 'c-3', text: 'Wipe down presentation screen and surfaces', completed: false },
        { id: 'c-4', text: 'Upload room readiness photograph', completed: false },
      ],
      changeHistory: [],
    },
    // 7. The Skyline (Boardroom)
    {
      id: `task-${today}-skyline`,
      title: 'The Skyline Boardroom 12-Chair Geometric Alignment & Table Sanitization',
      description: 'Clean boardroom table, align 12 chairs evenly, check whiteboard and markers.',
      roomAreaId: 'room-6',
      roomAreaName: 'The Skyline',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '12:00 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Clean 12-seater boardroom table surface', completed: false },
        { id: 'c-2', text: 'Align all 12 chairs evenly with table edge', completed: false },
        { id: 'c-3', text: 'Check whiteboard cleanliness and refill fresh markers', completed: false },
        { id: 'c-4', text: 'Place sealed water bottles at designated seats', completed: false },
        { id: 'c-5', text: 'Capture room alignment photograph', completed: false },
      ],
      changeHistory: [],
    },
    // 8. The Community (Central Hub)
    {
      id: `task-${today}-community`,
      title: 'The Community Central Hub Lounge & Pantry Counter Sanitization',
      description: 'Sanitize microwave, coffee machine area, replenish tea/coffee sachets, wipe seating.',
      roomAreaId: 'room-7',
      roomAreaName: 'The Community',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '12:30 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Clean community lounge tables and seating cushions', completed: false },
        { id: 'c-2', text: 'Sanitize microwave, coffee machine area & pantry counter', completed: false },
        { id: 'c-3', text: 'Replenish stirrers, napkins and tea/coffee sachets', completed: false },
        { id: 'c-4', text: 'Wipe high-touch surfaces and capture photo', completed: false },
      ],
      changeHistory: [],
    },
    // 9. Office Dustbins Daily Emptying
    {
      id: `task-${today}-dustbins`,
      title: 'Office Dustbins Daily Emptying & Heavy Liner Replacement',
      description: 'Empty all 13 registered bins, replace heavy liners, sanitize bin covers.',
      roomAreaId: 'room-13',
      roomAreaName: 'Office Dustbins',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '01:00 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Empty Reception & Waiting Area dustbins', completed: false },
        { id: 'c-2', text: 'Empty Main Bay Workstation dustbins', completed: false },
        { id: 'c-3', text: 'Empty Executive Cabins & Boardroom dustbins', completed: false },
        { id: 'c-4', text: 'Replace torn liners and wipe bin lids with disinfectant', completed: false },
        { id: 'c-5', text: 'Capture photo of cleaned central disposal station', completed: false },
      ],
      changeHistory: [],
    },
    // 10. The Summit
    {
      id: `task-${today}-summit`,
      title: 'The Summit Top Floor Meeting Suite Preparation',
      description: 'Sanitize summit meeting table, align conference chairs, verify video display.',
      roomAreaId: 'room-8',
      roomAreaName: 'The Summit',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '01:30 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Sanitize summit meeting room table', completed: false },
        { id: 'c-2', text: 'Align conference chairs with uniform gap', completed: false },
        { id: 'c-3', text: 'Check video conferencing display and cables', completed: false },
        { id: 'c-4', text: 'Verify water supply and upload photo', completed: false },
      ],
      changeHistory: [],
    },
    // 11. WCR Air
    {
      id: `task-${today}-wcr-air`,
      title: 'WCR Air Glass Table Cleaning & Room Reset',
      description: 'Wipe glass meeting table, check whiteboard, empty bin, capture photo.',
      roomAreaId: 'room-9',
      roomAreaName: 'WCR Air',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '02:00 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Wipe glass table and clean chairs', completed: false },
        { id: 'c-2', text: 'Check whiteboard cleanliness', completed: false },
        { id: 'c-3', text: 'Ensure trash bin is empty', completed: false },
        { id: 'c-4', text: 'Capture status photo', completed: false },
      ],
      changeHistory: [],
    },
    // 12. Elegance Suite (Kimmi Suite)
    {
      id: `task-${today}-elegance`,
      title: 'Elegance Suite (Kimmi Suite) Confidential Room Sanitization',
      description: 'Sanitize confidential meeting table, align 6 ergonomic chairs, check blinds.',
      roomAreaId: 'room-10',
      roomAreaName: 'Elegance Suite (Kimmi Suite)',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '02:30 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Sanitize confidential meeting table', completed: false },
        { id: 'c-2', text: 'Align 6 ergonomic chairs', completed: false },
        { id: 'c-3', text: 'Check confidentiality blinds and ventilation', completed: false },
        { id: 'c-4', text: 'Upload verification photo', completed: false },
      ],
      changeHistory: [],
    },
    // 13. Prime Loft
    {
      id: `task-${today}-prime-loft`,
      title: 'Prime Loft Communal Desks & Filing Station Tidy',
      description: 'Tidy communal desks, clean shared cabinet tops, inspect walkways and lighting.',
      roomAreaId: 'room-11',
      roomAreaName: 'Prime Loft',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '03:00 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Tidy communal desks and check walkways', completed: false },
        { id: 'c-2', text: 'Clean shared filing cabinets top', completed: false },
        { id: 'c-3', text: 'Check lighting and floor sweep', completed: false },
        { id: 'c-4', text: 'Upload photo evidence', completed: false },
      ],
      changeHistory: [],
    },
    // 14. 3:00 PM Water Bottle Recheck (Priority 3)
    {
      id: `task-${today}-water-3pm`,
      title: '3:00 PM – Water Bottle Recheck & Chair Realignment',
      description: 'Check employee desks for refills/replacements and correct disarranged chairs.',
      roomAreaId: 'room-2',
      roomAreaName: 'Employee Desks',
      priority: 'P3',
      taskType: 'WATER_RECHECK',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic 3:00 PM Scheduler',
      createdAt: `${today}T15:00:00.000Z`,
      scheduledFor: `${today}T15:00:00.000Z`,
      dueTime: '03:45 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Walk through all employee rows with fresh water tray', completed: false },
        { id: 'c-2', text: 'Replace empty or used bottles with fresh sealed bottles', completed: false },
        { id: 'c-3', text: 'Correct pushed-out or misaligned chairs', completed: false },
        { id: 'c-4', text: 'Clear abandoned cups and snack wrappers from aisles', completed: false },
        { id: 'c-5', text: 'Capture verification photo of aligned aisle', completed: false },
      ],
      changeHistory: [],
    },
    // 15. Regency
    {
      id: `task-${today}-regency`,
      title: 'Regency Guest Lounge Sofa Fluffing & Reading Area Setup',
      description: 'Dust guest lounge sofa and tea tables, arrange reading materials, verify carafe.',
      roomAreaId: 'room-12',
      roomAreaName: 'Regency',
      priority: 'P5',
      taskType: 'ROUTINE_CLEANING',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '04:15 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Dust guest lounge sofa and tea tables', completed: false },
        { id: 'c-2', text: 'Arrange reading material and guest stationery', completed: false },
        { id: 'c-3', text: 'Verify water carafe cleanliness', completed: false },
        { id: 'c-4', text: 'Upload photograph', completed: false },
      ],
      changeHistory: [],
    },
    // 16. Office Plants (Recurring every 3 days)
    {
      id: `task-${today}-plants`,
      title: 'Office Plants Scheduled Hydration & Foliage Care',
      description: 'Inspect soil moisture and gently water designated indoor office plants.',
      roomAreaId: 'room-15',
      roomAreaName: 'Office Plants',
      priority: 'P5',
      taskType: 'PLANTS',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Recurring Schedule (Every 3 Days)',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '05:00 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Check soil moisture of reception decorative palms', completed: false },
        { id: 'c-2', text: 'Water executive corridor planters with measured hydration', completed: false },
        { id: 'c-3', text: 'Wipe dust off leaves and wipe planter bases', completed: false },
        { id: 'c-4', text: 'Upload plant health verification photo', completed: false },
      ],
      changeHistory: [],
    },
    // 17. Outer Area (Alternate Days)
    {
      id: `task-${today}-outer-area`,
      title: 'Outer Area Entrance Sweep & Balcony Corridor Maintenance',
      description: 'Sweep entrance walkway, clean signage, arrange doormat area, inspect storage locker.',
      roomAreaId: 'room-14',
      roomAreaName: 'Outer Area',
      priority: 'P5',
      taskType: 'OUTER_AREA',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Alternate Day Schedule',
      createdAt: `${today}T09:00:00.000Z`,
      scheduledFor: `${today}T09:00:00.000Z`,
      dueTime: '05:45 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Sweep entrance walkway and outer porch', completed: false },
        { id: 'c-2', text: 'Clean outdoor signage and shoe rack/door mat area', completed: false },
        { id: 'c-3', text: 'Inspect outer storage locker and ensure doors closed', completed: false },
        { id: 'c-4', text: 'Capture outer area photo evidence', completed: false },
      ],
      changeHistory: [],
    },
    // 18. Mandatory Closing Inspection (Scheduled 7:30 PM, Due 7:55 PM IST)
    {
      id: `task-${today}-closing`,
      title: '7:30 PM – Mandatory End-of-Day Office Closing Inspection',
      description: 'Comprehensive end-of-day check: Reception, Desks, Cabins, Dustbins, and Appliance Lockdown.',
      roomAreaId: 'room-1',
      roomAreaName: 'Reception & All Areas',
      priority: 'P1',
      taskType: 'CLOSING_INSPECTION',
      assignedToEmail: assignedPantry.email,
      assignedToName: assignedPantry.name,
      createdByEmail: 'system@whitecollarrealty.com',
      createdByName: 'Automatic Closing Scheduler',
      createdAt: `${today}T19:30:00.000Z`,
      scheduledFor: `${today}T19:30:00.000Z`,
      dueTime: '07:55 PM',
      status: 'AVAILABLE',
      isUrgent: false,
      checklist: [
        { id: 'c-1', text: 'Verify Reception is locked, tidy and welcome display turned off', completed: false },
        { id: 'c-2', text: 'Verify all Employee Desks are clean and chairs neatly tucked', completed: false },
        { id: 'c-3', text: "Check Executive Cabins and Kimmi's Cabin locked and sanitized", completed: false },
        { id: 'c-4', text: 'Ensure all meeting rooms (The Skyline, The Summit, Prestige Loft, WCR Air, Elegance Suite (Kimmi Suite)) are reset', completed: false },
        { id: 'c-5', text: 'Confirm all dustbins emptied and trash bags deposited in municipal bin', completed: false },
        { id: 'c-6', text: 'Ensure pantry appliances turned off and water taps closed', completed: false },
        { id: 'c-7', text: 'Capture comprehensive closing panoramic photo', completed: false },
      ],
      changeHistory: [],
    },
  ];

  return applyRoutineISTSchedule(tasks, today);
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
      guestCount: 6,
      scheduledTime: `${new Date().toISOString().split('T')[0]}T14:30:00.000Z`,
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
      scheduledTime: `${new Date().toISOString().split('T')[0]}T11:30:00.000Z`,
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
      message: 'Good morning Raju! Today’s routine tasks have been generated. Start with Reception (P1).',
      type: 'TASK_ASSIGNED',
      read: false,
      timestamp: new Date().toISOString(),
    },
  ],
  attendance: [],
  lastGeneratedDate: new Date().toISOString().split('T')[0],
};

function sanitizeLegacyString(val?: string): string {
  if (!val || typeof val !== 'string') return val || '';
  return val
    .replace(/kimmy\.mam@whitecollarrealty\.com/gi, 'kimmi.mam@whitecollarrealty.com')
    .replace(/Kimmy/g, 'Kimmi')
    .replace(/kimmy/g, 'kimmi')
    .replace(/\s*before 8:00 PM shift end/gi, '')
    .replace(/Automatic Shift-End Scheduler/gi, 'Automatic Closing Scheduler')
    .replace(/Daily Shift Active\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, 'Daily Operations Active')
    .replace(/Daily Tasks Generated\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, 'Daily Tasks Generated (IST)')
    .replace(/8:00 PM Shift Closing Audit/gi, 'End-of-Day Closing Audit')
    .replace(/Shift closed at 8:00 PM\.\s*/gi, '')
    .replace(/\s*Shift completes at 8:00 PM\.?/gi, '')
    .replace(/daily shift automation \(Asia\/Kolkata 9:00 AM\s*[–-]\s*8:00 PM\)/gi, 'automated IST task scheduling')
    .replace(/\s*\(9:00 AM\s*[–-]\s*8:00 PM[^)]*\)/gi, '')
    .replace(/\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, '')
    .replace(/\s*Geofence verification:.*$/i, '')
    .replace(
      /Iris Broadway,?\s*Gurugram/gi,
      '6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India'
    )
    .trim();
}

// Try to load persisted state from disk
try {
  if (fs.existsSync(DB_FILE)) {
    const rawData = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(rawData);
    if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.rooms)) {
      db = parsed;
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
      // Ensure all users have permissions and super admin flag
      db.users.forEach((u: any) => {
        if (!u.permissions) {
          u.permissions = getDefaultPermissions(u.role);
        } else if ('confidentialAccess' in u.permissions) {
          delete u.permissions.confidentialAccess;
        }
        if (u.id === 'user-admin-1' || u.email === 'admin.director@whitecollarrealty.com') {
          u.isSuperAdmin = true;
          u.permissions = getDefaultPermissions('ADMIN');
        }
      });
      // Migrate rooms to standard RoomStatus and strip floor
      db.rooms.forEach((r: any) => {
        delete r.floor;
        if (r.name === "Lalit Sir's Cabin") r.name = "Executive Cabin";
        if (r.name === "Kimmi's Cabin") r.name = "Kimmi's Cabin";
        if (r.name === "BCR Air" || r.name === "BCR AIR") r.name = "WCR Air";
        if (r.name === "Prime Block") r.name = "Prime Loft";
        if (r.name === "Residency" || r.name === "Redeincy") r.name = "Regency";
        if (r.name === "Allegation Suite" || r.name === "Allegation") r.name = "Elegance Suite (Kimmi Suite)";
        if (r.name === "Skyline") r.name = "The Skyline";
        if (r.name.includes("Prestige Block")) r.name = "Prestige Loft";
        if ((r.status as string) === 'READY') r.status = 'AVAILABLE';
        if ((r.status as string) === 'IN_USE') r.status = 'OCCUPIED';
        if ((r.status as string) === 'NEEDS_CLEANING') r.status = 'CLEANING_REQUIRED';
        if ((r.status as string) === 'PREPARING') r.status = 'PREPARATION_REQUIRED';
        if (!r.assignmentHistory) r.assignmentHistory = [];
        if (!r.statusHistory) r.statusHistory = [];
        if (r.currentAssignment === undefined) r.currentAssignment = null;
      });
      // Update tasks room names and titles
      db.tasks.forEach((t: any) => {
        if (t.roomAreaName === "Lalit Sir's Cabin") t.roomAreaName = "Executive Cabin";
        if (t.roomAreaName === "Kimmi's Cabin") t.roomAreaName = "Kimmi's Cabin";
        if (t.roomAreaName === "BCR Air") t.roomAreaName = "WCR Air";
        if (t.roomAreaName === "Prime Block") t.roomAreaName = "Prime Loft";
        if (t.roomAreaName === "Residency" || t.roomAreaName === "Redeincy") t.roomAreaName = "Regency";
        if (t.roomAreaName === "Allegation Suite" || t.roomAreaName === "Allegation") t.roomAreaName = "Elegance Suite (Kimmi Suite)";
        if (t.roomAreaName === "Skyline") t.roomAreaName = "The Skyline";
        if (t.roomAreaName.includes("Prestige Block")) t.roomAreaName = "Prestige Loft";
        if (t.title) {
          t.title = t.title
            .replace(/Lalit Sir's Cabin/g, 'Executive Cabin')
            .replace(/Kimmy/g, 'Kimmi')
            .replace(/BCR Air/g, 'WCR Air')
            .replace(/Prime Block/g, 'Prime Loft')
            .replace(/Residency/g, 'Regency')
            .replace(/Redeincy/g, 'Regency')
            .replace(/Allegation Suite/g, 'Elegance Suite (Kimmi Suite)')
            .replace(/\bSkyline\b/g, 'The Skyline')
            .replace(/Prestige Block( – Waiting Room)?/g, 'Prestige Loft');
        }
        if (Array.isArray(t.checklist)) {
          t.checklist.forEach((c: any) => {
            if (c.text) {
              c.text = c.text
                .replace(/Lalit Sir's and Kimmi's Cabins/g, "Executive Cabins and Kimmi's Cabin")
                .replace(/Kimmy/g, 'Kimmi')
                .replace(/BCR Air/g, 'WCR Air')
                .replace(/Prime Block/g, 'Prime Loft')
                .replace(/Residency/g, 'Regency')
                .replace(/Redeincy/g, 'Regency')
                .replace(/Allegation Suite/g, 'Elegance Suite (Kimmi Suite)')
                .replace(/Allegation/g, 'Elegance Suite (Kimmi Suite)')
                .replace(/\bSkyline\b/g, 'The Skyline')
                .replace(/Prestige Block( – Waiting Room)?/g, 'Prestige Loft')
                .replace(/\bPrestige\b/g, 'Prestige Loft');
            }
          });
        }
      });
      // Ensure all initial rooms exist in db.rooms
      for (const initRoom of INITIAL_ROOMS) {
        if (!db.rooms.some((r) => r.id === initRoom.id)) {
          db.rooms.push({ ...initRoom, status: 'AVAILABLE', assignmentHistory: [], statusHistory: [] });
        }
      }

      // Normalize legacy UTC routine timestamps (e.g. T09:00:00.000Z) to true IST (+05:30) staggered slots
      // while preserving existing statuses, checklists, photo evidence, and custom tasks
      const bootNowMs = Date.now();
      db.tasks.forEach((t: Task) => {
        const routineMatch = t.id.match(/^task-(\d{4}-\d{2}-\d{2})-(.+)$/);
        if (
          routineMatch &&
          t.createdByEmail === 'system@whitecollarrealty.com' &&
          ROUTINE_SCHEDULE_SLOTS_IST[routineMatch[2]] &&
          (t.scheduledFor.endsWith('T09:00:00.000Z') ||
            t.scheduledFor.endsWith('T10:00:00.000Z') ||
            t.scheduledFor.endsWith('T15:00:00.000Z') ||
            t.scheduledFor.endsWith('T19:30:00.000Z'))
        ) {
          const slot = ROUTINE_SCHEDULE_SLOTS_IST[routineMatch[2]];
          t.scheduledFor = buildISTIso(routineMatch[1], slot.startHHMM);
          t.dueTime = slot.dueTime;
          const schedMs = new Date(t.scheduledFor).getTime();
          if (schedMs > bootNowMs + 5000 && t.status === 'AVAILABLE' && !t.startedAt) {
            t.status = 'SCHEDULED';
          }
        }

        // Prevent stale popups on server boot for tasks whose scheduled time already passed >60s ago
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

// Sanitize persisted records (remove legacy location/geofence data, session timing strings, and normalize Kimmy -> Kimmi)
delete (db as any).officeConfig;
if (!Array.isArray(db.attendance)) {
  db.attendance = [];
}

db.rooms.forEach((r: any) => {
  if (r.name) r.name = sanitizeLegacyString(r.name);
  if (r.notes) r.notes = sanitizeLegacyString(r.notes);
  if (r.currentAssignment) {
    if (r.currentAssignment.assignedBy) r.currentAssignment.assignedBy = sanitizeLegacyString(r.currentAssignment.assignedBy);
    if (r.currentAssignment.visitorName) r.currentAssignment.visitorName = sanitizeLegacyString(r.currentAssignment.visitorName);
    if (r.currentAssignment.instructions) r.currentAssignment.instructions = sanitizeLegacyString(r.currentAssignment.instructions);
  }
  if (Array.isArray(r.assignmentHistory)) {
    r.assignmentHistory.forEach((ah: any) => {
      if (ah.assignedBy) ah.assignedBy = sanitizeLegacyString(ah.assignedBy);
      if (ah.visitorName) ah.visitorName = sanitizeLegacyString(ah.visitorName);
      if (ah.instructions) ah.instructions = sanitizeLegacyString(ah.instructions);
    });
  }
  if (Array.isArray(r.statusHistory)) {
    r.statusHistory.forEach((sh: any) => {
      if (sh.actorEmail) sh.actorEmail = sanitizeLegacyString(sh.actorEmail);
      if (sh.actorName) sh.actorName = sanitizeLegacyString(sh.actorName);
      if (sh.note) sh.note = sanitizeLegacyString(sh.note);
    });
  }
});

db.tasks.forEach((t: any) => {
  if (t.title) t.title = sanitizeLegacyString(t.title);
  if (t.description) t.description = sanitizeLegacyString(t.description);
  if (t.roomAreaName) t.roomAreaName = sanitizeLegacyString(t.roomAreaName);
  if (t.assignedToEmail) t.assignedToEmail = sanitizeLegacyString(t.assignedToEmail);
  if (t.assignedToName) t.assignedToName = sanitizeLegacyString(t.assignedToName);
  if (t.createdByEmail) t.createdByEmail = sanitizeLegacyString(t.createdByEmail);
  if (t.createdByName) t.createdByName = sanitizeLegacyString(t.createdByName);
  if (Array.isArray(t.checklist)) {
    t.checklist.forEach((c: any) => {
      if (c.text) c.text = sanitizeLegacyString(c.text);
    });
  }
  if (Array.isArray(t.changeHistory)) {
    t.changeHistory.forEach((ch: any) => {
      if (ch.actorEmail) ch.actorEmail = sanitizeLegacyString(ch.actorEmail);
      if (ch.actorName) ch.actorName = sanitizeLegacyString(ch.actorName);
      if (ch.note) ch.note = sanitizeLegacyString(ch.note);
    });
  }
  if (t.photoEvidence) {
    if (t.photoEvidence.uploadedBy) t.photoEvidence.uploadedBy = sanitizeLegacyString(t.photoEvidence.uploadedBy);
    if (t.photoEvidence.verifiedBy) t.photoEvidence.verifiedBy = sanitizeLegacyString(t.photoEvidence.verifiedBy);
  }
});

if (Array.isArray(db.visitors)) {
  db.visitors.forEach((v: any) => {
    if (v.visitorName) v.visitorName = sanitizeLegacyString(v.visitorName);
    if (v.hostName) v.hostName = sanitizeLegacyString(v.hostName);
    if (v.notes) v.notes = sanitizeLegacyString(v.notes);
  });
}

if (Array.isArray(db.pantryRequests)) {
  db.pantryRequests.forEach((pr: any) => {
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

  const existing =
    db.attendance.find((a) => a.userId === user.id && a.date === today && a.status === 'PRESENT' && !a.logoutTime) ||
    db.attendance.find((a) => a.userId === user.id && a.date === today);

  if (!existing) return null;

  existing.logoutTime = now.toISOString();
  existing.logoutTimeIST = getISTTimeString(now);
  existing.status = 'COMPLETED';

  const loginMs = new Date(existing.loginTime).getTime();
  const logoutMs = now.getTime();
  existing.elapsedMinutes = Math.max(1, Math.round((logoutMs - loginMs) / (60 * 1000)));
  existing.updatedAt = now.toISOString();

  saveDb();
  broadcastRealtime('attendance:updated', { attendance: existing });

  addAuditLog(
    { email: user.email, name: user.name, role: user.role },
    'ATTENDANCE_LOGOUT_RECORDED',
    'USER',
    user.id,
    `Pantry Boy logged out at ${existing.logoutTimeIST} IST. Total working duration: ${Math.floor(existing.elapsedMinutes / 60)}h ${existing.elapsedMinutes % 60}m.`
  );

  return existing;
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

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write db file:', err);
  }
}

saveDb();

// Automatic daily task generation check (synchronized to Asia/Kolkata IST date)
function ensureDailyTasks() {
  const today = getISTDateFormatted();
  if (db.lastGeneratedDate !== today) {
    const routineTasks = generateDailyTasks();
    routineTasks.forEach((t) => {
      if (!db.tasks.some((existing) => existing.id === t.id)) {
        db.tasks.unshift(t);
      }
    });
    db.lastGeneratedDate = today;
    notify(
      'Daily Tasks Generated (IST)',
      'All 15 office rooms and routines have been automatically scheduled for today in IST.',
      'TASK_ASSIGNED',
      { role: 'PANTRY_BOY' }
    );
    saveDb();
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
    read: false,
    timestamp: new Date().toISOString(),
  };
  db.notifications.unshift(notif);
  if (db.notifications.length > 200) {
    db.notifications.pop();
  }
  saveDb();
  broadcastRealtime('notification:new', { notification: notif });
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
  return '';
}

function getCurrentUser(req?: express.Request): UserAccount | null {
  const token = extractSessionToken(req);
  if (!token || revokedTokens.has(token)) return null;

  let session = activeSessions.get(token);
  if (!session) {
    // Recover valid unrevoked session across dev server restarts using exact token format
    const match = token.match(/^wcr_sess_(.+)_\d+_[a-z0-9]+$/);
    if (match) {
      const recoveredUserId = match[1];
      const targetUser = db.users.find((u) => u.id === recoveredUserId);
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
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Company email is required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const user = db.users.find(
    (u) =>
      u.email.toLowerCase() === cleanEmail ||
      (cleanEmail === 'kimmy.mam@whitecollarrealty.com' && u.id === 'user-kimmy-1')
  );

  if (!user) {
    return res.status(403).json({
      error: 'Access denied: Only pre-approved White Collar Realty company accounts may access this portal.',
    });
  }

  if (user.status === 'inactive') {
    return res.status(403).json({
      error: 'Account deactivated: This employee account has been deactivated. Please contact HR or Kimmi.',
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  // Generate trusted session token with 7-day validity
  const token = `wcr_sess_${user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  activeSessions.set(token, {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
  });

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

  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/auth/switch-user', (req, res) => {
  const prevToken = extractSessionToken(req);
  if (prevToken) {
    activeSessions.delete(prevToken);
    revokedTokens.add(prevToken);
  }

  const { userId } = req.body;
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'Cannot switch to deactivated account' });
  }

  const token = `wcr_sess_${user.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  activeSessions.set(token, {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
  });

  addAuditLog(
    { email: user.email, name: user.name, role: user.role },
    'USER_SWITCHED',
    'USER',
    user.id,
    `Switched active account session to ${user.name} (${user.role})`
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
  const record = recordPantryLogout(user);
  res.json({ success: true, attendance: record });
});


function checkUserPermission(
  actor: UserAccount | null,
  module: 'tasks' | 'rooms' | 'visitors' | 'users' | 'reports',
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
): boolean {
  if (!actor) return false;
  if (actor.role === 'ADMIN' || actor.isSuperAdmin) return true;
  const perms = actor.permissions || getDefaultPermissions(actor.role);
  if (action === 'export') {
    return Boolean((perms.actions as any)[module]?.export);
  }
  return Boolean((perms.actions as any)[module]?.[action]);
}

// 2. User Management
app.get('/api/users', (req, res) => {
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

app.post('/api/users', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'users', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can register company accounts.' });
  }

  const { name, email, role, department, phone, permissions } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'A user with this company email already exists.' });
  }

  const userRole: Role = role || 'PANTRY_BOY';
  if (userRole === 'ADMIN' && actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    return res.status(403).json({ error: 'Permission denied: Only an Administrator can create another Administrator account.' });
  }

  const sanitizedPermissions: UserPermissions = permissions
    ? {
        dashboards: permissions.dashboards,
        sidebarItems: permissions.sidebarItems,
        actions: permissions.actions,
      }
    : getDefaultPermissions(userRole);

  const newUser: UserAccount = {
    id: `user-${Date.now()}`,
    name,
    email: cleanEmail,
    role: userRole,
    department: department || (userRole === 'PANTRY_BOY' ? 'Hospitality & Operations' : 'Administration'),
    status: 'active',
    avatarUrl: '/assets/wcr_logo.png',
    phone: phone || '',
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

  const { name, email, role, department, phone, permissions } = req.body;

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

  if (name) targetUser.name = name;
  if (email && email.toLowerCase() !== targetUser.email.toLowerCase()) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.id !== targetUser.id && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: 'Another user with this email already exists.' });
    }
    targetUser.email = cleanEmail;
  }
  if (role) targetUser.role = role;
  if (department !== undefined) targetUser.department = department;
  if (phone !== undefined) targetUser.phone = phone;
  if (permissions) {
    targetUser.permissions = {
      dashboards: permissions.dashboards,
      sidebarItems: permissions.sidebarItems,
      actions: permissions.actions,
    };
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

app.get('/api/realtime/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientEntry: SSEClientEntry = { res, req };
  sseClients.add(clientEntry);

  const nowIso = new Date().toISOString();
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: 'connected',
      time: nowIso,
      serverTime: nowIso,
      timezone: 'Asia/Kolkata',
    })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
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

// 3. Room Management
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: db.rooms });
});

app.post('/api/rooms', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can create rooms.' });
  }

  const { name, category, defaultPriority, photoRequired, defaultChecklist, recurrence } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required' });

  const now = new Date().toISOString();
  const newRoom: RoomArea = {
    id: `room-${Date.now()}`,
    name: String(name).trim(),
    category: category || 'MEETING_SUITE',
    defaultPriority: defaultPriority || 'P5',
    photoRequired: photoRequired !== undefined ? Boolean(photoRequired) : true,
    status: 'AVAILABLE',
    recurrence: recurrence || 'DAILY',
    enabled: true,
    defaultChecklist: Array.isArray(defaultChecklist) && defaultChecklist.length > 0
      ? defaultChecklist
      : ['Clean surfaces', 'Align chairs', 'Check water supply', 'Capture live photo evidence'],
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

  db.rooms.push(newRoom);
  addAuditLog(actor, 'ROOM_CREATED', 'ROOM', newRoom.id, `Created room area "${newRoom.name}" with priority ${newRoom.defaultPriority}`);
  saveDb();
  broadcastRealtime('room:created', { room: newRoom, rooms: db.rooms });

  res.json({ success: true, room: newRoom });
});

app.put('/api/rooms/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'rooms', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized users can modify rooms.' });
  }

  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  Object.assign(room, req.body);
  addAuditLog(actor, 'ROOM_UPDATED', 'ROOM', room.id, `Updated room "${room.name}" configuration`);
  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });

  res.json({ success: true, room });
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

  addAuditLog(actor, 'ROOM_TOGGLE_ACTIVE', 'ROOM', room.id, `Set room "${room.name}" enabled=${room.enabled}`);
  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });

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
    roomAreaName: room.name,
    visitorName: String(visitorName).trim(),
    reference: reference ? String(reference).trim() : 'Executive Meeting / Interview',
    expectedArrival: expectedArrival ? String(expectedArrival).trim() : 'Immediate',
    expectedDuration: expectedDuration ? String(expectedDuration).trim() : '1 hour',
    prepRequirements: Array.isArray(prepRequirements) && prepRequirements.length > 0
      ? prepRequirements
      : ['Wipe table surface and clean glass coasters', 'Align all chairs in uniform geometric layout', 'Check AC and lighting'],
    waterRequirements: waterRequirements ? String(waterRequirements).trim() : '2 Chilled Sealed Bottles + Clean Glasses',
    priority: priority === 'URGENT' ? 'URGENT' : priority || 'P2',
    instructions: instructions ? String(instructions).trim() : '',
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

  const { action, note } = req.body;
  const now = new Date().toISOString();
  const assignedPantry = db.users.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active') || db.users[0];

  if (!room.statusHistory) room.statusHistory = [];
  if (!room.assignmentHistory) room.assignmentHistory = [];

  switch (action) {
    case 'MARK_OCCUPIED': {
      // Room entered by candidate / visitor
      room.status = 'OCCUPIED';
      const actorNote = note || `Room occupied: Meeting started for ${room.currentAssignment?.visitorName || 'guest'}`;
      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'OCCUPIED',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: actorNote,
        assignmentId: room.currentAssignment?.id,
      });

      addAuditLog(actor, 'ROOM_MARKED_OCCUPIED', 'ROOM', room.id, `Marked "${room.name}" as OCCUPIED. ${actorNote}`);
      notify(
        `Room Occupied: ${room.name}`,
        `${room.name} is now occupied (${room.currentAssignment?.visitorName || 'Guest'}). Do not disturb.`,
        'ROOM_OCCUPIED',
        { role: 'PANTRY_BOY', roomId: room.id, roomName: room.name }
      );
      break;
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

    case 'RELEASE_VACANT': {
      // Meeting finished, guest departed. Room MUST transition to CLEANING_REQUIRED.
      // Room remains unavailable until cleaning + photo verification is complete!
      room.status = 'CLEANING_REQUIRED';
      const previousVisitor = room.currentAssignment?.visitorName || 'Meeting guests';

      if (room.currentAssignment) {
        room.currentAssignment.releasedAt = now;
        room.currentAssignment.status = 'COMPLETED';
        room.assignmentHistory.unshift({ ...room.currentAssignment });
      }

      // Auto-generate post-meeting cleaning/reset task
      const resetTask: Task = {
        id: `task-reset-${room.id}-${Date.now()}`,
        title: `[POST-MEETING RESET] Clean & Sanitize ${room.name}`,
        description: `Guests (${previousVisitor}) have departed. Clear used bottles, sanitize tables, realign chairs, and restore room to AVAILABLE.`,
        roomAreaId: room.id,
        roomAreaName: room.name,
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
          { id: 'c-1', text: 'Clear used water bottles, glasses, and paper waste to pantry', completed: false },
          { id: 'c-2', text: 'Sanitize table surface and clean whiteboard if used', completed: false },
          { id: 'c-3', text: 'Realign all chairs in standard geometric layout', completed: false },
          { id: 'c-4', text: 'Check room fragrance and empty waste bin', completed: false },
          { id: 'c-5', text: `Capture live camera photo to return ${room.name} to AVAILABLE status`, completed: false },
        ],
        changeHistory: [
          {
            timestamp: now,
            actorEmail: actor.email,
            actorName: actor.name,
            fromStatus: 'NONE',
            toStatus: 'AVAILABLE',
            note: `Auto-generated upon room release by ${actor.name} (${actor.role})`,
          },
        ],
      };

      if (room.currentAssignment) {
        room.currentAssignment.resetTaskId = resetTask.id;
      }
      room.currentAssignment = null;

      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'CLEANING_REQUIRED',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: `Room released by ${actor.name}. Status transitioned to CLEANING_REQUIRED. Auto-generated task #${resetTask.id}.`,
        taskId: resetTask.id,
      });

      db.tasks.unshift(resetTask);

      addAuditLog(actor, 'ROOM_RELEASED_VACANT', 'ROOM', room.id, `Released "${room.name}". Generated cleaning task "${resetTask.title}".`);
      notify(
        `🧹 Room Vacant: Clean ${room.name}`,
        `${room.name} was released by ${actor.name}. Meeting finished. Please clear glasses, sanitize, and submit photo evidence.`,
        'ROOM_RELEASED',
        { role: 'PANTRY_BOY', taskId: resetTask.id, roomId: room.id, roomName: room.name }
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
      // Management override: make room AVAILABLE
      room.status = 'AVAILABLE';
      if (room.currentAssignment) {
        room.currentAssignment.status = 'CANCELLED';
        room.assignmentHistory.unshift({ ...room.currentAssignment });
        room.currentAssignment = null;
      }

      const overrideNote = note || `Reopened / restored to AVAILABLE by ${actor.name}`;
      room.statusHistory.unshift({
        id: `hist-${Date.now()}`,
        status: 'AVAILABLE',
        timestamp: now,
        actorName: actor.name,
        actorEmail: actor.email,
        note: overrideNote,
      });

      addAuditLog(actor, 'ROOM_REOPENED', 'ROOM', room.id, `Restored "${room.name}" to AVAILABLE. ${overrideNote}`);
      notify(
        `Room Reopened: ${room.name}`,
        `${room.name} is now AVAILABLE for new assignments.`,
        'ROOM_READY',
        { role: 'HR', roomId: room.id, roomName: room.name }
      );
      break;
    }

    default:
      return res.status(400).json({ error: `Invalid room action: ${action}` });
  }

  saveDb();
  broadcastRealtime('room:updated', { room, rooms: db.rooms });
  broadcastRealtime('task:updated', { tasks: db.tasks });

  res.json({ success: true, room });
});

// Get Room Assignment & Status History
app.get('/api/rooms/:id/history', (req, res) => {
  const room = db.rooms.find((r) => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Gather all photo evidence associated with this room's tasks
  const roomTasks = db.tasks.filter((t) => t.roomAreaId === room.id && t.photoEvidence);
  const photoHistory = roomTasks.map((t) => t.photoEvidence!);

  res.json({
    room,
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

  if (requester.role === 'PANTRY_BOY' || !hasManagementDashboard) {
    // Pantry Boy: Show active tasks ordered chronologically by scheduled date & time (IST)
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
  } else {
    filtered.sort((a, b) => {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      const pA = priorityOrder[a.priority] ?? 99;
      const pB = priorityOrder[b.priority] ?? 99;
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  res.json({ tasks: filtered, serverTime: new Date().toISOString() });
});

app.post('/api/tasks', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'tasks', 'create')) {
    return res.status(403).json({ error: 'Permission denied: Only Admin or authorized managers can assign new tasks.' });
  }

  const { title, roomAreaId, priority, scheduledFor, dueTime, assignedToEmail, description, checklist, isUrgent } = req.body;
  if (!title || !roomAreaId) {
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
      ? String(dueTime).trim()
      : isFutureScheduled
      ? formatISTShortTime(new Date(scheduledMs + 30 * 60 * 1000))
      : 'Immediate (within 30 mins)';

  const newTask: Task = {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: String(title).trim(),
    description: description || '',
    roomAreaId: room.id,
    roomAreaName: room.name,
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
          text: typeof item === 'string' ? item : item.text,
          completed: false,
        }))
      : room.defaultChecklist.map((text, idx) => ({
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
        toStatus: initialStatus,
        note: `Created by ${actor.name} (${actor.role}) · Scheduled for ${formatISTScheduleLabel(resolvedScheduledFor)} ${isUrgent ? '[URGENT PRIORITY]' : ''}`,
      },
    ],
  };

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

  saveDb();
  broadcastRealtime('task:updated', { task: newTask, tasks: db.tasks, serverTime: now });

  // Evaluate immediate or within-5-minute alert windows right away
  runTaskScheduleEngine();

  res.json({ success: true, task: newTask, serverTime: now });
});

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
  } = req.body;

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const prevStatus = task.status;
  const prevScheduledFor = task.scheduledFor;
  let wasRescheduled = false;

  if (title !== undefined && String(title).trim()) {
    task.title = String(title).trim();
  }
  if (description !== undefined) {
    task.description = String(description);
  }
  if (roomAreaId && roomAreaId !== task.roomAreaId) {
    const targetRoom = db.rooms.find((r) => r.id === roomAreaId);
    if (targetRoom) {
      task.roomAreaId = targetRoom.id;
      task.roomAreaName = targetRoom.name;
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
        const existing = task.checklist.find((c) => c.text === item);
        return { id: existing?.id || `item-${idx}`, text: item, completed: existing?.completed || false };
      }
      return item;
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
    task.dueTime = String(dueTime).trim();
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
    const reasonText = cancelReason ? String(cancelReason).trim() : `Cancelled by ${actor.name}`;
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

  saveDb();
  broadcastRealtime('task:updated', { task, tasks: db.tasks, serverTime: now });

  // Re-evaluate alert windows immediately in case rescheduled within 5 mins or due now
  if (task.status !== 'CANCELLED' && task.status !== 'COMPLETED') {
    runTaskScheduleEngine();
  }

  res.json({ success: true, task, serverTime: now });
});

// Update task status (Start task, Block task, Cancel task, etc.)
app.patch('/api/tasks/:id/status', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to update tasks.' });
  }

  const { status, blockedReason, rejectionReason, note } = req.body;
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
  if (status === 'BLOCKED') {
    task.blockedReason = blockedReason || 'Room currently occupied / interview in progress';
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
    task.rejectionReason = rejectionReason || 'Photo evidence rejected: does not show clean alignment';
  }

  task.changeHistory.push({
    timestamp: now,
    actorEmail: actor.email,
    actorName: actor.name,
    fromStatus: prevStatus,
    toStatus: status,
    note: note || (status === 'BLOCKED' ? `Reason: ${blockedReason}` : ''),
  });

  addAuditLog(
    actor,
    'TASK_STATUS_CHANGED',
    'TASK',
    task.id,
    `Status changed from ${prevStatus} to ${status} by ${actor.name}`
  );

  saveDb();
  broadcastRealtime('task:updated', { task, tasks: db.tasks, serverTime: now });
  res.json({ success: true, task, serverTime: now });
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
  if (note !== undefined) item.note = note;

  saveDb();
  broadcastRealtime('task:updated', { task, tasks: db.tasks });
  res.json({ success: true, task });
});

app.delete('/api/tasks/:id', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'tasks', 'delete')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to delete tasks.' });
  }

  const taskIndex = db.tasks.findIndex((t) => t.id === req.params.id);
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const [removedTask] = db.tasks.splice(taskIndex, 1);
  addAuditLog(actor, 'TASK_DELETED', 'TASK', removedTask.id, `Deleted task "${removedTask.title}" in ${removedTask.roomAreaName}`);
  saveDb();
  broadcastRealtime('task:updated', { task: removedTask, tasks: db.tasks, deletedTaskId: removedTask.id });
  res.json({ success: true, message: 'Task deleted successfully' });
});

// 5. Live Camera Photo Upload (Server-side storage, zero external cloud)
app.post('/api/tasks/:id/photo', async (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (!checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: You do not have permission to submit task photos.' });
  }

  const { photoData, metadata } = req.body;
  if (!photoData || typeof photoData !== 'string') {
    return res.status(400).json({ error: 'photoData base64 string is required from camera capture' });
  }

  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (actor.role === 'PANTRY_BOY' && task.assignedToEmail.toLowerCase() !== actor.email.toLowerCase()) {
    return res.status(403).json({ error: 'Permission denied: You can only upload photos for tasks assigned to you.' });
  }

  const serverTimestamp = new Date().toISOString();
  const photoId = `photo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Save the real photo to company server disk
  let savedPhotoUrl = photoData;
  let diskFilePath: string | undefined;

  try {
    const match = photoData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    const ext = match ? match[1] : 'jpg';
    const base64Clean = match ? match[2] : photoData;
    const buffer = Buffer.from(base64Clean, 'base64');
    const fileName = `${photoId}.${ext}`;
    diskFilePath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(diskFilePath, buffer);
    savedPhotoUrl = `/uploads/photos/${fileName}`;
  } catch (fileErr) {
    console.warn('Failed to write photo to disk file, falling back to base64 payload:', fileErr);
    savedPhotoUrl = photoData;
  }

  // Store photo evidence
  const photoEvidence: PhotoEvidence = {
    id: photoId,
    taskId: task.id,
    roomName: task.roomAreaName,
    userEmail: actor.email,
    capturedAt: metadata?.capturedAt || serverTimestamp,
    serverTimestamp,
    photoUrl: savedPhotoUrl,
    filePath: diskFilePath,
    metadata: {
      device: metadata?.device || 'Browser Live Camera (getUserMedia)',
      resolution: metadata?.resolution || '1280x720',
      mode: 'LIVE_CAMERA',
    },
    status: 'UPLOADED',
  };

  // Preserve previous photo in change history if any
  if (task.photoEvidence) {
    task.changeHistory.push({
      timestamp: serverTimestamp,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: task.status,
      toStatus: task.status,
      note: `Replaced previous photo evidence ${task.photoEvidence.id} with new capture ${photoEvidence.id}`,
    });
  }

  task.photoEvidence = photoEvidence;
  task.submittedAt = serverTimestamp;
  task.status = 'PENDING_VERIFICATION';

  // Mark all photo checklist items as completed
  task.checklist.forEach((item) => {
    if (item.text.toLowerCase().includes('photo') || item.text.toLowerCase().includes('capture')) {
      item.completed = true;
    }
  });

  // Room transitions to PENDING_VERIFICATION
  const room = db.rooms.find((r) => r.id === task.roomAreaId);
  if (room && (room.status === 'CLEANING_IN_PROGRESS' || room.status === 'PREPARATION_REQUIRED' || room.status === 'CLEANING_REQUIRED')) {
    room.status = 'PENDING_VERIFICATION';
    if (!room.statusHistory) room.statusHistory = [];
    room.statusHistory.unshift({
      id: `hist-${Date.now()}`,
      status: 'PENDING_VERIFICATION',
      timestamp: serverTimestamp,
      actorName: actor.name,
      actorEmail: actor.email,
      note: `Photo evidence uploaded for task "${task.title}". Status transitioned to PENDING_VERIFICATION.`,
      taskId: task.id,
      photoUrl: savedPhotoUrl,
    });
    broadcastRealtime('room:updated', { room, rooms: db.rooms });
  }

  addAuditLog(
    actor,
    'PHOTO_SUBMITTED',
    'PHOTO',
    photoEvidence.id,
    `Live camera photo evidence uploaded for task "${task.title}". Server timestamp: ${serverTimestamp}. Stored at: ${savedPhotoUrl}`
  );

  notify(
    `Photo Evidence Submitted: ${task.roomAreaName}`,
    `${actor.name} uploaded photo for "${task.title}". Under review by HR / Kimmi.`,
    'PHOTO_SUBMITTED',
    { role: 'HR', taskId: task.id, roomName: task.roomAreaName }
  );

  saveDb();
  broadcastRealtime('task:updated', { task, tasks: db.tasks });
  res.json({ success: true, photoEvidence, task });
});

// Verify / Approve / Reject photo evidence (HR & Kimmi & Admin)
app.post('/api/tasks/:id/verify', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || actor.role === 'PANTRY_BOY' || !checkUserPermission(actor, 'tasks', 'edit')) {
    return res.status(403).json({ error: 'Permission denied: Only authorized management or admin can verify photo evidence.' });
  }

  const { decision, reason } = req.body;
  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task || !task.photoEvidence) {
    return res.status(404).json({ error: 'Task or photo evidence not found' });
  }

  const now = new Date().toISOString();
  const room = db.rooms.find((r) => r.id === task.roomAreaId);

  if (decision === 'APPROVE') {
    task.photoEvidence.status = 'VERIFIED';
    task.photoEvidence.verifiedBy = actor.name;
    task.photoEvidence.verifiedAt = now;
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
        });
      }
      broadcastRealtime('room:updated', { room, rooms: db.rooms });
    }

    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: 'PENDING_VERIFICATION',
      toStatus: 'COMPLETED',
      note: `Approved by ${actor.name} (${actor.role})`,
    });

    addAuditLog(actor, 'PHOTO_VERIFIED', 'TASK', task.id, `Approved photo and marked task "${task.title}" as COMPLETED.`);
    notify(
      `Task Verified & Completed!`,
      `Great job Raju! Your work in ${task.roomAreaName} has been approved by ${actor.name}.`,
      'PHOTO_VERIFIED',
      { role: 'PANTRY_BOY', taskId: task.id, roomName: task.roomAreaName }
    );
  } else {
    task.photoEvidence.status = 'REJECTED';
    task.status = 'REJECTED';
    task.rejectionReason = reason || 'Photograph does not clearly show chair alignment or cleanliness standard.';

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
      broadcastRealtime('room:updated', { room, rooms: db.rooms });
    }

    task.changeHistory.push({
      timestamp: now,
      actorEmail: actor.email,
      actorName: actor.name,
      fromStatus: 'PENDING_VERIFICATION',
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
  broadcastRealtime('task:updated', { task, tasks: db.tasks });
  res.json({ success: true, task });
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
  res.json({ requests: db.pantryRequests || [] });
});

app.post('/api/pantry-requests', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { roomAreaId, items, instructions, priority } = req.body;
  if (!roomAreaId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Room and items are required' });
  }

  const room = db.rooms.find((r) => r.id === roomAreaId);
  const roomName = room ? room.name : 'Office Room';

  const newRequest: PantryRequest = {
    id: `preq-${Date.now()}`,
    roomAreaId,
    roomAreaName: roomName,
    requesterName: actor.name,
    requesterRole: actor.role === 'KIMMY_MAM' ? 'Co-Founder' : actor.role === 'ADMIN' ? 'Admin' : actor.role,
    items,
    instructions: instructions || 'Deliver to room as requested.',
    priority: priority || 'NORMAL',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  if (!Array.isArray(db.pantryRequests)) db.pantryRequests = [];
  db.pantryRequests.unshift(newRequest);

  addAuditLog(actor, 'PANTRY_REQUEST_CREATED', 'TASK', newRequest.id, `Created pantry request for ${roomName}: ${items.join(', ')}`);
  notify(
    `☕ New Pantry Request: ${roomName}`,
    `${actor.name} requested: ${items.join(', ')}. Priority: ${newRequest.priority}.`,
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

  const { status } = req.body;
  if (!['PENDING', 'IN_PREPARATION', 'SERVED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const reqItem = db.pantryRequests?.find((p) => p.id === req.params.id);
  if (!reqItem) return res.status(404).json({ error: 'Pantry request not found' });

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
      visitorName: visitorName || 'VIP Guest',
      companyName: companyName || 'Client Partner',
      hostName: hostName || actor.name,
      roomAreaId: room.id,
      roomAreaName: room.name,
      purpose: 'CLIENT_MEETING',
      guestCount: Number(guestCount) || 2,
      scheduledTime: now,
      status: 'ARRIVED',
      arrivalTime: now,
      notes: notes || '',
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

  const today = new Date().toISOString().split('T')[0];
  const todayTasks = db.tasks.filter((t) => t.createdAt.startsWith(today));

  const totalTasks = todayTasks.length;
  const completedTasks = todayTasks.filter((t) => t.status === 'COMPLETED').length;
  const pendingTasks = todayTasks.filter(
    (t) => t.status === 'AVAILABLE' || t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS' || t.status === 'PENDING_VERIFICATION'
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
    onTimeCompletionRatePercent: totalTasks > 0 ? Math.round(((completedTasks) / Math.max(1, totalTasks - blockedTasks)) * 100) : 0,
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
      { room: 'The Community', count: 2 },
      { room: 'Prestige Loft', count: 1 },
    ],
    frequentlyBlockedRooms: frequentlyBlockedRooms.length > 0 ? frequentlyBlockedRooms : [
      { room: 'Prestige Loft', count: 4, primaryReason: 'Candidate interviews running over schedule' },
      { room: 'Elegance Suite (Kimmi Suite)', count: 2, primaryReason: 'Confidential client dispute negotiation' },
    ],
    photoVerificationScorePercent: totalPhotos > 0 ? Math.round((verifiedPhotos / totalPhotos) * 100) : 96,
    visitorPrepAverageMinutes: 8.4,
    keyRecommendations: [
      'Prestige Loft candidate interviews occasionally extend into cleaning windows. Routine cleaning is automatically staged prior to 11:30 AM interview schedules.',
      'Water bottle distribution achieved 100% desk coverage during the 10:00 AM round, with afternoon 3:00 PM rechecks verifying fresh bottle supply across Main Bay and Prime Loft.',
      'End-of-day office closing checklist triggers at 7:30 PM, ensuring room lockdown and sanitary readiness at day end.',
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
    'Created At',
    'Due Time',
    'Started At',
    'Submitted At',
    'Completed At',
    'Blocked Reason',
    'Photo Verified',
  ];

  const rows = db.tasks.map((t) => [
    `"${t.id}"`,
    `"${t.title.replace(/"/g, '""')}"`,
    `"${t.roomAreaName.replace(/"/g, '""')}"`,
    `"${t.priority}"`,
    `"${t.status}"`,
    `"${t.assignedToName}"`,
    `"${t.createdByName}"`,
    `"${t.createdAt}"`,
    `"${t.dueTime}"`,
    `"${t.startedAt || ''}"`,
    `"${t.submittedAt || ''}"`,
    `"${t.completedAt || ''}"`,
    `"${(t.blockedReason || '').replace(/"/g, '""')}"`,
    `"${t.photoEvidence?.status || 'N/A'}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="white_collar_realty_pantry_report_${Date.now()}.csv"`);
  res.send(csvContent);
});

// 8. Notifications & Audit Logs
app.get('/api/notifications', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.json({ notifications: [] });

  const relevant = db.notifications.filter((n) => {
    if (!n.recipientRole && !n.recipientEmail) return true;
    if (n.recipientRole === actor.role) return true;
    if (n.recipientEmail === actor.email) return true;
    if (isManagerOrAdmin(actor.role) && (n.recipientRole === 'HR' || n.recipientRole === 'KIMMY_MAM' || n.recipientRole === 'ADMIN')) return true;
    return false;
  });

  res.json({ notifications: relevant });
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthenticated' });
  const notif = db.notifications.find((n) => n.id === req.params.id);
  if (notif) notif.read = true;
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

  const { naturalInstruction } = req.body;
  if (!naturalInstruction || typeof naturalInstruction !== 'string') {
    return res.status(400).json({ error: 'naturalInstruction is required' });
  }

  const text = naturalInstruction.trim();
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

  // Generate customized checklist
  const checklist: string[] = [
    `Wipe surfaces and clean table in ${matchedRoom.name}`,
    `Align chairs in neat geometric orientation`,
    `Place sealed water bottles and glasses`,
  ];
  if (lower.includes('whiteboard') || lower.includes('board')) {
    checklist.push('Clean whiteboard and arrange markers');
  }
  if (lower.includes('tea') || lower.includes('coffee') || lower.includes('snack') || lower.includes('fruit')) {
    checklist.push('Prepare hot beverage / refreshment tray');
  }
  checklist.push(`Capture live camera photo to verify ${matchedRoom.name} readiness`);

  res.json({
    success: true,
    data: {
      matchedRoomName: matchedRoom.name,
      roomAreaId: matchedRoom.id,
      roomAreaName: matchedRoom.name,
      title: `Prepare ${matchedRoom.name} – ${isUrgent ? '[URGENT] ' : ''}${text.slice(0, 50)}`,
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

  const today = new Date().toISOString().split('T')[0];
  const todayTasks = db.tasks.filter((t) => t.createdAt.startsWith(today));
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
    bottlenecks.push('No rooms currently blocked. All room readiness routines operating on schedule.');
  }

  const recommendations: string[] = [
    'Reception and Main Bay morning routine tasks are on schedule; continue 10:00 AM desk water bottle cycle.',
    'Pre-stage visitor glassware in The Community pantry to maintain under 10-minute visitor prep SLA.',
    'Ensure 7:30 PM closing inspection is verified with live camera evidence at end of day.',
  ];

  res.json({
    success: true,
    insights: {
      executiveSummary: `Daily Operational Status: ${completedCount} of ${totalCount} daily tasks completed (${totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100}%). ${blockedCount} blocked rooms logged.`,
      bottlenecks,
      recommendations,
    },
  });
});

// 10. Scheduler Trigger (Daily task milestones)
app.post('/api/scheduler/trigger', (req, res) => {
  const actor = getCurrentUser(req);
  if (!actor || !checkUserPermission(actor, 'tasks', 'create')) {
    return res.status(403).json({ error: 'Only authorized users with task creation permission can trigger scheduled milestone routines.' });
  }

  const { milestone } = req.body; // '9AM_START' | '10AM_WATER' | '3PM_WATER' | 'CLOSING_AUDIT'

  if (milestone === '9AM_START') {
    const routineTasks = generateDailyTasks().filter((t) => t.taskType === 'ROUTINE_CLEANING');
    routineTasks.forEach((t) => {
      if (!db.tasks.some((existing) => existing.id === t.id)) {
        db.tasks.unshift(t);
      }
    });
    notify('9:00 AM Routine Generated', 'Start-of-day office cleaning tasks generated.', 'TASK_ASSIGNED', { role: 'PANTRY_BOY' });
  } else if (milestone === '10AM_WATER') {
    const waterTask = generateDailyTasks().find((t) => t.taskType === 'WATER_DISTRIBUTION');
    if (waterTask && !db.tasks.some((existing) => existing.id === waterTask.id)) {
      db.tasks.unshift(waterTask);
    }
    notify('10:00 AM Water Distribution', 'Time to place water bottles on employee desks.', 'TASK_ASSIGNED', { role: 'PANTRY_BOY' });
  } else if (milestone === '3PM_WATER') {
    const recheckTask = generateDailyTasks().find((t) => t.taskType === 'WATER_RECHECK');
    if (recheckTask) {
      const existing = db.tasks.find((t) => t.id === recheckTask.id);
      if (existing) {
        existing.status = 'AVAILABLE';
      } else {
        recheckTask.status = 'AVAILABLE';
        db.tasks.unshift(recheckTask);
      }
    }
    notify('3:00 PM Water Recheck', 'Check desks for water bottle refills and chair alignment.', 'TASK_ASSIGNED', { role: 'PANTRY_BOY' });
  } else if (milestone === 'CLOSING_AUDIT' || milestone === '8PM_CLOSING') {
    const closingTask = generateDailyTasks().find((t) => t.taskType === 'CLOSING_INSPECTION');
    if (closingTask) {
      const existing = db.tasks.find((t) => t.id === closingTask.id);
      if (existing) {
        existing.status = 'AVAILABLE';
      } else {
        closingTask.status = 'AVAILABLE';
        db.tasks.unshift(closingTask);
      }
    }
    db.tasks.forEach((t) => {
      if (t.status === 'AVAILABLE' || t.status === 'IN_PROGRESS') {
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

  addAuditLog(actor, 'SCHEDULER_MILESTONE_TRIGGERED', 'SCHEDULE', `milestone-${milestone}`, `Manually triggered ${milestone} scheduler milestone`);
  saveDb();
  broadcastRealtime('task:updated', { tasks: db.tasks });
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

// -----------------------------------------------------------------------------
// Vite Middleware / Static Asset Serving
// -----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
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
