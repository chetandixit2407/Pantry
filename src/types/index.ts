export type Role = 'PANTRY_BOY' | 'HR' | 'KIMMY_MAM' | 'ADMIN';

export interface UserPermissions {
  dashboards: {
    pantry: boolean;
    management: boolean;
  };
  sidebarItems: {
    // Pantry sidebar items
    dashboard: boolean;
    myTasks: boolean;
    roomSupport: boolean;
    pantryRequests: boolean;
    notifications: boolean;
    taskHistory: boolean;
    myProfile: boolean;
    // Management sidebar items
    overview: boolean;
    tasks: boolean;
    rooms: boolean;
    visitors: boolean;
    reports: boolean;
    users: boolean;
    audit: boolean;
    settings: boolean;
  };
  actions: {
    tasks: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    rooms: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    visitors: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    users: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    reports: { view: boolean; export: boolean };
  };
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  status: 'active' | 'inactive';
  avatarUrl: string;
  phone?: string;
  createdAt: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
  isSuperAdmin?: boolean;
  permissions?: UserPermissions;
}

export interface PantryRequest {
  id: string;
  roomAreaId: string;
  roomAreaName: string;
  requesterName: string;
  requesterRole: string;
  items: string[];
  instructions: string;
  priority: 'URGENT' | 'HIGH' | 'NORMAL';
  status: 'PENDING' | 'IN_PREPARATION' | 'SERVED' | 'CANCELLED';
  createdAt: string;
  servedAt?: string;
  servedBy?: string;
}

export type RoomCategory =
  | 'RECEPTION'
  | 'WORKSTATION'
  | 'EXECUTIVE_CABIN'
  | 'MEETING_SUITE'
  | 'COMMON_AREA'
  | 'FACILITIES';

export type RoomStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'ASSIGNED'
  | 'OCCUPIED'
  | 'PREPARATION_REQUIRED'
  | 'READY_FOR_VISITOR'
  | 'CLEANING_REQUIRED'
  | 'CLEANING_IN_PROGRESS'
  | 'PENDING_VERIFICATION';

export type RoomReadiness = RoomStatus;

export interface RoomAssignment {
  id: string;
  roomAreaId: string;
  roomAreaName: string;
  visitorName: string;
  reference: string;
  expectedArrival: string;
  expectedDuration?: string;
  prepRequirements: string[];
  waterRequirements: string;
  priority: TaskPriority;
  instructions?: string;
  assignedBy: string;
  assignedAt: string;
  prepTaskId?: string;
  resetTaskId?: string;
  releasedAt?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export interface RoomStatusHistoryEntry {
  id: string;
  status: RoomStatus;
  timestamp: string;
  actorName: string;
  actorEmail?: string;
  note?: string;
  taskId?: string;
  photoUrl?: string;
  assignmentId?: string;
}

export interface RoomArea {
  id: string;
  name: string;
  category: RoomCategory;
  defaultPriority: TaskPriority;
  photoRequired: boolean;
  status: RoomStatus;
  defaultChecklist: string[];
  recurrence: 'DAILY' | 'ALTERNATE_DAYS' | 'EVERY_3_DAYS' | 'ON_DEMAND';
  enabled: boolean;
  notes?: string;
  currentAssignment?: RoomAssignment | null;
  assignmentHistory?: RoomAssignment[];
  statusHistory?: RoomStatusHistoryEntry[];
}

export type TaskPriority = 'URGENT' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export type TaskStatus =
  | 'SCHEDULED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'SUBMITTED'
  | 'PENDING_VERIFICATION'
  | 'COMPLETED'
  | 'REJECTED'
  | 'OVERDUE'
  | 'CANCELLED';

export type TaskType =
  | 'ROUTINE_CLEANING'
  | 'WATER_DISTRIBUTION'
  | 'WATER_RECHECK'
  | 'VISITOR_PREP'
  | 'VISITOR_RESET'
  | 'CLOSING_INSPECTION'
  | 'PLANTS'
  | 'OUTER_AREA'
  | 'AD_HOC';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  note?: string;
}

export interface PhotoEvidence {
  id: string;
  taskId: string;
  roomName: string;
  userEmail: string;
  capturedAt: string;
  serverTimestamp: string;
  photoUrl: string;
  filePath?: string;
  metadata?: {
    device?: string;
    resolution?: string;
    mode?: string;
  };
  status: 'UPLOADED' | 'VERIFIED' | 'REJECTED';
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface TaskHistoryEntry {
  timestamp: string;
  actorEmail: string;
  actorName: string;
  fromStatus: string;
  toStatus: string;
  note?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  roomAreaId: string;
  roomAreaName: string;
  priority: TaskPriority;
  taskType: TaskType;
  assignedToEmail: string;
  assignedToName: string;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  scheduledFor: string;
  dueTime: string;
  startedAt?: string;
  submittedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  fiveMinAlertSentFor?: string;
  dueAlertSentFor?: string;
  overdueMarkedFor?: string;
  status: TaskStatus;
  checklist: ChecklistItem[];
  photoEvidence?: PhotoEvidence;
  blockedReason?: string;
  rejectionReason?: string;
  isUrgent: boolean;
  changeHistory: TaskHistoryEntry[];
}

export interface ScheduleAlertPayload {
  alertId: string;
  alertType: 'WARNING_5MIN' | 'TASK_DUE_NOW';
  task: Task;
  scheduledFor: string;
  scheduledTimeIST: string;
  serverTime: string;
}

export interface VisitorEvent {
  id: string;
  visitorName: string;
  companyName: string;
  hostName: string;
  roomAreaId: string;
  roomAreaName: string;
  purpose: 'CLIENT_MEETING' | 'CANDIDATE_INTERVIEW' | 'VENDOR_VISIT' | 'EXECUTIVE_MEETING';
  guestCount: number;
  scheduledTime: string;
  arrivalTime?: string;
  departureTime?: string;
  status: 'EXPECTED' | 'ARRIVED' | 'DEPARTED' | 'CANCELLED';
  prepTaskId?: string;
  resetTaskId?: string;
  notes?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorName: string;
  actorRole: Role;
  action: string;
  entityType: 'TASK' | 'USER' | 'ROOM' | 'VISITOR' | 'PHOTO' | 'REPORT' | 'SCHEDULE';
  entityId: string;
  details: string;
}

export interface AppNotification {
  id: string;
  recipientRole?: Role;
  recipientEmail?: string;
  title: string;
  message: string;
  taskId?: string;
  roomId?: string;
  roomName?: string;
  priority?: TaskPriority;
  type:
    | 'TASK_ASSIGNED'
    | 'TASK_RESCHEDULED'
    | 'TASK_CANCELLED'
    | 'TASK_UPCOMING_WARNING'
    | 'TASK_DUE_NOW'
    | 'URGENT_TASK'
    | 'VISITOR_EVENT'
    | 'TASK_OVERDUE'
    | 'PHOTO_SUBMITTED'
    | 'PHOTO_VERIFIED'
    | 'PHOTO_REJECTED'
    | 'ACCOUNT_STATUS'
    | 'ROOM_READY'
    | 'ROOM_ASSIGNED'
    | 'ROOM_OCCUPIED'
    | 'ROOM_RELEASED'
    | 'ROOM_CLEANING_NEEDED';
  read: boolean;
  timestamp: string;
}

export interface DailyReportSummary {
  date: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  urgentTasks: number;
  completionRatePercent: number;
  onTimeCompletionRatePercent: number;
  waterBottleDistributionCompleted: boolean;
  waterBottleRecheckCompleted: boolean;
  closingChecklistCompleted: boolean;
  blockedExceptions: { taskId: string; room: string; reason: string }[];
  photoFailuresCount: number;
}

export interface WeeklyReportSummary {
  weekPeriod: string;
  totalAssigned: number;
  totalCompleted: number;
  completionRatePercent: number;
  onTimeRatePercent: number;
  frequentlyDelayedRooms: { room: string; count: number }[];
  frequentlyBlockedRooms: { room: string; count: number; primaryReason: string }[];
  photoVerificationScorePercent: number;
  visitorPrepAverageMinutes: number;
  keyRecommendations: string[];
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  role: Role;
  date: string; // YYYY-MM-DD in Asia/Kolkata
  loginTime: string; // ISO string
  loginTimeIST: string; // e.g. "09:00:15 AM"
  logoutTime?: string; // ISO string
  logoutTimeIST?: string;
  status: 'PRESENT' | 'COMPLETED' | 'HALFDAY';
  elapsedMinutes?: number;
  createdAt: string;
  updatedAt: string;
}
