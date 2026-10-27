import type {
  UserAccount,
  RoomArea,
  RoomStatus,
  RoomAssignment,
  RoomStatusHistoryEntry,
  PhotoEvidence,
  Task,
  VisitorEvent,
  AuditLog,
  AppNotification,
  DailyReportSummary,
  WeeklyReportSummary,
  TaskPriority,
  TaskStatus,
  PantryRequest,
  AttendanceRecord,
} from '../types/index.ts';
import {
  normalizeDisplayText,
  normalizeRoomName,
  normalizeRoomRecord,
  normalizeTaskRecord,
} from '../utils/textNormalizer.ts';

const BASE_URL = '/api';
const TOKEN_KEY = 'wcr_auth_session_token';

export const getSessionToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setSessionToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
};

export const clearSessionToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.clear();
  } catch {}
};

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = getSessionToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }
  return headers;
}

// Authoritative Backend Server Clock Offset (serverNowMs - clientNowMs)
let serverTimeOffsetMs = 0;

export const syncServerTime = (serverIso?: string): void => {
  if (!serverIso) return;
  const parsedMs = new Date(serverIso).getTime();
  if (!Number.isNaN(parsedMs)) {
    serverTimeOffsetMs = parsedMs - Date.now();
  }
};

export const getServerNowMs = (): number => Date.now() + serverTimeOffsetMs;
export const getServerDate = (): Date => new Date(getServerNowMs());

export const api = {
  // Auth
  async getCurrentUser(): Promise<UserAccount | null> {
    const token = getSessionToken();
    if (!token) return null;

    try {
      const res = await fetch(`${BASE_URL}/auth/current`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        clearSessionToken();
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data.user || null;
    } catch {
      return null;
    }
  },

  async login(email: string, password?: string): Promise<{ user: UserAccount; token: string; attendance?: AttendanceRecord }> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    if (data.token) {
      setSessionToken(data.token);
    }
    return data;
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
      });
    } catch (e) {
      console.warn('Server logout call failed:', e);
    } finally {
      clearSessionToken();
    }
  },

  async switchUser(userId: string): Promise<{ user: UserAccount; token: string; attendance?: AttendanceRecord }> {
    const res = await fetch(`${BASE_URL}/auth/switch-user`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to switch user');
    }
    const data = await res.json();
    if (data.token) {
      setSessionToken(data.token);
    }
    return data;
  },

  // Users
  async getUsers(): Promise<UserAccount[]> {
    const res = await fetch(`${BASE_URL}/users`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch users');
    const data = await res.json();
    return data.users;
  },

  async toggleUserStatus(userId: string): Promise<UserAccount> {
    const res = await fetch(`${BASE_URL}/users/${userId}/toggle-status`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update user status');
    }
    const data = await res.json();
    return data.user;
  },

  async createUser(payload: {
    name: string;
    email: string;
    role: string;
    department?: string;
    phone?: string;
  }): Promise<UserAccount> {
    const res = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create user');
    }
    const data = await res.json();
    return data.user;
  },

  async updateUser(userId: string, payload: Partial<UserAccount>): Promise<UserAccount> {
    const res = await fetch(`${BASE_URL}/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update user');
    }
    const data = await res.json();
    return data.user;
  },

  async deleteUser(userId: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete user');
    }
  },

  // Rooms
  async getRooms(): Promise<RoomArea[]> {
    const res = await fetch(`${BASE_URL}/rooms`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch rooms');
    const data = await res.json();
    return Array.isArray(data.rooms) ? data.rooms.map((r: RoomArea) => normalizeRoomRecord(r)) : [];
  },

  async addRoom(payload: Partial<RoomArea>): Promise<RoomArea> {
    const cleanedPayload = {
      ...payload,
      name: payload.name !== undefined ? normalizeRoomName(payload.name) : payload.name,
    };
    const res = await fetch(`${BASE_URL}/rooms`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cleanedPayload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add room');
    }
    const data = await res.json();
    return normalizeRoomRecord(data.room);
  },

  async updateRoom(id: string, payload: Partial<RoomArea>): Promise<RoomArea> {
    const cleanedPayload = {
      ...payload,
      name: payload.name !== undefined ? normalizeRoomName(payload.name) : payload.name,
    };
    const res = await fetch(`${BASE_URL}/rooms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cleanedPayload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update room');
    }
    const data = await res.json();
    return normalizeRoomRecord(data.room);
  },

  async toggleRoomActive(id: string): Promise<RoomArea> {
    const res = await fetch(`${BASE_URL}/rooms/${encodeURIComponent(id)}/toggle-active`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to toggle room active state');
    }
    const data = await res.json();
    return normalizeRoomRecord(data.room);
  },

  async assignRoom(
    id: string,
    payload: {
      visitorName: string;
      reference?: string;
      expectedArrival?: string;
      expectedDuration?: string;
      prepRequirements?: string[];
      waterRequirements?: string;
      priority?: TaskPriority;
      instructions?: string;
      forceOverride?: boolean;
    }
  ): Promise<{ room: RoomArea; assignment: RoomAssignment; prepTask: Task }> {
    const res = await fetch(`${BASE_URL}/rooms/${id}/assign`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorObj: any = new Error(err.error || 'Failed to assign room');
      errorObj.code = err.code;
      errorObj.availableRooms = err.availableRooms;
      errorObj.currentStatus = err.currentStatus;
      throw errorObj;
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
      prepTask: data.prepTask ? normalizeTaskRecord(data.prepTask) : data.prepTask,
    };
  },

  async assignRoomEmployee(
    id: string,
    payload: {
      employeeId: string;
      notes?: string;
      forceOverride?: boolean;
    }
  ): Promise<{ room: RoomArea; assignment: RoomAssignment }> {
    const res = await fetch(`${BASE_URL}/rooms/${encodeURIComponent(id)}/assign-employee`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errorObj: any = new Error(err.error || 'Failed to assign room to employee');
      errorObj.code = err.code;
      errorObj.conflictingRoom = err.conflictingRoom;
      errorObj.currentAssignedEmployee = err.currentAssignedEmployee;
      errorObj.employee = err.employee;
      throw errorObj;
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
    };
  },

  async unassignRoomEmployee(id: string): Promise<{ room: RoomArea }> {
    const res = await fetch(`${BASE_URL}/rooms/${encodeURIComponent(id)}/unassign-employee`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to unassign room');
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
    };
  },

  async roomStatusAction(
    id: string,
    action: 'MARK_OCCUPIED' | 'MARK_READY' | 'RELEASE_VACANT' | 'MARK_VACANT' | 'REQUEST_CLEANING' | 'REOPEN',
    note?: string,
    idempotencyKey?: string
  ): Promise<{ room: RoomArea; task?: Task; transition?: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${BASE_URL}/rooms/${id}/status-action`, {
      method: 'POST',
      headers: getAuthHeaders(headers),
      body: JSON.stringify({ action, note, idempotencyKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to execute ${action}`);
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
      task: data.task ? normalizeTaskRecord(data.task) : undefined,
    };
  },

  async updateRoomStatus(
    id: string,
    status: RoomStatus,
    note?: string,
    idempotencyKey?: string
  ): Promise<{ room: RoomArea; task?: Task; transitionTriggered?: boolean; duplicate?: boolean }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${BASE_URL}/rooms/${id}/status`, {
      method: 'POST',
      headers: getAuthHeaders(headers),
      body: JSON.stringify({ status, note, idempotencyKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to update room status to ${status}`);
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
      task: data.task ? normalizeTaskRecord(data.task) : undefined,
    };
  },

  async getRoomHistory(id: string): Promise<{
    room: RoomArea;
    statusHistory: RoomStatusHistoryEntry[];
    assignmentHistory: RoomAssignment[];
    currentAssignment?: RoomAssignment | null;
    photos?: PhotoEvidence[];
  }> {
    const res = await fetch(`${BASE_URL}/rooms/${id}/history`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch room history');
    }
    const data = await res.json();
    return {
      ...data,
      room: data.room ? normalizeRoomRecord(data.room) : data.room,
    };
  },

  // Tasks
  async getServerTime(): Promise<{ serverTime: string; timezone: string }> {
    const res = await fetch(`${BASE_URL}/server-time`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch server time');
    const data = await res.json();
    syncServerTime(data.serverTime);
    return data;
  },

  async getTasks(params?: {
    status?: string;
    priority?: string;
    roomAreaId?: string;
    assignedTo?: string;
  }): Promise<Task[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.priority) query.set('priority', params.priority);
    if (params?.roomAreaId) query.set('roomAreaId', params.roomAreaId);
    if (params?.assignedTo) query.set('assignedTo', params.assignedTo);

    const res = await fetch(`${BASE_URL}/tasks?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch tasks');
    const data = await res.json();
    if (data.serverTime) {
      syncServerTime(data.serverTime);
    }
    return Array.isArray(data.tasks) ? data.tasks.map((t: Task) => normalizeTaskRecord(t)) : [];
  },

  async createTask(payload: {
    title: string;
    roomAreaId: string;
    priority?: TaskPriority;
    scheduledFor?: string;
    dueTime?: string;
    assignedToEmail?: string;
    description?: string;
    checklist?: string[];
    isUrgent?: boolean;
  }): Promise<Task> {
    const cleanedPayload = {
      ...payload,
      title: normalizeDisplayText(payload.title),
      description: payload.description !== undefined ? normalizeDisplayText(payload.description) : undefined,
      dueTime: payload.dueTime !== undefined ? normalizeDisplayText(payload.dueTime) : undefined,
      checklist: Array.isArray(payload.checklist)
        ? payload.checklist.map((item) => normalizeDisplayText(item))
        : undefined,
    };
    const res = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cleanedPayload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create task');
    }
    const data = await res.json();
    if (data.serverTime) {
      syncServerTime(data.serverTime);
    }
    return normalizeTaskRecord(data.task);
  },

  async updateTask(
    taskId: string,
    payload: {
      title?: string;
      description?: string;
      roomAreaId?: string;
      priority?: TaskPriority;
      isUrgent?: boolean;
      scheduledFor?: string;
      dueTime?: string;
      assignedToEmail?: string;
      status?: TaskStatus;
      checklist?: string[];
      cancelReason?: string;
    }
  ): Promise<Task> {
    const cleanedPayload = {
      ...payload,
      title: payload.title !== undefined ? normalizeDisplayText(payload.title) : undefined,
      description: payload.description !== undefined ? normalizeDisplayText(payload.description) : undefined,
      dueTime: payload.dueTime !== undefined ? normalizeDisplayText(payload.dueTime) : undefined,
      checklist: Array.isArray(payload.checklist)
        ? payload.checklist.map((item) => normalizeDisplayText(item))
        : undefined,
    };
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cleanedPayload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update task');
    }
    const data = await res.json();
    if (data.serverTime) {
      syncServerTime(data.serverTime);
    }
    return normalizeTaskRecord(data.task);
  },

  async cancelTask(taskId: string, reason?: string): Promise<Task> {
    return this.updateTask(taskId, {
      status: 'CANCELLED',
      cancelReason: reason || 'Cancelled by authorized management',
    });
  },

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    extra?: { blockedReason?: string; rejectionReason?: string; note?: string }
  ): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update task status');
    }
    const data = await res.json();
    if (data.serverTime) {
      syncServerTime(data.serverTime);
    }
    return normalizeTaskRecord(data.task);
  },

  async updateChecklistItem(taskId: string, itemId: string, completed: boolean, note?: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/checklist`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ itemId, completed, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update checklist item');
    }
    const data = await res.json();
    return normalizeTaskRecord(data.task);
  },

  async uploadPhotoEvidence(
    taskId: string,
    photoData: string,
    metadata?: { device?: string; resolution?: string; mode?: string }
  ): Promise<{ task: Task; photoEvidence: any }> {
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/photo`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ photoData, metadata }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload photo evidence');
    }
    const data = await res.json();
    return {
      ...data,
      task: data.task ? normalizeTaskRecord(data.task) : data.task,
    };
  },

  async verifyPhotoEvidence(taskId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/verify`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ decision, reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to verify photo evidence');
    }
    const data = await res.json();
    return normalizeTaskRecord(data.task);
  },

  async deleteTask(taskId: string): Promise<{ success: boolean; deletedTaskId: string }> {
    const cleanId = String(taskId || '').trim();
    if (!cleanId) {
      throw new Error('Invalid task ID');
    }
    const res = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(cleanId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      throw new Error(data.error || `Failed to delete task (HTTP ${res.status})`);
    }
    if (data.serverTime) {
      syncServerTime(data.serverTime);
    }
    return {
      success: true,
      deletedTaskId: data.deletedTaskId || cleanId,
    };
  },

  // Pantry Requests
  async getPantryRequests(): Promise<PantryRequest[]> {
    const res = await fetch(`${BASE_URL}/pantry-requests`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.requests)
      ? data.requests.map((r: PantryRequest) => ({
          ...r,
          roomAreaName: normalizeRoomName(r.roomAreaName),
          instructions: normalizeDisplayText(r.instructions),
        }))
      : [];
  },

  async createPantryRequest(payload: {
    roomAreaId: string;
    items: string[];
    instructions: string;
    priority?: 'URGENT' | 'HIGH' | 'NORMAL';
  }): Promise<PantryRequest> {
    const res = await fetch(`${BASE_URL}/pantry-requests`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create pantry request');
    }
    const data = await res.json();
    return data.request
      ? {
          ...data.request,
          roomAreaName: normalizeRoomName(data.request.roomAreaName),
        }
      : data.request;
  },

  async updatePantryRequestStatus(
    requestId: string,
    status: 'PENDING' | 'IN_PREPARATION' | 'SERVED' | 'CANCELLED'
  ): Promise<PantryRequest> {
    const res = await fetch(`${BASE_URL}/pantry-requests/${requestId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update pantry request status');
    }
    const data = await res.json();
    return data.request
      ? {
          ...data.request,
          roomAreaName: normalizeRoomName(data.request.roomAreaName),
        }
      : data.request;
  },

  // Visitors
  async getVisitors(): Promise<VisitorEvent[]> {
    const res = await fetch(`${BASE_URL}/visitors`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch visitors');
    const data = await res.json();
    return Array.isArray(data.visitors)
      ? data.visitors.map((v: VisitorEvent) => ({
          ...v,
          roomAreaName: normalizeRoomName(v.roomAreaName),
        }))
      : [];
  },

  async registerVisitorArrival(payload: {
    visitorId?: string;
    visitorName?: string;
    companyName?: string;
    hostName?: string;
    roomAreaId?: string;
    guestCount?: number;
    notes?: string;
  }): Promise<{ visitor: VisitorEvent; prepTask: Task }> {
    const res = await fetch(`${BASE_URL}/visitors/arrival`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to register arrival');
    }
    return res.json();
  },

  async registerVisitorDeparture(visitorId: string): Promise<{ visitor: VisitorEvent; resetTask: Task }> {
    const res = await fetch(`${BASE_URL}/visitors/departure`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ visitorId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to register departure');
    }
    return res.json();
  },

  // Reports
  async getDailyReport(): Promise<{ summary: DailyReportSummary; tasks: Task[] }> {
    const res = await fetch(`${BASE_URL}/reports/daily`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch daily report');
    const data = await res.json();
    return {
      summary: data.summary,
      tasks: Array.isArray(data.tasks) ? data.tasks.map((t: Task) => normalizeTaskRecord(t)) : [],
    };
  },

  async getWeeklyReport(): Promise<{ weeklySummary: WeeklyReportSummary }> {
    const res = await fetch(`${BASE_URL}/reports/weekly`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch weekly report');
    return res.json();
  },

  getReportExportUrl(): string {
    const token = getSessionToken();
    return token ? `${BASE_URL}/reports/export?token=${encodeURIComponent(token)}` : `${BASE_URL}/reports/export`;
  },

  // Notifications & Audit
  async getNotifications(): Promise<AppNotification[]> {
    const res = await fetch(`${BASE_URL}/notifications`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.notifications;
  },

  async markNotificationRead(id: string): Promise<void> {
    await fetch(`${BASE_URL}/notifications/${id}/read`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
  },

  async getAuditLogs(): Promise<AuditLog[]> {
    try {
      const res = await fetch(`${BASE_URL}/audit`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data.auditLogs) ? data.auditLogs : [];
    } catch {
      return [];
    }
  },

  // AI features
  async parseNaturalLanguageTask(instruction: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/ai/parse-task`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ naturalInstruction: instruction }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to parse instruction');
    }
    const data = await res.json();
    return data.data;
  },

  async getAiOperationalInsights(): Promise<any> {
    const res = await fetch(`${BASE_URL}/ai/operational-insights`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to get operational insights');
    const data = await res.json();
    return data.insights;
  },

  // Scheduler simulation
  async triggerSchedulerMilestone(
    milestone: '9AM_START' | '10AM_WATER' | '12PM_PLANTS' | '4PM_WATER' | '3PM_WATER' | 'CLOSING_AUDIT'
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/scheduler/trigger`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ milestone }),
    });
    if (!res.ok) throw new Error('Failed to trigger milestone');
  },

  // Real-time Attendance
  async getTodayAttendance(): Promise<{
    todayRecord: AttendanceRecord | null;
    allTodayRecords: AttendanceRecord[];
  }> {
    const res = await fetch(`${BASE_URL}/attendance/today`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch today attendance');
    return res.json();
  },

  async getAttendanceHistory(): Promise<{
    history: AttendanceRecord[];
  }> {
    const res = await fetch(`${BASE_URL}/attendance/history`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch attendance history');
    return res.json();
  },

  async recordAttendanceLogin(): Promise<AttendanceRecord> {
    const res = await fetch(`${BASE_URL}/attendance/record-login`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to record attendance login');
    }
    const data = await res.json();
    return data.attendance;
  },

  async recordAttendanceLogout(): Promise<AttendanceRecord | null> {
    const res = await fetch(`${BASE_URL}/attendance/record-logout`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.attendance || null;
  },

  // Real-time Event Stream (SSE)
  subscribeRealtime(onEvent: (event: string, payload: any) => void): () => void {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      try {
        const token = getSessionToken();
        const streamUrl = token
          ? `${BASE_URL}/realtime/stream?token=${encodeURIComponent(token)}`
          : `${BASE_URL}/realtime/stream`;
        es = new EventSource(streamUrl);

        const handleMessage = (evtName: string) => (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed?.timestamp) {
              syncServerTime(parsed.timestamp);
            } else if (parsed?.time) {
              syncServerTime(parsed.time);
            } else if (parsed?.payload?.serverTime) {
              syncServerTime(parsed.payload.serverTime);
            }
            const rawPayload = parsed.payload !== undefined ? parsed.payload : parsed;
            if (rawPayload && typeof rawPayload === 'object') {
              if (Array.isArray(rawPayload.tasks)) {
                rawPayload.tasks = rawPayload.tasks.map((t: Task) => normalizeTaskRecord(t));
              }
              if (rawPayload.task && typeof rawPayload.task === 'object') {
                rawPayload.task = normalizeTaskRecord(rawPayload.task);
              }
              if (Array.isArray(rawPayload.rooms)) {
                rawPayload.rooms = rawPayload.rooms.map((r: RoomArea) => normalizeRoomRecord(r));
              }
              if (rawPayload.room && typeof rawPayload.room === 'object') {
                rawPayload.room = normalizeRoomRecord(rawPayload.room);
              }
            }
            onEvent(evtName, rawPayload);
          } catch {}
        };

        es.addEventListener('connected', handleMessage('connected'));
        es.addEventListener('server:time', handleMessage('server:time'));
        es.addEventListener('schedule:alert', handleMessage('schedule:alert'));
        es.addEventListener('room:created', handleMessage('room:created'));
        es.addEventListener('room:updated', handleMessage('room:updated'));
        es.addEventListener('task:created', handleMessage('task:created'));
        es.addEventListener('task:updated', handleMessage('task:updated'));
        es.addEventListener('task:deleted', handleMessage('task:deleted'));
        es.addEventListener('notification:new', handleMessage('notification:new'));
        es.addEventListener('user:updated', handleMessage('user:updated'));
        es.addEventListener('account:revoked', handleMessage('account:revoked'));
        es.addEventListener('pantry_request:created', handleMessage('pantry_request:created'));
        es.addEventListener('pantry_request:updated', handleMessage('pantry_request:updated'));
        es.addEventListener('attendance:updated', handleMessage('attendance:updated'));

        es.onerror = () => {
          if (es) {
            es.close();
            es = null;
          }
          if (!isDisposed) {
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };
      } catch {
        if (!isDisposed) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) {
        es.close();
        es = null;
      }
    };
  },
};
