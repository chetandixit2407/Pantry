import type {
  UserAccount,
  RoomArea,
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
} from '../types/index.ts';

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

  async login(email: string, password?: string): Promise<{ user: UserAccount; token: string }> {
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
      });
    } catch (e) {
      console.warn('Server logout call failed:', e);
    } finally {
      clearSessionToken();
    }
  },

  async switchUser(userId: string): Promise<{ user: UserAccount; token: string }> {
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

  // Rooms
  async getRooms(): Promise<RoomArea[]> {
    const res = await fetch(`${BASE_URL}/rooms`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch rooms');
    const data = await res.json();
    return data.rooms;
  },

  async addRoom(payload: Partial<RoomArea>): Promise<RoomArea> {
    const res = await fetch(`${BASE_URL}/rooms`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add room');
    }
    const data = await res.json();
    return data.room;
  },

  async updateRoom(id: string, payload: Partial<RoomArea>): Promise<RoomArea> {
    const res = await fetch(`${BASE_URL}/rooms/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update room');
    }
    const data = await res.json();
    return data.room;
  },

  async toggleRoomActive(id: string): Promise<RoomArea> {
    const res = await fetch(`${BASE_URL}/rooms/${id}/toggle-active`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to toggle room active state');
    }
    const data = await res.json();
    return data.room;
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
    return res.json();
  },

  async roomStatusAction(
    id: string,
    action: 'MARK_OCCUPIED' | 'MARK_READY' | 'RELEASE_VACANT' | 'REQUEST_CLEANING' | 'REOPEN',
    note?: string
  ): Promise<{ room: RoomArea }> {
    const res = await fetch(`${BASE_URL}/rooms/${id}/status-action`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to execute ${action}`);
    }
    return res.json();
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
    return res.json();
  },

  // Tasks
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
    return data.tasks;
  },

  async createTask(payload: {
    title: string;
    roomAreaId: string;
    priority?: TaskPriority;
    dueTime?: string;
    description?: string;
    checklist?: string[];
    isUrgent?: boolean;
  }): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create task');
    }
    const data = await res.json();
    return data.task;
  },

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    extra?: { blockedReason?: string; rejectionReason?: string; note?: string }
  ): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update task status');
    }
    const data = await res.json();
    return data.task;
  },

  async updateChecklistItem(taskId: string, itemId: string, completed: boolean, note?: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/checklist`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ itemId, completed, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update checklist item');
    }
    const data = await res.json();
    return data.task;
  },

  async uploadPhotoEvidence(
    taskId: string,
    photoData: string,
    metadata?: { device?: string; resolution?: string; mode?: string }
  ): Promise<{ task: Task; photoEvidence: any }> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/photo`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ photoData, metadata }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload photo evidence');
    }
    return res.json();
  },

  async verifyPhotoEvidence(taskId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/verify`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ decision, reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to verify photo evidence');
    }
    const data = await res.json();
    return data.task;
  },

  // Visitors
  async getVisitors(): Promise<VisitorEvent[]> {
    const res = await fetch(`${BASE_URL}/visitors`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch visitors');
    const data = await res.json();
    return data.visitors;
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
    return res.json();
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
    const res = await fetch(`${BASE_URL}/audit`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch audit logs');
    const data = await res.json();
    return data.auditLogs;
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
  async triggerSchedulerMilestone(milestone: '9AM_START' | '10AM_WATER' | '3PM_WATER' | '8PM_CLOSING'): Promise<void> {
    const res = await fetch(`${BASE_URL}/scheduler/trigger`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ milestone }),
    });
    if (!res.ok) throw new Error('Failed to trigger milestone');
  },

  // Real-time Event Stream (SSE)
  subscribeRealtime(onEvent: (event: string, payload: any) => void): () => void {
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      try {
        es = new EventSource(`${BASE_URL}/realtime/stream`);

        const handleMessage = (evtName: string) => (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            onEvent(evtName, parsed);
          } catch {}
        };

        es.addEventListener('room:created', handleMessage('room:created'));
        es.addEventListener('room:updated', handleMessage('room:updated'));
        es.addEventListener('task:updated', handleMessage('task:updated'));
        es.addEventListener('notification:new', handleMessage('notification:new'));

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
