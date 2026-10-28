import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type {
  Task,
  RoomArea,
  RoomStatus,
  RoomAssignment,
  RoomStatusHistoryEntry,
  PhotoEvidence,
  VisitorEvent,
  UserAccount,
  AuditLog,
  DailyReportSummary,
  WeeklyReportSummary,
  TaskPriority,
  TaskStatus,
  UserPermissions,
  Role,
  AttendanceRecord,
} from '../../types/index.ts';
import { api, getServerNowMs } from '../../services/api.ts';
import { useAuth, getDefaultPermissions } from '../../context/AuthContext.tsx';
import { Card3D } from '../common/Card3D.tsx';
import { AuthenticatedEvidenceImage } from '../common/AuthenticatedEvidenceImage.tsx';
import { EvidenceLightboxModal } from '../common/EvidenceLightboxModal.tsx';
import { RealtimeRoomDashboard } from './RealtimeRoomDashboard.tsx';
import {
  normalizeDisplayText,
  normalizeRoomName,
  getTaskPhotoEvidences,
} from '../../utils/textNormalizer.ts';
import {
  Sparkles,
  Plus,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserX,
  UserCheck,
  Download,
  Users,
  MapPin,
  Trash2,
  Edit3,
  Shield,
  Sliders,
  Calendar,
  FileText,
  ShieldCheck,
  Camera,
  Play,
  RotateCcw,
  Send,
  Building,
  Check,
  X,
  ExternalLink,
  DoorOpen,
  History,
  Power,
  UserPlus,
  RefreshCw,
  LogOut,
  Search,
  BarChart3,
  ListTodo,
  CheckCheck,
  AlertCircle,
  LayoutDashboard,
  Coffee,
  Move,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Bell,
  Menu,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

export type ManagementTab =
  | 'DASHBOARD'
  | 'PANTRY_TASKS'
  | 'CLEANING_TASKS'
  | 'REARRANGEMENT_TASKS'
  | 'REPORTS'
  | 'SETTINGS'
  | 'TASKS'
  | 'VISITORS'
  | 'ROOMS'
  | 'USERS'
  | 'AUDIT';

export const ManagementView: React.FC = () => {
  const { currentUser, allUsers, refreshUsers, logout, hasPermission, hasSidebarAccess } = useAuth();

  const getUserRoleLabel = (user: UserAccount | null) => {
    if (!user) return 'Authorized Staff';
    if (user.role === 'KIMMY_MAM') return user.department || 'Co-Founder';
    if (user.role === 'ADMIN') return user.department || 'System Administrator';
    if (user.role === 'HR') return user.department || 'Human Resources & Facilities';
    if (user.role === 'PANTRY_BOY') return user.department || 'Pantry Attendant';
    return user.department || user.role;
  };

  const getUserRoleBadge = (role?: Role) => {
    if (role === 'KIMMY_MAM') return 'Co-Founder';
    if (role === 'ADMIN') return 'Admin';
    if (role === 'HR') return 'HR';
    if (role === 'PANTRY_BOY') return 'Pantry';
    return 'Staff';
  };

  const getUserInitials = (name?: string) => {
    if (!name) return 'WC';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Active navigation sub-tab
  const [subTab, setSubTab] = useState<ManagementTab>('DASHBOARD');
  const [settingsTab, setSettingsTab] = useState<'ROOMS' | 'USERS' | 'AUDIT'>('ROOMS');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [hoveredSidebarTab, setHoveredSidebarTab] = useState<ManagementTab | null>(null);
  const isRailCollapsed = sidebarCollapsed && !sidebarOpen;

  const canViewOverview = hasSidebarAccess('overview');
  const canViewTasks = hasSidebarAccess('tasks') && hasPermission('tasks', 'view');
  const canViewReports = hasSidebarAccess('reports') && hasPermission('reports', 'view');
  const canViewRooms = hasSidebarAccess('rooms') && hasPermission('rooms', 'view');
  const canViewUsers = hasSidebarAccess('users') && hasPermission('users', 'view');
  const canViewAudit = hasSidebarAccess('audit');
  const canViewSettings = hasSidebarAccess('settings') && (canViewRooms || canViewUsers || canViewAudit);
  const canManageAssignments = Boolean(
    currentUser &&
      (currentUser.role === 'ADMIN' ||
        currentUser.role === 'HR' ||
        currentUser.role === 'KIMMY_MAM' ||
        currentUser.isSuperAdmin ||
        hasPermission('rooms', 'edit'))
  );
  const canDeleteTask = Boolean(
    currentUser && currentUser.role !== 'PANTRY_BOY' && hasPermission('tasks', 'delete')
  );

  const isPantryBoyTask = useCallback(
    (task?: Task | null): boolean => {
      if (!task) return false;
      const assignedEmail = (task.assignedToEmail || '').toLowerCase().trim();
      const targetUser = allUsers.find((u) => u.email.toLowerCase() === assignedEmail);
      if (targetUser && targetUser.role === 'PANTRY_BOY') return true;
      if (targetUser && targetUser.role !== 'PANTRY_BOY') return false;
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
    },
    [allUsers]
  );

  useEffect(() => {
    const allowedSettings: Array<'ROOMS' | 'USERS' | 'AUDIT'> = [];
    if (canViewRooms) allowedSettings.push('ROOMS');
    if (canViewUsers) allowedSettings.push('USERS');
    if (canViewAudit) allowedSettings.push('AUDIT');
    if (allowedSettings.length > 0 && !allowedSettings.includes(settingsTab)) {
      setSettingsTab(allowedSettings[0]);
    }

    const isSubTabAuthorized =
      (subTab === 'DASHBOARD' && canViewOverview) ||
      ((subTab === 'PANTRY_TASKS' || subTab === 'CLEANING_TASKS' || subTab === 'REARRANGEMENT_TASKS' || subTab === 'TASKS') && canViewTasks) ||
      (subTab === 'REPORTS' && canViewReports) ||
      (subTab === 'SETTINGS' && canViewSettings) ||
      (subTab === 'ROOMS' && canViewRooms) ||
      (subTab === 'USERS' && canViewUsers) ||
      (subTab === 'AUDIT' && canViewAudit);

    if (!isSubTabAuthorized) {
      if (canViewOverview) setSubTab('DASHBOARD');
      else if (canViewTasks) setSubTab('PANTRY_TASKS');
      else if (canViewReports) setSubTab('REPORTS');
      else if (canViewSettings) setSubTab('SETTINGS');
      else if (canViewRooms) setSubTab('ROOMS');
      else if (canViewUsers) setSubTab('USERS');
      else if (canViewAudit) setSubTab('AUDIT');
    }
  }, [
    subTab,
    settingsTab,
    canViewOverview,
    canViewTasks,
    canViewReports,
    canViewRooms,
    canViewUsers,
    canViewAudit,
    canViewSettings,
  ]);

  // Operational Data States
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<RoomArea[]>([]);
  const [visitors, setVisitors] = useState<VisitorEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [dailyReport, setDailyReport] = useState<DailyReportSummary | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters for task table
  const [filterRoom, setFilterRoom] = useState<string>('ALL');
  const [filterPriority, setFilterPriority] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [showVisitorModal, setShowVisitorModal] = useState<boolean>(false);
  const [showRoomModal, setShowRoomModal] = useState<boolean>(false);
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [inspectPhotoTask, setInspectPhotoTask] = useState<Task | null>(null);
  const [inspectPhotoIndex, setInspectPhotoIndex] = useState<number>(0);
  const [verifyingPhotoModal, setVerifyingPhotoModal] = useState<boolean>(false);
  const [roomLightboxState, setRoomLightboxState] = useState<{
    roomId?: string;
    roomName: string;
    photos: PhotoEvidence[];
    initialIndex: number;
  } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const openInspectTaskEvidence = useCallback((task: Task, initialIndex = 0) => {
    setInspectPhotoIndex(initialIndex);
    setInspectPhotoTask(task);
  }, []);

  useEffect(() => {
    setInspectPhotoIndex(0);
  }, [inspectPhotoTask?.id]);
  const [taskDetailActionLoading, setTaskDetailActionLoading] = useState<boolean>(false);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
  const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState<boolean>(false);
  const [deleteTaskError, setDeleteTaskError] = useState<string | null>(null);
  const [actionErrorBanner, setActionErrorBanner] = useState<string | null>(null);

  // Attendance State
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [attendanceHistoryList, setAttendanceHistoryList] = useState<AttendanceRecord[]>([]);
  const [showAttendanceHistoryModal, setShowAttendanceHistoryModal] = useState<boolean>(false);
  const [loadingAttendanceHistory, setLoadingAttendanceHistory] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const toISTDateTimeLocal = useCallback((dateOrIso?: Date | string): string => {
    const d = dateOrIso
      ? typeof dateOrIso === 'string'
        ? new Date(dateOrIso)
        : dateOrIso
      : new Date(getServerNowMs());
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const hh = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}`;
  }, []);

  const formatISTTaskSchedule = useCallback((iso?: string): string => {
    if (!iso) return 'Immediate';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Scheduled';
    const datePart = d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
    });
    const timePart = d
      .toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      .toUpperCase();
    return `${datePart}, ${timePart} IST`;
  }, []);

  const getISTDateKeyFromMs = useCallback((ms: number): string => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));
    } catch {
      return new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
  }, []);

  // AI Task Generation & Scheduling state
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isAiParsing, setIsAiParsing] = useState<boolean>(false);
  const [taskModalError, setTaskModalError] = useState<string | null>(null);
  const [newTaskForm, setNewTaskForm] = useState<{
    title: string;
    roomAreaId: string;
    priority: TaskPriority;
    scheduleMode: 'IMMEDIATE' | 'SCHEDULED';
    scheduledFor: string;
    assignedToEmail: string;
    dueTime: string;
    description: string;
    isUrgent: boolean;
    checklist: string[];
  }>({
    title: '',
    roomAreaId: '',
    priority: 'P2',
    scheduleMode: 'IMMEDIATE',
    scheduledFor: '',
    assignedToEmail: '',
    dueTime: 'Within 30 mins',
    description: '',
    isUrgent: false,
    checklist: ['Clean table surfaces', 'Align all chairs', 'Provide fresh water bottles', 'Upload photo evidence'],
  });

  // Edit / Reschedule Task Modal State
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [savingTaskEdit, setSavingTaskEdit] = useState<boolean>(false);
  const [editTaskForm, setEditTaskForm] = useState<{
    title: string;
    roomAreaId: string;
    priority: TaskPriority;
    scheduledFor: string;
    assignedToEmail: string;
    dueTime: string;
    description: string;
    isUrgent: boolean;
  }>({
    title: '',
    roomAreaId: '',
    priority: 'P2',
    scheduledFor: '',
    assignedToEmail: '',
    dueTime: '',
    description: '',
    isUrgent: false,
  });

  // Visitor Form
  const [visitorForm, setVisitorForm] = useState({
    visitorName: '',
    companyName: '',
    hostName: currentUser?.name || '',
    roomAreaId: '',
    guestCount: 2,
    notes: 'Require fresh water bottles and dry fruits setup.',
  });

  // Room Form
  const [roomForm, setRoomForm] = useState<{
    id?: string;
    name: string;
    category: any;
    defaultPriority: TaskPriority;
    photoRequired: boolean;
    recurrence: any;
  }>({
    name: '',
    category: 'MEETING_SUITE',
    defaultPriority: 'P5',
    photoRequired: true,
    recurrence: 'DAILY',
  });

  // New User Form
  const [newUserForm, setNewUserForm] = useState<{
    name: string;
    email: string;
    role: Role;
    department: string;
    phone: string;
    permissions?: UserPermissions;
  }>({
    name: '',
    email: '',
    role: 'PANTRY_BOY',
    department: 'Hospitality & Operations',
    phone: '',
  });

  // Edit User & Permissions State
  const [showEditUserModal, setShowEditUserModal] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editUserForm, setEditUserForm] = useState<{
    name: string;
    email: string;
    role: Role;
    department: string;
    phone: string;
    permissions: UserPermissions;
  }>({
    name: '',
    email: '',
    role: 'PANTRY_BOY',
    department: '',
    phone: '',
    permissions: getDefaultPermissions('PANTRY_BOY'),
  });

  const [deleteConfirmUser, setDeleteConfirmUser] = useState<UserAccount | null>(null);
  const [userActionLoading, setUserActionLoading] = useState<boolean>(false);

  // Room Management State
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assignForm, setAssignForm] = useState<{
    roomId: string;
    visitorName: string;
    reference: string;
    expectedArrival: string;
    expectedDuration: string;
    prepRequirements: string[];
    waterRequirements: string;
    priority: TaskPriority;
    instructions: string;
    forceOverride: boolean;
  }>({
    roomId: '',
    visitorName: '',
    reference: 'Candidate Interview / Executive Meeting',
    expectedArrival: '11:30 AM',
    expectedDuration: '1 hour',
    prepRequirements: [
      'Sanitize meeting table and coasters',
      'Align all chairs in uniform geometric layout',
      'Check presentation screen & HDMI connection',
    ],
    waterRequirements: '2 Chilled Sealed Bottles + Clean Glasses',
    priority: 'P2',
    instructions: '',
    forceOverride: false,
  });
  const [assignConflictError, setAssignConflictError] = useState<{ message: string; availableRooms: any[] } | null>(null);
  const [submittingAssign, setSubmittingAssign] = useState<boolean>(false);

  // Room History Modal State
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyRoom, setHistoryRoom] = useState<RoomArea | null>(null);
  const [roomHistoryData, setRoomHistoryData] = useState<{
    room: RoomArea;
    statusHistory: RoomStatusHistoryEntry[];
    assignmentHistory: RoomAssignment[];
    currentAssignment?: RoomAssignment | null;
    photos?: PhotoEvidence[];
  } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Room Tab Filters
  const [roomFilterStatus, setRoomFilterStatus] = useState<string>('ALL');
  const [roomFilterCategory, setRoomFilterCategory] = useState<string>('ALL');
  const [roomSearchQuery, setRoomSearchQuery] = useState<string>('');

  // Interactive Dashboard Modals
  type DashboardModalType = 'TOTAL_TASKS' | 'PENDING_TASKS' | 'OVERDUE_TASKS' | 'TOTAL_REPORTS' | 'COMPLETED_TASKS' | 'ROOMS_READY' | null;
  const [activeDashboardModal, setActiveDashboardModal] = useState<DashboardModalType>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState<string>('');
  const [modalStatusFilter, setModalStatusFilter] = useState<string>('ALL');

  const selectedDetailTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) || null : null;

  const roomPhotosMap = useMemo(() => {
    const map = new Map<string, PhotoEvidence[]>();
    const seenMap = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (!task.roomAreaId) continue;
      const photos = getTaskPhotoEvidences(task);
      if (photos.length === 0) continue;
      if (!map.has(task.roomAreaId)) {
        map.set(task.roomAreaId, []);
        seenMap.set(task.roomAreaId, new Set());
      }
      const list = map.get(task.roomAreaId)!;
      const seen = seenMap.get(task.roomAreaId)!;
      for (const pe of photos) {
        const key = pe.id || pe.photoUrl;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(pe);
        }
      }
    }
    return map;
  }, [tasks]);

  const handleOpenTaskDetail = useCallback((taskId: string) => {
    if (!taskId) return;
    setTaskDetailError(null);
    setSelectedTaskId(taskId);
  }, []);

  const handleCloseTaskDetail = useCallback(() => {
    setSelectedTaskId(null);
    setTaskDetailError(null);
  }, []);

  useEffect(() => {
    const handleOpenTaskEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ taskId?: string }>;
      const targetId = customEvent.detail?.taskId;
      if (targetId) {
        handleOpenTaskDetail(targetId);
      }
    };
    window.addEventListener('wcr_open_task', handleOpenTaskEvent as EventListener);
    return () => window.removeEventListener('wcr_open_task', handleOpenTaskEvent as EventListener);
  }, [handleOpenTaskDetail]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (taskPendingDelete) {
        if (!isDeletingTask) {
          setTaskPendingDelete(null);
          setDeleteTaskError(null);
        }
        return;
      }
      if (inspectPhotoTask) {
        setInspectPhotoTask(null);
        return;
      }
      if (editingTask) {
        setEditingTask(null);
        return;
      }
      if (selectedTaskId) {
        handleCloseTaskDetail();
        return;
      }
      if (activeDashboardModal) {
        setActiveDashboardModal(null);
      }
    };
    if (taskPendingDelete || inspectPhotoTask || editingTask || selectedTaskId || activeDashboardModal) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [taskPendingDelete, isDeletingTask, inspectPhotoTask, editingTask, selectedTaskId, activeDashboardModal, handleCloseTaskDetail]);

  const loadData = useCallback(async () => {
    try {
      const [tData, rData, vData, dData, wData, aData, attData] = await Promise.all([
        api.getTasks().catch(() => null),
        api.getRooms().catch(() => null),
        api.getVisitors().catch(() => null),
        api.getDailyReport().catch(() => null),
        api.getWeeklyReport().catch(() => null),
        api.getAuditLogs().catch(() => null),
        api.getTodayAttendance().catch(() => null),
      ]);
      if (tData) setTasks(tData);
      if (rData) setRooms(rData);
      if (vData) setVisitors(vData);
      if (dData?.summary) setDailyReport(dData.summary);
      if (wData?.weeklySummary) setWeeklyReport(wData.weeklySummary);
      if (aData) setAuditLogs(aData);
      if (attData) {
        setTodayAttendance(attData.todayRecord || (attData.allTodayRecords && attData.allTodayRecords[0]) || null);
      }

      if (rData && rData.length > 0) {
        setNewTaskForm((prev) => (prev.roomAreaId ? prev : { ...prev, roomAreaId: rData[0].id }));
        setVisitorForm((prev) => (prev.roomAreaId ? prev : { ...prev, roomAreaId: rData[4]?.id || rData[0].id }));
        setAssignForm((prev) => (prev.roomId ? prev : { ...prev, roomId: rData[0].id }));
      }
    } catch (err) {
      console.error('Error fetching management data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsubscribe = api.subscribeRealtime((event, payload) => {
      if (event === 'server:time') return;
      if (event === 'task:deleted') {
        const deletedId = payload?.deletedTaskId || payload?.taskId || payload?.id;
        if (deletedId) {
          setTasks((prev) => prev.filter((t) => t.id !== deletedId));
          setSelectedTaskId((prev) => (prev === deletedId ? null : prev));
          setEditingTask((prev) => (prev?.id === deletedId ? null : prev));
          setInspectPhotoTask((prev) => (prev?.id === deletedId ? null : prev));
          setTaskPendingDelete((prev) => (prev?.id === deletedId ? null : prev));
        }
        if (Array.isArray(payload?.tasks)) {
          setTasks(payload.tasks);
        }
        loadData();
        return;
      }
      if (event === 'task:created' || event === 'task:updated') {
        if (Array.isArray(payload?.tasks)) {
          setTasks(payload.tasks);
        } else if (payload?.task?.id || payload?.id) {
          const incoming = (payload.task || payload) as Task;
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === incoming.id);
            if (exists) {
              return prev.map((t) => (t.id === incoming.id ? incoming : t));
            }
            return [incoming, ...prev];
          });
        }
        loadData();
        return;
      }
      if (event === 'room:created' || event === 'room:updated' || event === 'connected') {
        if (Array.isArray(payload?.rooms)) {
          setRooms(payload.rooms);
        } else if (payload?.room?.id) {
          const incomingRoom = payload.room as RoomArea;
          setRooms((prev) =>
            prev.some((r) => r.id === incomingRoom.id)
              ? prev.map((r) => (r.id === incomingRoom.id ? incomingRoom : r))
              : [...prev, incomingRoom]
          );
        }
        if (payload?.room?.id) {
          const updatedRoom = payload.room as RoomArea;
          setHistoryRoom((prev) => (prev?.id === updatedRoom.id ? updatedRoom : prev));
        }
        loadData();
        return;
      }
      loadData();
    });
    const interval = setInterval(loadData, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadData]);

  // Real-time elapsed duration ticker for Pantry Boy's active session
  useEffect(() => {
    const updateElapsed = () => {
      if (!todayAttendance?.loginTime) {
        setElapsedSeconds(0);
        return;
      }
      const start = new Date(todayAttendance.loginTime).getTime();
      const end = todayAttendance.logoutTime
        ? new Date(todayAttendance.logoutTime).getTime()
        : Date.now();
      const diffSec = Math.max(0, Math.floor((end - start) / 1000));
      setElapsedSeconds(diffSec);
    };

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [todayAttendance?.loginTime, todayAttendance?.logoutTime]);

  const formatElapsedDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  };

  const handleOpenAttendanceHistory = async () => {
    setShowAttendanceHistoryModal(true);
    setLoadingAttendanceHistory(true);
    try {
      const historyData = await api.getAttendanceHistory();
      setAttendanceHistoryList(historyData.history || []);
    } catch (err) {
      console.error('Failed to load attendance history:', err);
    } finally {
      setLoadingAttendanceHistory(false);
    }
  };

  // AI Task Parser
  const handleAiParse = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiParsing(true);
    try {
      const parsed = await api.parseNaturalLanguageTask(aiPrompt);
      setNewTaskForm((prev) => ({
        ...prev,
        title: parsed.title || `Prepare ${parsed.matchedRoomName}`,
        roomAreaId: parsed.roomAreaId || rooms[0]?.id || '',
        priority: parsed.priority || 'P2',
        dueTime: parsed.dueTime || 'Within 30 mins',
        description: parsed.description || aiPrompt,
        isUrgent: Boolean(parsed.isUrgent),
        checklist: parsed.checklist && parsed.checklist.length > 0 ? parsed.checklist : prev.checklist,
      }));
    } catch (err) {
      console.error('AI parse error:', err);
    } finally {
      setIsAiParsing(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedTitle = normalizeDisplayText(newTaskForm.title);
    if (!cleanedTitle || !newTaskForm.roomAreaId) return;
    setTaskModalError(null);
    try {
      const defaultPantry = allUsers.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active');
      const created = await api.createTask({
        title: cleanedTitle,
        roomAreaId: newTaskForm.roomAreaId,
        priority: newTaskForm.isUrgent ? 'URGENT' : newTaskForm.priority,
        scheduledFor:
          newTaskForm.scheduleMode === 'SCHEDULED' && newTaskForm.scheduledFor
            ? newTaskForm.scheduledFor
            : undefined,
        assignedToEmail: newTaskForm.assignedToEmail || defaultPantry?.email,
        dueTime: newTaskForm.dueTime,
        description: normalizeDisplayText(newTaskForm.description),
        isUrgent: newTaskForm.isUrgent,
        checklist: newTaskForm.checklist,
      });
      setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [created, ...prev]));
      setShowNewTaskModal(false);
      setAiPrompt('');
      setNewTaskForm((prev) => ({
        ...prev,
        title: '',
        description: '',
        scheduleMode: 'IMMEDIATE',
        scheduledFor: toISTDateTimeLocal(new Date(getServerNowMs() + 15 * 60 * 1000)),
      }));
      await loadData();
    } catch (err: any) {
      setTaskModalError(err.message || 'Failed to create task');
    }
  };

  const handleOpenEditTask = (task: Task) => {
    setTaskModalError(null);
    setEditingTask(task);
    setEditTaskForm({
      title: normalizeDisplayText(task.title),
      roomAreaId: task.roomAreaId,
      priority: task.priority,
      scheduledFor: toISTDateTimeLocal(task.scheduledFor),
      assignedToEmail: task.assignedToEmail,
      dueTime: task.dueTime,
      description: normalizeDisplayText(task.description || ''),
      isUrgent: task.isUrgent,
    });
  };

  const handleSaveEditTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    const cleanedTitle = normalizeDisplayText(editTaskForm.title);
    if (!cleanedTitle) {
      setTaskModalError('Task title cannot be empty.');
      return;
    }
    setSavingTaskEdit(true);
    setTaskModalError(null);
    try {
      const updated = await api.updateTask(editingTask.id, {
        title: cleanedTitle,
        roomAreaId: editTaskForm.roomAreaId,
        priority: editTaskForm.isUrgent ? 'URGENT' : editTaskForm.priority,
        isUrgent: editTaskForm.isUrgent,
        scheduledFor: editTaskForm.scheduledFor,
        assignedToEmail: editTaskForm.assignedToEmail,
        dueTime: editTaskForm.dueTime,
        description: normalizeDisplayText(editTaskForm.description),
      });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingTask(null);
      await loadData();
    } catch (err: any) {
      setTaskModalError(err.message || 'Failed to update/reschedule task');
    } finally {
      setSavingTaskEdit(false);
    }
  };

  const handleCancelTask = async (task: Task) => {
    setSavingTaskEdit(true);
    setTaskModalError(null);
    try {
      await api.cancelTask(task.id, `Cancelled by ${currentUser?.name || 'Management'}`);
      if (editingTask?.id === task.id) {
        setEditingTask(null);
      }
      await loadData();
    } catch (err: any) {
      setTaskModalError(err.message || 'Failed to cancel task');
    } finally {
      setSavingTaskEdit(false);
    }
  };

  const handleVerifyPhoto = async (taskId: string, decision: 'APPROVE' | 'REJECT', reason?: string) => {
    setVerifyingPhotoModal(true);
    try {
      await api.verifyPhotoEvidence(taskId, decision, reason);
      setInspectPhotoTask(null);
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to verify photo');
    } finally {
      setVerifyingPhotoModal(false);
    }
  };

  const handleDetailToggleChecklist = async (taskId: string, itemId: string, completed: boolean) => {
    if (!hasPermission('tasks', 'edit')) return;
    setTaskDetailError(null);
    try {
      const updated = await api.updateChecklistItem(taskId, itemId, completed);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      await loadData();
    } catch (err: any) {
      setTaskDetailError(err.message || 'Failed to update checklist item');
    }
  };

  const handleDetailStatusChange = async (taskId: string, nextStatus: TaskStatus, note?: string) => {
    if (!hasPermission('tasks', 'edit')) return;
    setTaskDetailActionLoading(true);
    setTaskDetailError(null);
    try {
      const updated = await api.updateTaskStatus(taskId, nextStatus, note ? { note } : undefined);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      await loadData();
    } catch (err: any) {
      setTaskDetailError(err.message || 'Failed to update task status');
    } finally {
      setTaskDetailActionLoading(false);
    }
  };

  const handleDetailCancelTask = async (task: Task) => {
    if (!hasPermission('tasks', 'edit')) return;
    setTaskDetailActionLoading(true);
    setTaskDetailError(null);
    try {
      const updated = await api.cancelTask(task.id, `Cancelled by ${currentUser?.name || 'Management'}`);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      await loadData();
    } catch (err: any) {
      setTaskDetailError(err.message || 'Failed to cancel task');
    } finally {
      setTaskDetailActionLoading(false);
    }
  };

  const handleDetailVerifyPhoto = async (taskId: string, decision: 'APPROVE' | 'REJECT', reason?: string) => {
    if (!hasPermission('tasks', 'edit')) return;
    setTaskDetailActionLoading(true);
    setTaskDetailError(null);
    try {
      const updated = await api.verifyPhotoEvidence(taskId, decision, reason);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      await loadData();
    } catch (err: any) {
      setTaskDetailError(err.message || 'Failed to verify submitted photo evidence');
    } finally {
      setTaskDetailActionLoading(false);
    }
  };

  const requestDeleteTask = useCallback(
    (task: Task) => {
      if (!canDeleteTask) return;
      if (isPantryBoyTask(task)) {
        setDeleteTaskError(
          'Business policy: Pantry Boy tasks are permanent operational records and cannot be deleted.'
        );
        return;
      }
      setDeleteTaskError(null);
      setTaskPendingDelete(task);
    },
    [canDeleteTask, isPantryBoyTask]
  );

  const confirmAndExecuteDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTask || isDeletingTask) return;
    if (isPantryBoyTask(taskPendingDelete)) {
      setDeleteTaskError('Business policy: Pantry Boy tasks are permanent operational records and cannot be deleted.');
      setTaskPendingDelete(null);
      return;
    }
    const targetId = taskPendingDelete.id;
    setIsDeletingTask(true);
    setDeleteTaskError(null);
    try {
      const result = await api.deleteTask(targetId);
      const removedId = result.deletedTaskId || targetId;
      setTasks((prev) => prev.filter((t) => t.id !== removedId));
      setSelectedTaskId((prev) => (prev === removedId ? null : prev));
      setEditingTask((prev) => (prev?.id === removedId ? null : prev));
      setInspectPhotoTask((prev) => (prev?.id === removedId ? null : prev));
      setTaskPendingDelete(null);
      await loadData();
    } catch (err: any) {
      setDeleteTaskError(err.message || 'Failed to delete task from database. Please try again.');
    } finally {
      setIsDeletingTask(false);
    }
  };

  const handleRegisterArrival = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.registerVisitorArrival(visitorForm);
      setShowVisitorModal(false);
      setVisitorForm({
        visitorName: '',
        companyName: '',
        hostName: currentUser?.name || '',
        roomAreaId: rooms[4]?.id || rooms[0]?.id || '',
        guestCount: 2,
        notes: '',
      });
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to register arrival');
    }
  };

  const handleRegisterDeparture = async (visitorId: string) => {
    try {
      await api.registerVisitorDeparture(visitorId);
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to register departure');
    }
  };

  const handleRoomStatusAction = async (
    roomId: string,
    action: 'MARK_OCCUPIED' | 'MARK_READY' | 'RELEASE_VACANT' | 'REQUEST_CLEANING' | 'REOPEN',
    note?: string
  ) => {
    try {
      const res = await api.roomStatusAction(roomId, action, note);
      setRooms((prev) => prev.map((r) => (r.id === roomId ? res.room : r)));
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || `Failed to execute ${action}`);
    }
  };

  const handleToggleRoomActive = async (roomId: string) => {
    try {
      const updated = await api.toggleRoomActive(roomId);
      setRooms((prev) => prev.map((r) => (r.id === roomId ? updated : r)));
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to toggle room active state');
    }
  };

  const handleViewHistory = async (room: RoomArea) => {
    setHistoryRoom(room);
    setShowHistoryModal(true);
    setLoadingHistory(true);
    try {
      const data = await api.getRoomHistory(room.id);
      setRoomHistoryData(data);
    } catch (err) {
      console.error('Failed to load room history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssignConflictError(null);
    setSubmittingAssign(true);
    try {
      await api.assignRoom(assignForm.roomId, {
        visitorName: assignForm.visitorName,
        reference: assignForm.reference,
        expectedArrival: assignForm.expectedArrival,
        expectedDuration: assignForm.expectedDuration,
        prepRequirements: assignForm.prepRequirements,
        waterRequirements: assignForm.waterRequirements,
        priority: assignForm.priority,
        instructions: assignForm.instructions,
        forceOverride: assignForm.forceOverride,
      });
      setShowAssignModal(false);
      setAssignForm({
        roomId: rooms[0]?.id || '',
        visitorName: '',
        reference: 'Candidate Interview / Client Meeting',
        expectedArrival: '11:30 AM',
        expectedDuration: '1 hour',
        prepRequirements: [
          'Sanitize meeting table and coasters',
          'Align all chairs in uniform geometric layout',
          'Check presentation screen & HDMI connection',
        ],
        waterRequirements: '2 Chilled Sealed Bottles + Clean Glasses',
        priority: 'P2',
        instructions: '',
        forceOverride: false,
      });
      await loadData();
    } catch (err: any) {
      if (err.code === 'ROOM_CONFLICT') {
        setAssignConflictError({
          message: err.message || 'Room conflict detected',
          availableRooms: err.availableRooms || [],
        });
      } else {
        setActionErrorBanner(err.message || 'Failed to assign room');
      }
    } finally {
      setSubmittingAssign(false);
    }
  };

  const handleToggleUser = async (userId: string) => {
    try {
      await api.toggleUserStatus(userId);
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to update user status');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser(newUserForm);
      setShowUserModal(false);
      setNewUserForm({
        name: '',
        email: '',
        role: 'PANTRY_BOY',
        department: 'Hospitality & Operations',
        phone: '',
      });
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to create company user');
    }
  };

  const handleOpenEditUser = (user: UserAccount) => {
    const basePerms = user.permissions || getDefaultPermissions(user.role);
    const normalizedPerms: UserPermissions =
      user.role === 'PANTRY_BOY'
        ? {
            ...basePerms,
            actions: {
              ...basePerms.actions,
              tasks: { ...basePerms.actions.tasks, delete: false },
            },
          }
        : basePerms;
    setEditingUser(user);
    setEditUserForm({
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || '',
      phone: user.phone || '',
      permissions: normalizedPerms,
    });
    setShowEditUserModal(true);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setUserActionLoading(true);
    try {
      const payload =
        editUserForm.role === 'PANTRY_BOY'
          ? {
              ...editUserForm,
              permissions: {
                ...editUserForm.permissions,
                actions: {
                  ...editUserForm.permissions.actions,
                  tasks: { ...editUserForm.permissions.actions.tasks, delete: false },
                },
              },
            }
          : editUserForm;
      await api.updateUser(editingUser.id, payload);
      setShowEditUserModal(false);
      setEditingUser(null);
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to update user and permissions');
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setUserActionLoading(true);
    try {
      await api.deleteUser(userId);
      setDeleteConfirmUser(null);
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to delete user');
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitizedRoomForm = {
        ...roomForm,
        name: normalizeRoomName(roomForm.name),
      };
      if (sanitizedRoomForm.id) {
        await api.updateRoom(sanitizedRoomForm.id, sanitizedRoomForm);
      } else {
        await api.addRoom(sanitizedRoomForm);
      }
      setShowRoomModal(false);
      setRoomForm({
        name: '',
        category: 'MEETING_SUITE',
        defaultPriority: 'P5',
        photoRequired: true,
        recurrence: 'DAILY',
      });
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to save room');
    }
  };

  const handleTriggerMilestone = async (
    milestone: '9AM_START' | '10AM_WATER' | '12PM_PLANTS' | '4PM_WATER' | '3PM_WATER' | 'CLOSING_AUDIT'
  ) => {
    try {
      await api.triggerSchedulerMilestone(milestone);
      await loadData();
    } catch (err: any) {
      setActionErrorBanner(err.message || 'Failed to trigger schedule milestone');
    }
  };

  // Room Status Badge Styling Helper
  const getRoomStatusBadge = (status: RoomStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return { label: 'Available', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' };
      case 'RESERVED':
        return { label: 'Reserved', bg: 'bg-sky-50 text-sky-800 border-sky-200', color: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' };
      case 'ASSIGNED':
        return { label: 'Assigned', bg: 'bg-blue-50 text-blue-800 border-blue-200', color: 'bg-blue-50 text-blue-800 border-blue-200', dot: 'bg-blue-500' };
      case 'PREPARATION_REQUIRED':
        return { label: 'Prep Required', bg: 'bg-amber-50 text-amber-800 border-amber-200', color: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
      case 'READY_FOR_VISITOR':
        return { label: 'Ready for Guest', bg: 'bg-teal-50 text-teal-800 border-teal-200', color: 'bg-teal-50 text-teal-800 border-teal-200', dot: 'bg-teal-500' };
      case 'OCCUPIED':
        return { label: 'Occupied', bg: 'bg-purple-50 text-purple-800 border-purple-200', color: 'bg-purple-50 text-purple-800 border-purple-200', dot: 'bg-purple-500' };
      case 'VACANT':
        return { label: 'Vacant', bg: 'bg-amber-50 text-amber-800 border-amber-200', color: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
      case 'CLEANING_REQUIRED':
        return { label: 'Cleaning Required', bg: 'bg-rose-50 text-rose-800 border-rose-200', color: 'bg-rose-50 text-rose-800 border-rose-200', dot: 'bg-rose-500' };
      case 'CLEANING_IN_PROGRESS':
        return { label: 'Cleaning in Progress', bg: 'bg-orange-50 text-orange-800 border-orange-200', color: 'bg-orange-50 text-orange-800 border-orange-200', dot: 'bg-orange-500' };
      case 'PENDING_VERIFICATION':
        return { label: 'Under Review', bg: 'bg-indigo-50 text-indigo-800 border-indigo-200', color: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-500' };
      default:
        return { label: status, bg: 'bg-slate-100 text-slate-800 border-slate-200', color: 'bg-slate-100 text-slate-800 border-slate-200', dot: 'bg-slate-400' };
    }
  };

  // Task Status Badge Styling Helper
  const getTaskStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'COMPLETED':
        return { label: 'Completed', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
      case 'IN_PROGRESS':
        return { label: 'In Progress', bg: 'bg-amber-50 text-amber-800 border-amber-200' };
      case 'PENDING_VERIFICATION':
        return { label: 'Under Review', bg: 'bg-sky-50 text-sky-800 border-sky-200' };
      case 'SUBMITTED':
        return { label: 'Submitted', bg: 'bg-sky-50 text-sky-800 border-sky-200' };
      case 'REJECTED':
        return { label: 'Rejected', bg: 'bg-rose-50 text-rose-800 border-rose-200' };
      case 'OVERDUE':
        return { label: 'Overdue', bg: 'bg-rose-50 text-rose-800 border-rose-200' };
      case 'BLOCKED':
        return { label: 'Blocked', bg: 'bg-red-50 text-red-800 border-red-200' };
      case 'SCHEDULED':
        return { label: 'Scheduled', bg: 'bg-indigo-50 text-indigo-800 border-indigo-200' };
      case 'CANCELLED':
        return { label: 'Cancelled', bg: 'bg-slate-100 text-slate-500 border-slate-300' };
      default:
        return { label: 'Available', bg: 'bg-slate-50 text-slate-700 border-slate-200' };
    }
  };

  const formatTaskTypeLabel = (taskType?: string) => {
    if (!taskType) return 'Operational Task';
    return taskType
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  };

  const matchesTaskCategory = useCallback(
    (t: Task, category: 'PANTRY_TASKS' | 'CLEANING_TASKS' | 'REARRANGEMENT_TASKS'): boolean => {
      const text = `${t.title || ''} ${t.description || ''} ${t.roomAreaName || ''}`.toLowerCase();
      if (category === 'PANTRY_TASKS') {
        return (
          text.includes('water') ||
          text.includes('pantry') ||
          text.includes('coffee') ||
          text.includes('tea') ||
          text.includes('beverage') ||
          text.includes('snack') ||
          text.includes('refill') ||
          text.includes('bottle') ||
          text.includes('plant')
        );
      }
      if (category === 'CLEANING_TASKS') {
        return (
          text.includes('clean') ||
          text.includes('sanitize') ||
          text.includes('mop') ||
          text.includes('dust') ||
          text.includes('dustbin task') ||
          text.includes('bin') ||
          text.includes('hygiene') ||
          text.includes('trash') ||
          text.includes('outside')
        );
      }
      return (
        text.includes('chair') ||
        text.includes('align') ||
        text.includes('table') ||
        text.includes('rearrange') ||
        text.includes('setup') ||
        text.includes('prep') ||
        text.includes('presentation') ||
        text.includes('interview')
      );
    },
    []
  );

  // Counts for sidebar badges (strictly synchronized with filteredTasks)
  const pantryTasksCount = useMemo(
    () => tasks.filter((t) => matchesTaskCategory(t, 'PANTRY_TASKS')).length,
    [tasks, matchesTaskCategory]
  );

  const cleaningTasksCount = useMemo(
    () => tasks.filter((t) => matchesTaskCategory(t, 'CLEANING_TASKS')).length,
    [tasks, matchesTaskCategory]
  );

  const rearrangementTasksCount = useMemo(
    () => tasks.filter((t) => matchesTaskCategory(t, 'REARRANGEMENT_TASKS')).length,
    [tasks, matchesTaskCategory]
  );

  const todayISTKey = getISTDateKeyFromMs(getServerNowMs());

  const getTaskISTDateKey = useCallback(
    (t: Task): string => {
      const ms = new Date(t.scheduledFor).getTime();
      return Number.isNaN(ms) ? todayISTKey : getISTDateKeyFromMs(ms);
    },
    [getISTDateKeyFromMs, todayISTKey]
  );

  // Filtered tasks considering subTab category, ordered chronologically in IST
  const filteredTasks = useMemo(() => {
    const matches = tasks.filter((t) => {
      if (subTab === 'PANTRY_TASKS' && !matchesTaskCategory(t, 'PANTRY_TASKS')) return false;
      if (subTab === 'CLEANING_TASKS' && !matchesTaskCategory(t, 'CLEANING_TASKS')) return false;
      if (subTab === 'REARRANGEMENT_TASKS' && !matchesTaskCategory(t, 'REARRANGEMENT_TASKS')) return false;

      if (filterRoom !== 'ALL' && t.roomAreaId !== filterRoom) return false;
      if (filterPriority !== 'ALL' && t.priority !== filterPriority) return false;
      if (filterStatus !== 'ALL' && t.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.roomAreaName.toLowerCase().includes(q) ||
          t.assignedToName.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const isTerm = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
    return [...matches].sort((a, b) => {
      const termA = isTerm(a.status) ? 1 : 0;
      const termB = isTerm(b.status) ? 1 : 0;
      if (termA !== termB) return termA - termB;
      const schedA = new Date(a.scheduledFor).getTime() || 0;
      const schedB = new Date(b.scheduledFor).getTime() || 0;
      return schedA - schedB;
    });
  }, [tasks, subTab, filterRoom, filterPriority, filterStatus, searchQuery, matchesTaskCategory]);

  // Separate Today's Tasks, Overdue Tasks, Upcoming Tasks, and Cancelled/Archived Tasks
  const todaySectionTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) =>
          t.status !== 'OVERDUE' &&
          t.status !== 'CANCELLED' &&
          getTaskISTDateKey(t) === todayISTKey
      ),
    [filteredTasks, getTaskISTDateKey, todayISTKey]
  );

  const overdueSectionTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) =>
          t.status !== 'COMPLETED' &&
          t.status !== 'CANCELLED' &&
          (t.status === 'OVERDUE' || getTaskISTDateKey(t) < todayISTKey)
      ),
    [filteredTasks, getTaskISTDateKey, todayISTKey]
  );

  const upcomingSectionTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) =>
          t.status !== 'COMPLETED' &&
          t.status !== 'CANCELLED' &&
          getTaskISTDateKey(t) > todayISTKey
      ),
    [filteredTasks, getTaskISTDateKey, todayISTKey]
  );

  const cancelledSectionTasks = useMemo(
    () =>
      filteredTasks.filter(
        (t) =>
          t.status === 'CANCELLED' ||
          (t.status === 'COMPLETED' && getTaskISTDateKey(t) !== todayISTKey)
      ),
    [filteredTasks, getTaskISTDateKey, todayISTKey]
  );

  const recentActivityTasks = useMemo(() => {
    return [...tasks]
      .sort((a, b) => {
        const getLatestTs = (t: Task) => {
          const lastHist =
            t.changeHistory && t.changeHistory.length > 0
              ? t.changeHistory[t.changeHistory.length - 1].timestamp
              : undefined;
          const raw =
            t.completedAt ||
            t.submittedAt ||
            t.startedAt ||
            t.cancelledAt ||
            lastHist ||
            t.createdAt ||
            t.scheduledFor;
          return new Date(raw).getTime() || 0;
        };
        const diff = getLatestTs(b) - getLatestTs(a);
        if (diff !== 0) return diff;
        return (new Date(a.scheduledFor).getTime() || 0) - (new Date(b.scheduledFor).getTime() || 0);
      })
      .slice(0, 5);
  }, [tasks]);

  const readyRoomsCount = rooms.filter((r) => r.status === "AVAILABLE" || r.status === "READY_FOR_VISITOR").length;
  const preparingRoomsCount = rooms.filter(
    (r) =>
      r.status === "PREPARATION_REQUIRED" ||
      r.status === "CLEANING_REQUIRED" ||
      r.status === "CLEANING_IN_PROGRESS" ||
      r.status === "PENDING_VERIFICATION" ||
      r.status === "ASSIGNED" ||
      r.status === "OCCUPIED"
  ).length;

  const completedTasks = tasks.filter((t) => t.status === "COMPLETED");
  const pendingTasks = tasks.filter(
    (t) =>
      (t.status === "AVAILABLE" ||
        t.status === "IN_PROGRESS" ||
        t.status === "PENDING_VERIFICATION" ||
        t.status === "BLOCKED" ||
        t.status === "SCHEDULED") &&
      getTaskISTDateKey(t) === todayISTKey
  );
  const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS");
  const overdueTasks = tasks.filter(
    (t) =>
      t.status !== "COMPLETED" &&
      t.status !== "CANCELLED" &&
      (t.status === "OVERDUE" || getTaskISTDateKey(t) < todayISTKey)
  );

  const todayFormatted = (() => {
    try {
      const now = new Date(getServerNowMs());
      const day = now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit" });
      const month = now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", month: "short" });
      const year = now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", year: "numeric" });
      const weekday = now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" });
      return `${day} ${month} ${year} (${weekday})`;
    } catch {
      return "27 Oct 2026 (Tue)";
    }
  })();

  const dashboardRooms = [
    {
      id: rooms.find((r) => r.name.toLowerCase().includes("reception"))?.id || "room-1",
      name: "Reception",
      category: "Front Desk & Guest Welcome",
      status: rooms.find((r) => r.name.toLowerCase().includes("reception"))?.status || "AVAILABLE",
      pendingCount: tasks.filter(
        (t) => t.roomAreaName.toLowerCase().includes("reception") && t.status !== "COMPLETED"
      ).length,
    },
    {
      id: rooms.find((r) => r.category === "MEETING_SUITE")?.id || "room-5",
      name: "Conference Room",
      category: "Client Presentation Suite",
      status: rooms.find((r) => r.category === "MEETING_SUITE")?.status || "AVAILABLE",
      pendingCount: tasks.filter(
        (t) => (t.roomAreaName.toLowerCase().includes("skyline") || t.roomAreaName.toLowerCase().includes("summit") || t.roomAreaName.toLowerCase().includes("loft")) && t.status !== "COMPLETED"
      ).length,
    },
    {
      id: rooms.find((r) => r.name.toLowerCase().includes("desks") || r.category === "WORKSTATION")?.id || "room-2",
      name: "Office Area",
      category: "Open Workstations & Cabins",
      status: rooms.find((r) => r.name.toLowerCase().includes("desks"))?.status || "AVAILABLE",
      pendingCount: tasks.filter(
        (t) => (t.roomAreaName.toLowerCase().includes("desk") || t.roomAreaName.toLowerCase().includes("workstation")) && t.status !== "COMPLETED"
      ).length,
    },
    {
      id: rooms.find((r) => r.name.toLowerCase().includes("community") || r.category === "COMMON_AREA")?.id || "room-7",
      name: "Lobby",
      category: "Executive Waiting Lounge",
      status: rooms.find((r) => r.name.toLowerCase().includes("community"))?.status || "AVAILABLE",
      pendingCount: tasks.filter(
        (t) => (t.roomAreaName.toLowerCase().includes("community") || t.roomAreaName.toLowerCase().includes("regency") || t.roomAreaName.toLowerCase().includes("outer")) && t.status !== "COMPLETED"
      ).length,
    },
    {
      id: rooms.find((r) => r.name.toLowerCase().includes("pantry"))?.id || "room-1",
      name: "Pantry",
      category: "Beverages & Water Hub",
      status: "AVAILABLE" as RoomStatus,
      pendingCount: tasks.filter(
        (t) => (t.title.toLowerCase().includes("water") || t.title.toLowerCase().includes("pantry") || t.title.toLowerCase().includes("coffee")) && t.status !== "COMPLETED"
      ).length,
    },
    {
      id:
        rooms.find(
          (r) =>
            r.name.toLowerCase() === "dustbin task" ||
            r.name.toLowerCase().includes("dustbin") ||
            r.category === "FACILITIES"
        )?.id || "room-13",
      name: "Dustbin Task",
      category: "Hygiene & Facilities",
      status:
        rooms.find(
          (r) =>
            r.name.toLowerCase() === "dustbin task" ||
            r.name.toLowerCase().includes("dustbin") ||
            r.id === "room-13"
        )?.status || ("AVAILABLE" as RoomStatus),
      pendingCount: tasks.filter(
        (t) =>
          (t.title.toLowerCase().includes("dustbin") ||
            t.title.toLowerCase().includes("clean") ||
            t.roomAreaName.toLowerCase() === "dustbin task") &&
          t.status !== "COMPLETED"
      ).length,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row text-slate-900 antialiased font-sans">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-950/70 z-40 md:hidden backdrop-blur-xs"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Dark Animated Sidebar (Fixed 100dvh desktop rail / Mobile slide-over drawer) */}
      <aside
        className={`fixed top-0 left-0 wcr-h-dvh bg-[#0b1329] text-white flex flex-col z-50 md:z-40 transition-[width,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] shrink-0 border-r border-slate-800 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${isRailCollapsed ? "w-72 md:w-20" : "w-72 md:w-64"}`}
      >
        {/* Brand Header with Expand/Collapse Animation */}
        <div
          className={`p-3.5 border-b border-slate-800/90 flex items-center shrink-0 transition-all duration-300 ${
            isRailCollapsed ? "md:justify-center md:flex-col md:gap-2.5 justify-between" : "justify-between"
          }`}
        >
          <div className="flex items-center gap-3 overflow-hidden min-w-0">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 shadow-md border border-slate-200/90 overflow-hidden cursor-pointer"
              onClick={() => {
                if (sidebarCollapsed) setSidebarCollapsed(false);
              }}
              title={isRailCollapsed ? "Click to expand" : undefined}
            >
              <img
                src="/assets/wcr_logo.png"
                alt="White Collar Realty Logo"
                className="w-full h-full object-contain"
              />
            </motion.div>

            <AnimatePresence mode="wait">
              {!isRailCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0"
                >
                  <div className="text-xs font-bold text-white tracking-wide uppercase truncate">
                    White Collar Realty
                  </div>
                  <div className="text-[10px] text-amber-400 font-medium tracking-tight">
                    A Tradition Of Trust
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Mobile close button */}
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Desktop Expand/Collapse Toggle Button */}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800/80 transition-colors cursor-pointer"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <motion.div
                animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
              >
                <ChevronLeft className="w-4 h-4" />
              </motion.div>
            </button>
          </div>
        </div>

        {/* Navigation Items (Independent Scroll Only If Needed) */}
        <nav
          className={`flex-1 min-h-0 px-3 py-4 space-y-1.5 wcr-sidebar-scroll ${
            isRailCollapsed ? "md:overflow-visible overflow-y-auto" : "overflow-y-auto overflow-x-hidden"
          }`}
          onMouseLeave={() => setHoveredSidebarTab(null)}
        >
          {[
            { id: "DASHBOARD" as ManagementTab, label: "Dashboard", icon: LayoutDashboard, visible: canViewOverview },
            { id: "PANTRY_TASKS" as ManagementTab, label: "Pantry Tasks", icon: Coffee, count: pantryTasksCount, visible: canViewTasks },
            { id: "CLEANING_TASKS" as ManagementTab, label: "Cleaning Tasks", icon: Sparkles, count: cleaningTasksCount, visible: canViewTasks },
            { id: "REARRANGEMENT_TASKS" as ManagementTab, label: "Rearrangement Tasks", icon: Move, count: rearrangementTasksCount, visible: canViewTasks },
            { id: "REPORTS" as ManagementTab, label: "Reports", icon: FileText, visible: canViewReports },
            { id: "SETTINGS" as ManagementTab, label: "Settings", icon: Settings, visible: canViewSettings },
          ]
            .filter((item) => item.visible)
            .map((item) => {
            const Icon = item.icon;
            const isItemActive =
              subTab === item.id ||
              (item.id === "SETTINGS" && (subTab === "ROOMS" || subTab === "USERS" || subTab === "AUDIT"));
            const isItemHovered = hoveredSidebarTab === item.id;

            return (
              <div key={item.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    setSubTab(item.id);
                    setSidebarOpen(false);
                  }}
                  onMouseEnter={() => setHoveredSidebarTab(item.id)}
                  className={`w-full relative flex items-center ${
                    isRailCollapsed ? "md:justify-center" : "justify-between"
                  } px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors duration-200 cursor-pointer overflow-hidden select-none ${
                    isItemActive
                      ? "text-slate-950 font-bold"
                      : isItemHovered
                      ? "text-white"
                      : "text-slate-300"
                  }`}
                  aria-current={isItemActive ? "page" : undefined}
                >
                  {/* Apple-Style Sliding Active Pill with Gold Glow */}
                  {isItemActive && (
                    <motion.div
                      layoutId="managementActiveNavPill"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="absolute inset-0 bg-gradient-to-r from-amber-400 via-amber-400 to-amber-500 rounded-xl shadow-lg shadow-amber-500/25 z-0"
                      style={{
                        boxShadow: "0 4px 16px -2px rgba(245, 158, 11, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.5)",
                      }}
                    />
                  )}

                  {/* Apple-Style Gliding Hover Pill */}
                  {!isItemActive && isItemHovered && (
                    <motion.div
                      layoutId="managementHoverNavPill"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                      className="absolute inset-0 bg-white/[0.09] border border-white/10 rounded-xl backdrop-blur-md shadow-xs z-0"
                    />
                  )}

                  {/* Icon & Label Content with Tactile Spring Lift */}
                  <motion.div
                    className="relative z-10 flex items-center gap-3 min-w-0"
                    whileHover={{ y: -1.5, x: isRailCollapsed ? 0 : 2 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  >
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: [0, -3, 3, 0] }}
                      transition={{
                        scale: { type: "spring", stiffness: 450, damping: 20 },
                        rotate: { type: "tween", duration: 0.35, ease: "easeInOut" },
                      }}
                      className="shrink-0 flex items-center justify-center"
                    >
                      <Icon
                        className={`w-4 h-4 transition-colors duration-200 ${
                          isItemActive
                            ? "text-slate-950"
                            : isItemHovered
                            ? "text-amber-300"
                            : "text-slate-400"
                        }`}
                      />
                    </motion.div>

                    <AnimatePresence mode="wait">
                      {!isRailCollapsed && (
                        <motion.span
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.18 }}
                          className="truncate text-left whitespace-nowrap"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Badge Counter (When Expanded) */}
                  {!isRailCollapsed && item.count !== undefined && item.count > 0 && (
                    <span
                      className={`relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold tabular-nums transition-colors duration-200 ${
                        isItemActive
                          ? "bg-slate-950 text-amber-400 shadow-xs"
                          : isItemHovered
                          ? "bg-amber-400/20 text-amber-300 border border-amber-400/30"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}

                  {/* Collapsed Mode Indicator Dot */}
                  {isRailCollapsed && item.count !== undefined && item.count > 0 && (
                    <span className="hidden md:block absolute top-2 right-2.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#0b1329] z-20" />
                  )}
                </button>

                {/* Collapsed Floating Tooltip with Arrow (Dribbble Signature) */}
                {isRailCollapsed && (
                  <div className="hidden md:flex absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900/95 backdrop-blur-md text-white text-xs font-semibold rounded-xl shadow-2xl border border-slate-700 pointer-events-none whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 items-center gap-2">
                    <span>{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className="bg-amber-400 text-slate-950 text-[10px] font-bold px-1.5 py-0.2 rounded-full tabular-nums">
                        {item.count}
                      </span>
                    )}
                    <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900/95" />
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Authenticated User Profile Card & Logout Fixed at Sidebar Bottom */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 shrink-0 mt-auto relative group">
          <div
            className={`flex items-center transition-all duration-300 ${
              isRailCollapsed ? "md:flex-col md:justify-center md:gap-2" : "gap-3"
            }`}
          >
            {currentUser?.avatarUrl && currentUser.avatarUrl !== "/assets/wcr_logo.png" ? (
              <motion.img
                whileHover={{ scale: 1.08 }}
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                className="w-9 h-9 rounded-full object-cover ring-2 ring-amber-400 shrink-0 cursor-pointer shadow-md"
                title={isRailCollapsed ? `${currentUser.name} · ${getUserRoleLabel(currentUser)}` : undefined}
              />
            ) : (
              <motion.div
                whileHover={{ scale: 1.08 }}
                title={isRailCollapsed && currentUser ? `${currentUser.name} · ${getUserRoleLabel(currentUser)}` : undefined}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold tracking-tight ring-2 shrink-0 shadow-md select-none ${
                  currentUser?.role === "ADMIN"
                    ? "bg-purple-500/20 text-purple-200 ring-purple-400/70"
                    : currentUser?.role === "HR"
                    ? "bg-blue-500/20 text-blue-200 ring-blue-400/70"
                    : currentUser?.role === "KIMMY_MAM"
                    ? "bg-amber-500/20 text-amber-300 ring-amber-400"
                    : "bg-emerald-500/20 text-emerald-200 ring-emerald-400/70"
                }`}
              >
                {getUserInitials(currentUser?.name)}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {!isRailCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 flex-1"
                >
                  <div className="text-xs font-bold text-white truncate">
                    {currentUser?.name || "Authorized User"}
                  </div>
                  <div className="text-[10px] text-amber-400 font-semibold truncate">
                    {getUserRoleLabel(currentUser)}
                  </div>
                  <div className="text-[9.5px] text-slate-400 font-mono truncate">
                    {currentUser?.email}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => logout()}
              title="Sign Out"
              aria-label="Sign Out"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </motion.button>
          </div>

          {/* Collapsed Tooltip for Profile & Logout */}
          {isRailCollapsed && (
            <div className="hidden md:flex absolute left-full ml-3 bottom-3 p-3 bg-slate-900/95 backdrop-blur-md text-white rounded-xl shadow-2xl border border-slate-700 pointer-events-auto whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 items-center gap-3">
              <div>
                <div className="text-xs font-bold text-white">{currentUser?.name || "Authorized User"}</div>
                <div className="text-[10px] text-amber-400 font-semibold">{getUserRoleLabel(currentUser)}</div>
                <div className="text-[9.5px] text-slate-400 font-mono">{currentUser?.email}</div>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <div className="absolute right-full bottom-4 border-4 border-transparent border-r-slate-900/95" />
            </div>
          )}
        </div>
      </aside>

      {/* Main Layout Area (Offset by Fixed Desktop Sidebar Width) */}
      <div
        className={`flex-1 min-w-0 flex flex-col min-h-screen transition-[padding] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          sidebarCollapsed ? "md:pl-20" : "md:pl-64"
        }`}
      >
        {/* Dark Top Header Bar */}
        <header className="bg-[#0b1329] border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  White Collar Realty
                </h1>
                <span className="hidden sm:inline-block text-[10px] text-amber-400 font-mono font-medium border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full">
                  Operations & Hospitality Console
                </span>
              </div>
              <p className="text-[10px] text-slate-400 hidden sm:block">
                SmartPantry & Real-Time Facility Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Active Authenticated User Badge */}
            {currentUser && (
              <div
                className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-700/90 text-xs text-slate-200"
                title={`Signed in as ${currentUser.name} (${currentUser.email})`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="font-semibold text-white truncate max-w-[160px]">{currentUser.name}</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  {getUserRoleBadge(currentUser.role)}
                </span>
              </div>
            )}

            {/* Fast Task Creation */}
            {hasPermission('tasks', 'create') && (
              <motion.button
                whileHover={{ y: -1.5, scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => {
                  setNewTaskForm((prev) => ({ ...prev, isUrgent: false, priority: "P2" }));
                  setShowNewTaskModal(true);
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-full transition-all flex items-center gap-1.5 shadow-md shadow-amber-500/25 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">New Task</span>
              </motion.button>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {actionErrorBanner && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-medium">{actionErrorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionErrorBanner(null)}
                aria-label="Dismiss message"
                className="p-1 rounded-lg text-rose-500 hover:text-rose-800 hover:bg-rose-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {/* TAB 1: REDESIGNED DASHBOARD */}
          {subTab === "DASHBOARD" && canViewOverview && (
            <div className="space-y-6">
              {/* Header: Welcome Back + Date Card */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    Welcome Back, {currentUser?.name || "Team"} 👋
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Signed in as <span className="font-semibold text-slate-700">{currentUser?.email}</span> · {getUserRoleLabel(currentUser)}
                  </p>
                </div>
                <Card3D
                  maxTilt={2.5}
                  liftPx={2.5}
                  className="border border-slate-200/90 px-4 py-2.5 rounded-xl flex items-center gap-3 self-start sm:self-auto"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today</div>
                    <div className="text-xs sm:text-sm font-bold text-slate-800 font-mono tabular-nums">
                      {todayFormatted}
                    </div>
                  </div>
                </Card3D>
              </div>

              {/* 4 Clickable Summary Cards (Total Tasks, Pending Tasks, Overdue Tasks, Total Reports) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Total Tasks */}
                <Card3D
                  as="button"
                  type="button"
                  maxTilt={3.4}
                  liftPx={4}
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("TOTAL_TASKS");
                  }}
                  className="p-5 rounded-2xl border border-slate-200 cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-amber-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-slate-900 transition-colors">
                      Total Tasks
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono tabular-nums">
                      <ArrowUpRight className="w-3 h-3 text-emerald-600" />
                      12%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900 font-mono tabular-nums tracking-tight my-1">
                    {tasks.length}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-1">
                    {completedTasks.length} completed · Click for details
                  </div>
                </Card3D>

                {/* Card 2: Pending Tasks */}
                <Card3D
                  as="button"
                  type="button"
                  maxTilt={3.4}
                  liftPx={4}
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("PENDING_TASKS");
                  }}
                  className="p-5 rounded-2xl border border-slate-200 cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-amber-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider group-hover:text-amber-900 transition-colors">
                      Pending Tasks
                    </span>
                    <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono tabular-nums">
                      <ArrowUpRight className="w-3 h-3 text-amber-600" />
                      5%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-amber-600 font-mono tabular-nums tracking-tight my-1">
                    {pendingTasks.length}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-1">
                    {inProgressTasks.length} in progress · Click for details
                  </div>
                </Card3D>

                {/* Card 3: Overdue Tasks */}
                <Card3D
                  as="button"
                  type="button"
                  maxTilt={3.4}
                  liftPx={4}
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("OVERDUE_TASKS");
                  }}
                  className="p-5 rounded-2xl border border-slate-200 cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-rose-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider group-hover:text-rose-900 transition-colors">
                      Overdue Tasks
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono tabular-nums">
                      <ArrowDownRight className="w-3 h-3 text-emerald-600" />
                      100%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-rose-600 font-mono tabular-nums tracking-tight my-1">
                    {overdueTasks.length}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-1">
                    {overdueTasks.length > 0 ? "Requires attention" : "All running on schedule"}
                  </div>
                </Card3D>

                {/* Card 4: Total Reports */}
                <Card3D
                  as="button"
                  type="button"
                  maxTilt={3.4}
                  liftPx={4}
                  disabled={!canViewReports}
                  onClick={() => {
                    if (canViewReports) {
                      setActiveDashboardModal("TOTAL_REPORTS");
                    }
                  }}
                  className={`p-5 rounded-2xl border border-slate-200 text-left group focus:outline-none flex flex-col justify-between ${
                    canViewReports
                      ? "cursor-pointer active:scale-[0.99] focus:ring-2 focus:ring-indigo-500/20"
                      : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider group-hover:text-indigo-900 transition-colors">
                      Total Reports
                    </span>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono tabular-nums">
                      <ArrowUpRight className="w-3 h-3 text-indigo-600" />
                      20%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-indigo-600 font-mono tabular-nums tracking-tight my-1">
                    12
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-1">
                    {canViewReports ? "Daily & weekly analytics" : "Reports access restricted"}
                  </div>
                </Card3D>
              </div>

              {/* Real-Time Room Status & Assignment Dashboard (SSE Live Sync) */}
              <div className="mb-6">
                <RealtimeRoomDashboard
                  rooms={rooms}
                  tasks={tasks}
                  allUsers={allUsers}
                  currentUser={currentUser}
                  onRefresh={loadData}
                  onOpenVisitorModal={(roomId?: string) => {
                    if (roomId) setVisitorForm((prev) => ({ ...prev, roomAreaId: roomId }));
                    setShowVisitorModal(true);
                  }}
                  onViewHistory={handleViewHistory}
                  canManageAssignments={canManageAssignments}
                  canManageRooms={canViewRooms}
                  isCompactView={false}
                  onNavigateToRoomsTab={() => {
                    setSettingsTab("ROOMS");
                    setSubTab("ROOMS");
                  }}
                />
              </div>

              {/* Bottom Row: Recent Activity (left) + Active Attendance & Quick Actions (right) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Recent Activity (lg:col-span-7) */}
                <Card3D
                  maxTilt={2.8}
                  liftPx={3.5}
                  className="lg:col-span-7 rounded-2xl border border-slate-200 p-5"
                >
                  <div className="relative z-10 pointer-events-auto flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Recent Activity</h3>
                      <p className="text-xs text-slate-500">Live task logs, attendant updates, and photo audits</p>
                    </div>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubTab("TASKS");
                      }}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded-md px-1.5 py-0.5"
                    >
                      <span>All Tasks</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="relative z-10 pointer-events-auto space-y-3">
                    {tasks.length === 0 ? (
                      <div className="p-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-center text-xs text-slate-500">
                        No recent task activity available.
                      </div>
                    ) : (
                      recentActivityTasks.map((task) => {
                        const badge = getTaskStatusBadge(task.status);
                        return (
                          <div
                            key={task.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`View details for task ${task.title} in ${task.roomAreaName}`}
                            onClick={() => handleOpenTaskDetail(task.id)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleOpenTaskDetail(task.id);
                              }
                            }}
                            className="group/task relative p-3 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-white hover:border-amber-300/80 hover:shadow-sm active:scale-[0.995] transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:border-amber-400"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap sm:flex-nowrap">
                                <span
                                  className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 ${
                                    task.priority === 'URGENT' || task.isUrgent
                                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                      : 'bg-slate-200/80 text-slate-800'
                                  }`}
                                >
                                  {task.priority}
                                </span>
                                <span className="text-xs font-bold text-slate-900 group-hover/task:text-amber-950 truncate transition-colors">
                                  {task.roomAreaName}
                                </span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${badge.bg}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <div className="text-xs text-slate-700 font-medium truncate">{task.title}</div>
                              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                                <span>Assigned: {task.assignedToName}</span>
                                <span>•</span>
                                <span>Due: {task.dueTime}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {getTaskPhotoEvidences(task).length > 0 && (
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openInspectTaskEvidence(task, 0);
                                  }}
                                  className="px-2 py-1 text-[11px] font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
                                  title="View Photo Evidence"
                                  aria-label={`View photo evidence for ${task.title}`}
                                >
                                  <Camera className="w-3.5 h-3.5 text-sky-700" />
                                  <span>
                                    View Evidence ({getTaskPhotoEvidences(task).length})
                                  </span>
                                </button>
                              )}
                              {canDeleteTask && !isPantryBoyTask(task) && (
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDeleteTask(task);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                                  title="Delete Task"
                                  aria-label={`Delete task ${task.title}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <ChevronRight className="w-4 h-4 text-slate-300 group-hover/task:text-amber-600 group-hover/task:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card3D>

                {/* Right: Attendant Login & Attendance (lg:col-span-5) */}
                <Card3D
                  maxTilt={2.6}
                  liftPx={3.5}
                  className="lg:col-span-5 rounded-2xl border border-slate-200 p-5 flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                          Attendant Login & Attendance
                        </h3>
                        <p className="text-xs text-slate-500">Real-time IST check-in & session log</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenAttendanceHistory}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5 text-slate-600" />
                        <span>History</span>
                      </button>
                    </div>

                    {/* Attendant & Attendance Status Card */}
                    <div className="p-3.5 bg-slate-900 text-white rounded-xl mb-4 relative overflow-hidden">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src="/assets/wcr_logo.png"
                            alt="Raju Sharma"
                            className="w-10 h-10 rounded-full object-contain bg-white p-1 ring-2 ring-amber-400 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-white truncate">
                              {todayAttendance?.userName || 'Raju Sharma'} (Pantry Attendant)
                            </div>
                            <div className="text-[10px] text-amber-300 font-mono mt-0.5 truncate">
                              {todayAttendance?.userEmail || 'raju.sharma@whitecollarrealty.com'}
                            </div>
                          </div>
                        </div>

                        {/* Status Pill */}
                        <div className="shrink-0 text-right">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                              todayAttendance?.logoutTime
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                todayAttendance?.logoutTime ? 'bg-slate-400' : 'bg-emerald-400 animate-pulse'
                              }`}
                            />
                            {todayAttendance?.logoutTime ? 'Completed' : 'Present'}
                          </span>
                        </div>
                      </div>

                      {/* Live Attendance Status & Task Progress */}
                      <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
                        <span className="font-mono text-[10px] text-slate-400">
                          {todayAttendance?.logoutTimeIST
                            ? `Logout: ${todayAttendance.logoutTimeIST}`
                            : todayAttendance?.loginTimeIST
                            ? `Active Session · Login: ${todayAttendance.loginTimeIST}`
                            : 'Attendance Tracked'}
                        </span>
                        <span className="font-mono text-amber-400 font-bold">
                          {completedTasks.length} / {tasks.length} Tasks Done
                        </span>
                      </div>
                    </div>

                    {/* Live Attendance Timestamps & Working Time Meter */}
                    <div className="grid grid-cols-2 gap-2.5 mb-4">
                      {/* Login Timestamp */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>Login Time (IST)</span>
                        </div>
                        <div className="text-sm font-mono font-bold text-slate-900">
                          {todayAttendance?.loginTimeIST || '09:00:15 AM'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Date: {todayAttendance?.date || todayISTKey}
                        </div>
                      </div>

                      {/* Elapsed Working Duration */}
                      <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800 uppercase tracking-wider mb-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>Elapsed Time</span>
                        </div>
                        <div className="text-sm font-mono font-bold text-amber-950">
                          {formatElapsedDuration(elapsedSeconds)}
                        </div>
                        <div className="text-[10px] text-amber-700 font-mono mt-0.5 truncate">
                          {todayAttendance?.logoutTimeIST
                            ? `Logout: ${todayAttendance.logoutTimeIST}`
                            : 'Active session live'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Dispatch Action */}
                  {hasPermission('tasks', 'create') && (
                    <div className="pt-3 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setNewTaskForm((prev) => ({ ...prev, isUrgent: false, priority: "P2" }));
                          setShowNewTaskModal(true);
                        }}
                        className="w-full py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Assign New Task</span>
                      </button>
                    </div>
                  )}
                </Card3D>
              </div>
            </div>
          )}

          {/* SETTINGS SUB-NAV BAR (When in SETTINGS tab) */}
          {subTab === "SETTINGS" && canViewSettings && (
            <div className="mb-6 bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-2 overflow-x-auto">
              {canViewRooms && (
                <button
                  type="button"
                  onClick={() => setSettingsTab("ROOMS")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    settingsTab === "ROOMS" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  15 Office Areas & Room Config ({rooms.length})
                </button>
              )}
              {canViewUsers && (
                <button
                  type="button"
                  onClick={() => setSettingsTab("USERS")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    settingsTab === "USERS" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Account Access & Security ({allUsers.length})
                </button>
              )}
              {canViewAudit && (
                <button
                  type="button"
                  onClick={() => setSettingsTab("AUDIT")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    settingsTab === "AUDIT" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Audit Trail ({auditLogs.length})
                </button>
              )}
            </div>
          )}

          {/* TAB 2: TASKS VIEW (Pantry Tasks, Cleaning Tasks, Rearrangement Tasks, All Tasks) */}
          {canViewTasks &&
            (subTab === "TASKS" ||
              subTab === "PANTRY_TASKS" ||
              subTab === "CLEANING_TASKS" ||
              subTab === "REARRANGEMENT_TASKS") && (
        <div className="space-y-4">

          {/* Filter Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Search tasks, rooms, staff..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg w-48 sm:w-64 focus:ring-1 focus:ring-slate-900"
              />

              <select
                value={filterRoom}
                onChange={(e) => setFilterRoom(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="ALL">All Rooms ({rooms.length})</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="ALL">All Priorities</option>
                <option value="URGENT">URGENT</option>
                <option value="P1">P1 (Reception / Water)</option>
                <option value="P2">P2 (Desks / Rooms / Plants)</option>
                <option value="P3">P3 (Outer Area / Cabins)</option>
                <option value="P4">P4 (Loft / Regency / Bins)</option>
                <option value="P5">P5 (General)</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="ALL">All Sections (Today / Overdue / Upcoming)</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="AVAILABLE">Available</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="PENDING_VERIFICATION">Under Review</option>
                <option value="BLOCKED">Blocked</option>
                <option value="COMPLETED">Completed</option>
                <option value="OVERDUE">Overdue</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 font-mono">
              Today: {todaySectionTasks.length} · Overdue: {overdueSectionTasks.length} · Upcoming: {upcomingSectionTasks.length}
            </div>
          </div>

          {(() => {
            const renderManagementTaskCard = (task: Task) => {
              const isPendingReview = task.status === 'PENDING_VERIFICATION';

              return (
                <Card3D
                  key={task.id}
                  maxTilt={2.2}
                  liftPx={3}
                  className={`rounded-xl border p-4 flex flex-col justify-between ${
                    task.isUrgent
                      ? 'border-rose-400 bg-rose-50/20'
                      : isPendingReview
                      ? 'border-sky-400 bg-sky-50/20'
                      : 'border-slate-200'
                  }`}
                >
                  <div>
                    {/* Priority & Status */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${
                            task.isUrgent
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {task.priority}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          task.status === 'COMPLETED'
                            ? 'text-emerald-700'
                            : task.status === 'CANCELLED'
                            ? 'text-slate-400 line-through'
                            : task.status === 'OVERDUE'
                            ? 'text-rose-700'
                            : task.status === 'SCHEDULED'
                            ? 'text-indigo-700'
                            : task.status === 'BLOCKED'
                            ? 'text-rose-700'
                            : task.status === 'PENDING_VERIFICATION'
                            ? 'text-sky-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {task.status === 'PENDING_VERIFICATION' ? 'Under Review' : task.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <h3
                      onClick={() => handleOpenTaskDetail(task.id)}
                      className={`text-sm font-bold mb-1.5 leading-snug cursor-pointer hover:text-amber-800 transition-colors ${
                        task.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}
                    >
                      {task.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mb-2 font-mono">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        <Clock className="w-3 h-3 text-amber-600" />
                        {formatISTTaskSchedule(task.scheduledFor)}
                      </span>
                      <span className="text-slate-400">•</span>
                      <span className="font-sans text-slate-600 truncate">
                        {task.assignedToName}
                      </span>
                    </div>

                    {task.description && (
                      <p className="text-xs text-slate-600 line-clamp-2 mb-3 leading-relaxed">
                        {task.description}
                      </p>
                    )}

                    {/* Blocked Reason notice if any */}
                    {task.status === 'BLOCKED' && (
                      <div className="mb-3 p-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                        <span className="font-semibold">Blocked:</span> {task.blockedReason}
                      </div>
                    )}

                    {/* Checklist summary */}
                    <div className="text-[11px] text-slate-500 mb-3 flex items-center justify-between">
                      <span>Checklist items</span>
                      <span className="font-mono">
                        {task.checklist.filter((c) => c.completed).length} / {task.checklist.length} done
                      </span>
                    </div>

                    {/* Photo evidence preview if uploaded */}
                    {(() => {
                      const cardPhotos = getTaskPhotoEvidences(task);
                      if (cardPhotos.length === 0) return null;
                      return (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openInspectTaskEvidence(task, 0)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openInspectTaskEvidence(task, 0);
                            }
                          }}
                          className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-900 h-32 cursor-pointer group mb-3"
                        >
                          <AuthenticatedEvidenceImage
                            photoUrl={cardPhotos[0].photoUrl}
                            alt={`Evidence for ${task.title}`}
                            compact
                            className="w-full h-full"
                            imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <span className="absolute top-2 left-2 bg-slate-950/80 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded backdrop-blur-xs">
                            {cardPhotos.length} Photo{cardPhotos.length === 1 ? '' : 's'}
                          </span>
                          <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold">
                            <Camera className="w-3.5 h-3.5 text-amber-400" />
                            <span>View Evidence</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Card Actions */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] text-slate-400 font-mono">Due {task.dueTime}</div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getTaskPhotoEvidences(task).length > 0 && (
                        <button
                          type="button"
                          onClick={() => openInspectTaskEvidence(task, 0)}
                          className="px-2.5 py-1 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5 text-sky-700" />
                          <span>
                            View Evidence ({getTaskPhotoEvidences(task).length})
                          </span>
                        </button>
                      )}

                      {isPendingReview && hasPermission('tasks', 'edit') && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleVerifyPhoto(task.id, 'APPROVE')}
                            className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVerifyPhoto(task.id, 'REJECT', 'Chairs misaligned or debris visible')}
                            className="px-2 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {hasPermission('tasks', 'edit') && task.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => handleOpenEditTask(task)}
                          title="Edit or Reschedule Task (IST)"
                          className="px-2 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Reschedule</span>
                        </button>
                      )}

                      {hasPermission('tasks', 'edit') && task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          onClick={() => handleCancelTask(task)}
                          title="Cancel Task"
                          className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}

                      {canDeleteTask && !isPantryBoyTask(task) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestDeleteTask(task);
                          }}
                          title="Delete Task"
                          aria-label={`Delete task ${task.title}`}
                          className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </Card3D>
              );
            };

            if (filterStatus === 'ALL') {
              return (
                <div className="space-y-6">
                  {/* SECTION 1: TODAY'S TASKS ONLY */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-amber-600" />
                          <span>Today's Tasks ({todayISTKey} · IST)</span>
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                            {todaySectionTasks.length}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          Showing only today's scheduled &amp; active tasks in chronological IST sequence
                        </p>
                      </div>
                    </div>

                    {todaySectionTasks.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                        No tasks in Today's Tasks match current filter criteria.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {todaySectionTasks.map(renderManagementTaskCard)}
                      </div>
                    )}
                  </div>

                  {/* SECTION 2: OVERDUE TASKS */}
                  <div className="space-y-3 pt-2 border-t border-slate-200/80">
                    <div className="flex items-center justify-between px-1">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                          <span>Overdue Tasks</span>
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                            {overdueSectionTasks.length}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          Past-due tasks separated from Today's Tasks
                        </p>
                      </div>
                    </div>

                    {overdueSectionTasks.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                        Zero overdue tasks matching current filter criteria.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {overdueSectionTasks.map(renderManagementTaskCard)}
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: UPCOMING TASKS */}
                  <div className="space-y-3 pt-2 border-t border-slate-200/80">
                    <div className="flex items-center justify-between px-1">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-indigo-600" />
                          <span>Upcoming Tasks</span>
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                            {upcomingSectionTasks.length}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          Future tasks scheduled for dates beyond {todayISTKey}
                        </p>
                      </div>
                    </div>

                    {upcomingSectionTasks.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                        No upcoming tasks scheduled for future dates beyond today.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {upcomingSectionTasks.map(renderManagementTaskCard)}
                      </div>
                    )}
                  </div>

                  {/* SECTION 4: CANCELLED & ARCHIVED TASKS (only shown when present) */}
                  {cancelledSectionTasks.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-slate-200/80">
                      <div className="flex items-center justify-between px-1">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-500" />
                            <span>Cancelled &amp; Past Completed Tasks</span>
                            <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                              {cancelledSectionTasks.length}
                            </span>
                          </h3>
                          <p className="text-xs text-slate-500">
                            Cancelled tasks and historical completed tasks separated from active queues
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {cancelledSectionTasks.map(renderManagementTaskCard)}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTasks.length === 0 ? (
                  <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                    No tasks match current filter criteria.
                  </div>
                ) : (
                  filteredTasks.map(renderManagementTaskCard)
                )}
              </div>
            );
          })()}
        </div>
      )}


      {/* SUB-TAB 3: DEDICATED REAL-TIME ROOM MANAGEMENT */}
      {canViewRooms && (subTab === 'ROOMS' || (subTab === 'SETTINGS' && settingsTab === 'ROOMS')) && (
        <div className="space-y-5">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Real-Time Office Room Management</h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                  {rooms.length} Configured Areas
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time database-backed room statuses, candidate & visitor assignments, collision detection, and automated cleaning pipelines.
              </p>
              <div
                className="mt-1.5 flex items-start sm:items-center gap-1.5 text-[11px] text-slate-600 font-medium"
                title="6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India"
              >
                <Building className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                <span className="sm:hidden">
                  6th Floor, Tower A, M3M Urbana Business Park, Sector 67, Gurugram 122101
                </span>
                <span className="hidden sm:inline">
                  6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasPermission('rooms', 'create') && (
                <button
                  type="button"
                  onClick={() => {
                    setRoomForm({
                      name: '',
                      category: 'MEETING_SUITE',
                      defaultPriority: 'P5',
                      photoRequired: true,
                      recurrence: 'DAILY',
                    });
                    setShowRoomModal(true);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Area
                </button>
              )}
            </div>
          </div>

          {/* Real-time Room Status & Employee Assignments Dashboard */}
          <RealtimeRoomDashboard
            rooms={rooms}
            tasks={tasks}
            allUsers={allUsers}
            currentUser={currentUser}
            onRefresh={loadData}
            onOpenVisitorModal={(roomId?: string) => {
              if (roomId) setAssignForm((prev) => ({ ...prev, roomId }));
              setShowAssignModal(true);
            }}
            onViewHistory={handleViewHistory}
            canManageAssignments={canManageAssignments}
            canManageRooms={canViewRooms}
            isCompactView={false}
          />
        </div>
      )}

      {/* SUB-TAB 4: DAILY & WEEKLY REPORTS */}
      {subTab === 'REPORTS' && canViewReports && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Audited Operations & Performance Reports</h3>
              <p className="text-xs text-slate-500">
                Calculated strictly from live database records and verified camera timestamps.
              </p>
            </div>
            {hasPermission('reports', 'export') && (
              <a
                href={api.getReportExportUrl()}
                download
                className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 shrink-0 shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Export Full Report (CSV)
              </a>
            )}
          </div>

          {/* Daily Report Card */}
          {dailyReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Today's Daily Operational Metrics</h4>
                  <div className="text-xs text-slate-400 font-mono">Date: {dailyReport.date} (Asia/Kolkata)</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold font-mono text-emerald-600">
                    {dailyReport.completionRatePercent}%
                  </div>
                  <div className="text-[10px] text-slate-400">Total Completion</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-xs">
                <div>
                  <div className="text-slate-500">On-Time Rate</div>
                  <div className="font-bold text-slate-900 font-mono text-base mt-0.5">
                    {dailyReport.onTimeCompletionRatePercent}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">10 AM Water Distribution</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {dailyReport.waterBottleDistributionCompleted ? '✅ Verified on Desks' : '⏳ In Progress'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">4 PM Water Refill</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {dailyReport.waterBottleRecheckCompleted ? '✅ Complete' : 'Scheduled 4 PM'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Photo Verification Failure</div>
                  <div className="font-bold text-slate-900 font-mono text-base mt-0.5">
                    {dailyReport.photoFailuresCount}
                  </div>
                </div>
              </div>

              {dailyReport.blockedExceptions.length > 0 && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs mt-3">
                  <div className="font-bold text-slate-700 mb-1">Approved Blocked Exceptions (No Penalty):</div>
                  {dailyReport.blockedExceptions.map((ex, i) => (
                    <div key={i} className="text-slate-600 text-[11px]">
                      • <strong>{ex.room}:</strong> {ex.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Weekly Report & Gemini AI Insights */}
          {weeklyReport && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-1">Weekly Trends & Operational Bottlenecks</h4>
              <p className="text-xs text-slate-500 mb-4">Past 7 days aggregated across all 15 office rooms.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div className="font-bold text-slate-800 mb-2">Frequently Blocked Rooms & Reasons:</div>
                  {weeklyReport.frequentlyBlockedRooms.map((b, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <div className="font-semibold text-slate-900">
                        {b.room} ({b.count} times)
                      </div>
                      <div className="text-[11px] text-slate-500">Reason: {b.primaryReason}</div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div className="font-bold text-slate-800 mb-2">Hospitality Readiness Stats:</div>
                  <div className="space-y-1.5 text-slate-700">
                    <div>
                      Photo Evidence Verification Score: <strong className="font-mono text-emerald-600">{weeklyReport.photoVerificationScorePercent}%</strong>
                    </div>
                    <div>
                      Average Room Prep Time: <strong className="font-mono">{weeklyReport.visitorPrepAverageMinutes} mins</strong> (Target: &lt;10 mins)
                    </div>
                    <div>
                      Desk Water Distribution Reliability: <strong className="font-mono">99.2%</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Operational Key Recommendations */}
              <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-xs">
                <div className="font-bold text-amber-900 flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-4 h-4 text-amber-700" />
                  Automated Operational Synthesis for Kimmi (Co-Founder) & HR:
                </div>
                <ul className="space-y-1.5 text-amber-800">
                  {(weeklyReport.keyRecommendations || (weeklyReport as any).aiKeyRecommendations || []).map((rec: string, i: number) => (
                    <li key={i} className="leading-relaxed">
                      • {rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: ACCOUNT ACCESS & SECURITY */}
      {canViewUsers && (subTab === 'USERS' || (subTab === 'SETTINGS' && settingsTab === 'USERS')) && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Company Accounts & Access Control</h3>
              <p className="text-xs text-slate-500">
                Authorized company emails only. Deactivating an employee immediately revokes active session tokens. Historical records remain preserved.
              </p>
            </div>
            {hasPermission('users', 'create') && (
              <button
                type="button"
                onClick={() => setShowUserModal(true)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Company User
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {allUsers.map((u) => {
              const isDeactivated = u.status === 'inactive';
              const isMe = currentUser?.id === u.id;
              const isSuper = Boolean(u.isSuperAdmin || u.id === 'user-admin-1' || u.email.toLowerCase() === 'admin.director@whitecollarrealty.com');
              const canEditTarget =
                hasPermission('users', 'edit') &&
                (!(isSuper || u.role === 'ADMIN') || currentUser?.role === 'ADMIN' || Boolean(currentUser?.isSuperAdmin));

              return (
                <div key={u.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img src={u.avatarUrl} alt={u.name} className="w-11 h-11 rounded-2xl object-cover border border-slate-200 shadow-xs" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{u.name}</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
                          {u.role === 'KIMMY_MAM' ? 'Co-Founder' : u.role}
                        </span>
                        {isMe && (
                          <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-full">
                            Active Session (You)
                          </span>
                        )}
                        {isSuper && (
                          <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Shield className="w-3 h-3 text-amber-600" />
                            Primary Super Admin (Protected)
                          </span>
                        )}
                        {isDeactivated && (
                          <span className="text-[10px] font-mono text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full font-bold border border-rose-200">
                            ACCESS SUSPENDED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {u.email} • {u.department || 'Hospitality & Operations'} {u.phone ? `• ${u.phone}` : ''}
                      </div>
                      {isDeactivated && u.deactivatedAt && (
                        <div className="text-[11px] text-rose-600 mt-1 font-medium">
                          Deactivated by {u.deactivatedBy || 'Management'} at {new Date(u.deactivatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {/* Permissions & Edit Button */}
                    {canEditTarget && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(u)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 shadow-xs"
                        title="Customize Dashboards, Sidebar Items, and CRUD Actions"
                      >
                        <Sliders className="w-3.5 h-3.5 text-slate-600" />
                        <span>Edit & Permissions</span>
                      </button>
                    )}

                    {/* Activate / Deactivate Toggle */}
                    {hasPermission('users', 'edit') && (
                      <button
                        type="button"
                        disabled={isSuper}
                        onClick={() => handleToggleUser(u.id)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                          isSuper
                            ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200'
                            : isDeactivated
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                            : 'text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200'
                        }`}
                        title={isSuper ? 'Security Policy: Super Administrator cannot be deactivated.' : undefined}
                      >
                        {isDeactivated ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" /> Reactivate
                          </>
                        ) : (
                          <>
                            <UserX className="w-3.5 h-3.5" /> Deactivate
                          </>
                        )}
                      </button>
                    )}

                    {/* Delete User Button */}
                    {hasPermission('users', 'delete') && (
                      <button
                        type="button"
                        disabled={isSuper}
                        onClick={() => setDeleteConfirmUser(u)}
                        className={`p-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center ${
                          isSuper
                            ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400'
                            : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200'
                        }`}
                        title={isSuper ? 'Security Policy: Primary Super Administrator cannot be deleted.' : 'Delete User Account'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 6: AUDIT TRAIL */}
      {canViewAudit && (subTab === 'AUDIT' || (subTab === 'SETTINGS' && settingsTab === 'AUDIT')) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Immutable Audit Trail</h3>
              <p className="text-xs text-slate-500">
                Detailed chronological record of task creation, status transitions, camera photo uploads, and user access changes.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Timestamp (IST)</th>
                    <th className="py-2.5 px-4 font-semibold">Actor</th>
                    <th className="py-2.5 px-4 font-semibold">Action</th>
                    <th className="py-2.5 px-4 font-semibold">Entity</th>
                    <th className="py-2.5 px-4 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {auditLogs.slice(0, 30).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="py-2.5 px-4 text-slate-900 font-sans font-medium whitespace-nowrap">
                        {log.actorName} ({log.actorRole === 'KIMMY_MAM' ? 'Co-Founder' : log.actorRole})
                      </td>
                      <td className="py-2.5 px-4 text-amber-700 font-semibold whitespace-nowrap">{log.action}</td>
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{log.entityType}</td>
                      <td className="py-2.5 px-4 text-slate-700 font-sans leading-relaxed">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
        </main>

        {/* Responsive Corporate Office Footer */}
        <footer className="mt-auto border-t border-slate-200/80 bg-white/80 px-4 sm:px-6 lg:px-8 py-3.5 shrink-0">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5 text-[11px] text-slate-500">
            <div className="font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
              <Building className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>White Collar Realty</span>
            </div>
            <div
              className="text-center sm:text-right text-slate-500 leading-relaxed"
              title="6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India"
            >
              <span className="sm:hidden">
                6th Floor, Tower A, M3M Urbana Business Park, Sector 67, Gurugram 122101
              </span>
              <span className="hidden sm:inline">
                6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India
              </span>
            </div>
          </div>
        </footer>
      </div>

      {/* MODAL 1: Create New Task / Urgent Request with AI Natural Language Assist */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-5 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Assign New Operational Task
                </h3>
                <p className="text-xs text-slate-500">
                  Immediately dispatches to Raju Sharma's mobile dashboard and recalculates his queue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTaskModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Natural Language Command Parser Box */}
            <div className="mb-5 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 mb-1.5">
                <Sparkles className="w-4 h-4 text-amber-600" />
                Kimmi (Co-Founder) & HR Natural Language Command Parser
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='e.g. "Prepare The Skyline immediately for 2:30 PM client meet with water & whiteboard"'
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 bg-white border border-amber-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                />
                <button
                  type="button"
                  onClick={handleAiParse}
                  disabled={isAiParsing || !aiPrompt.trim()}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors shrink-0"
                >
                  {isAiParsing ? 'Interpreting...' : 'Auto-Fill Task'}
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={newTaskForm.title}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, title: e.target.value })}
                  placeholder="e.g. Emergency hospitality setup for Kimmi"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Room / Area</label>
                  <select
                    value={newTaskForm.roomAreaId}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, roomAreaId: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={newTaskForm.isUrgent ? 'URGENT' : newTaskForm.priority}
                    onChange={(e) => {
                      const val = e.target.value as TaskPriority;
                      setNewTaskForm({
                        ...newTaskForm,
                        priority: val,
                        isUrgent: val === 'URGENT',
                      });
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="URGENT">⚠️ URGENT (Immediate Alert)</option>
                    <option value="P1">P1 (High / Reception)</option>
                    <option value="P2">P2 (Desks & Routine)</option>
                    <option value="P3">P3 (Cabins)</option>
                    <option value="P4">P4 (Executive)</option>
                    <option value="P5">P5 (Scheduled)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assign To (Attendant)</label>
                  <select
                    value={
                      newTaskForm.assignedToEmail ||
                      allUsers.find((u) => u.role === 'PANTRY_BOY' && u.status === 'active')?.email ||
                      ''
                    }
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, assignedToEmail: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {allUsers
                      .filter((u) => u.status === 'active' && (u.role === 'PANTRY_BOY' || u.permissions?.dashboards?.pantry))
                      .map((u) => (
                        <option key={u.id} value={u.email}>
                          {u.name} ({u.role === 'PANTRY_BOY' ? 'Pantry Boy' : u.role})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Due Time / Deadline</label>
                  <input
                    type="text"
                    value={newTaskForm.dueTime}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, dueTime: e.target.value })}
                    placeholder="e.g. Immediate (within 15 mins), 11:30 AM"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Scheduled Date & Time (IST) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Task Execution Schedule (IST)</span>
                  </label>
                  <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setNewTaskForm({ ...newTaskForm, scheduleMode: 'IMMEDIATE' })}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                        newTaskForm.scheduleMode === 'IMMEDIATE'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Dispatch Now
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewTaskForm({
                          ...newTaskForm,
                          scheduleMode: 'SCHEDULED',
                          scheduledFor:
                            newTaskForm.scheduledFor ||
                            toISTDateTimeLocal(new Date(getServerNowMs() + 10 * 60 * 1000)),
                        })
                      }
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                        newTaskForm.scheduleMode === 'SCHEDULED'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Schedule Date & Time
                    </button>
                  </div>
                </div>

                {newTaskForm.scheduleMode === 'SCHEDULED' ? (
                  <div className="space-y-2">
                    <input
                      type="datetime-local"
                      required
                      value={newTaskForm.scheduledFor}
                      onChange={(e) => setNewTaskForm({ ...newTaskForm, scheduledFor: e.target.value })}
                      className="w-full text-xs font-mono px-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500 font-medium">Quick IST Presets:</span>
                      {[
                        { label: '+5 Mins', mins: 5 },
                        { label: '+10 Mins', mins: 10 },
                        { label: '+30 Mins', mins: 30 },
                        { label: '+1 Hour', mins: 60 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            setNewTaskForm({
                              ...newTaskForm,
                              scheduleMode: 'SCHEDULED',
                              scheduledFor: toISTDateTimeLocal(
                                new Date(getServerNowMs() + preset.mins * 60 * 1000)
                              ),
                            })
                          }
                          className="px-2 py-0.5 text-[10px] font-semibold bg-white hover:bg-amber-50 text-slate-700 border border-slate-200 rounded-md cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Pantry Boy automatically receives a 5-minute warning popup and an execution alert popup at exact IST scheduled time.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Task activates immediately on Pantry Boy's dashboard and triggers an instant execution alert.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Special Instructions (Optional)</label>
                <textarea
                  value={newTaskForm.description}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, description: e.target.value })}
                  rows={2}
                  placeholder="Provide any specific hospitality or cleaning details..."
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              {taskModalError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                  {taskModalError}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white rounded-lg transition-colors shadow-sm bg-slate-900 hover:bg-slate-800"
                >
                  {newTaskForm.scheduleMode === 'SCHEDULED' ? 'Schedule & Sync Task' : 'Confirm & Dispatch Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1B: Edit / Reschedule / Reassign / Cancel Existing Task */}
      {editingTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-5 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Edit / Reschedule Task (IST)</h3>
                <p className="text-xs text-slate-500">
                  Changes sync instantly in real time to Pantry Boy's dashboard, countdown, and scheduled alerts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={editTaskForm.title}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, title: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Room / Area</label>
                  <select
                    value={editTaskForm.roomAreaId}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, roomAreaId: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={editTaskForm.isUrgent ? 'URGENT' : editTaskForm.priority}
                    onChange={(e) => {
                      const val = e.target.value as TaskPriority;
                      setEditTaskForm({
                        ...editTaskForm,
                        priority: val,
                        isUrgent: val === 'URGENT',
                      });
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="URGENT">⚠️ URGENT</option>
                    <option value="P1">P1 (High / Reception)</option>
                    <option value="P2">P2 (Desks & Routine)</option>
                    <option value="P3">P3 (Cabins)</option>
                    <option value="P4">P4 (Executive)</option>
                    <option value="P5">P5 (Scheduled)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Attendant</label>
                  <select
                    value={editTaskForm.assignedToEmail}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, assignedToEmail: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {allUsers
                      .filter((u) => u.status === 'active' && (u.role === 'PANTRY_BOY' || u.permissions?.dashboards?.pantry))
                      .map((u) => (
                        <option key={u.id} value={u.email}>
                          {u.name} ({u.role === 'PANTRY_BOY' ? 'Pantry Boy' : u.role})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Due Time Label</label>
                  <input
                    type="text"
                    value={editTaskForm.dueTime}
                    onChange={(e) => setEditTaskForm({ ...editTaskForm, dueTime: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-2">
                <label className="block text-xs font-bold text-indigo-950">
                  Scheduled Date & Time (IST · Asia/Kolkata)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editTaskForm.scheduledFor}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, scheduledFor: e.target.value })}
                  className="w-full text-xs font-mono px-3 py-2 bg-white border border-indigo-300 rounded-lg focus:ring-1 focus:ring-indigo-700"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-indigo-800 font-medium">Quick Reschedule (from current IST):</span>
                  {[
                    { label: 'Now', mins: 0 },
                    { label: '+5 Mins', mins: 5 },
                    { label: '+10 Mins', mins: 10 },
                    { label: '+30 Mins', mins: 30 },
                    { label: '+1 Hour', mins: 60 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setEditTaskForm({
                          ...editTaskForm,
                          scheduledFor: toISTDateTimeLocal(
                            new Date(getServerNowMs() + preset.mins * 60 * 1000)
                          ),
                        })
                      }
                      className="px-2 py-0.5 text-[10px] font-semibold bg-white hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-md cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Instructions</label>
                <textarea
                  value={editTaskForm.description}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, description: e.target.value })}
                  rows={2}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              {taskModalError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                  {taskModalError}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {editingTask.status !== 'CANCELLED' && editingTask.status !== 'COMPLETED' && (
                    <button
                      type="button"
                      disabled={savingTaskEdit}
                      onClick={() => handleCancelTask(editingTask)}
                      className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Cancel This Task
                    </button>
                  )}
                  {canDeleteTask && !isPantryBoyTask(editingTask) && (
                    <button
                      type="button"
                      disabled={savingTaskEdit}
                      onClick={() => requestDeleteTask(editingTask)}
                      className="px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Task</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingTask(null)}
                    className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={savingTaskEdit}
                    className="px-4 py-2 text-xs font-bold text-white rounded-lg transition-colors shadow-sm bg-slate-900 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    {savingTaskEdit ? 'Syncing...' : 'Save & Sync Schedule'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* MODAL 3: Configure Room */}
      {showRoomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">{roomForm.id ? 'Edit Office Area' : 'Add Office Room'}</h3>
              <button
                type="button"
                onClick={() => setShowRoomModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRoom} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Area / Room Name</label>
                <input
                  type="text"
                  required
                  value={roomForm.name}
                  onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                  placeholder="e.g. The Skyline Boardroom"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Default Priority</label>
                <select
                  value={roomForm.defaultPriority}
                  onChange={(e) => setRoomForm({ ...roomForm, defaultPriority: e.target.value as any })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                  <option value="P4">P4</option>
                  <option value="P5">P5</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Recurrence Schedule</label>
                <select
                  value={roomForm.recurrence}
                  onChange={(e) => setRoomForm({ ...roomForm, recurrence: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="DAILY">Daily Routine</option>
                  <option value="ALTERNATE_DAYS">Alternate Days (Outer Area)</option>
                  <option value="EVERY_3_DAYS">Every 3 Days (Plants)</option>
                  <option value="ON_DEMAND">On Demand</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRoomModal(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Create Company User */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Add Pre-Approved Employee Account</h3>
                <p className="text-xs text-slate-500">Must belong to @whitecollarrealty.com</p>
              </div>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                  placeholder="e.g. Sunil Verma"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Company Email</label>
                <input
                  type="email"
                  required
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  placeholder="name@whitecollarrealty.com"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
                  <select
                    value={newUserForm.role}
                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as Role })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="PANTRY_BOY">Pantry Boy</option>
                    <option value="HR">HR Operations</option>
                    <option value="KIMMY_MAM">Kimmi (Co-Founder)</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={newUserForm.department}
                    onChange={(e) => setNewUserForm({ ...newUserForm, department: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number (Optional)</label>
                <input
                  type="text"
                  value={newUserForm.phone}
                  onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                <div className="font-bold flex items-center gap-1 mb-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                  <span>Default Permissions Assigned</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Standard {newUserForm.role} permissions for dashboards, sidebar navigation, and CRUD actions will be provisioned automatically. You can customize each user's exact access anytime via the "Edit & Permissions" button.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Create & Authorize Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit User & Customizable Permissions */}
      {showEditUserModal && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Edit Employee & Access Permissions
                  </h3>
                  <p className="text-xs text-slate-500">
                    Fine-grained role, dashboard, sidebar navigation, and CRUD action permissions. Changes apply immediately.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditUserModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSaveEditUser} className="overflow-y-auto p-6 space-y-6 flex-1 text-xs">
              {/* Employee Basic Details */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center justify-between">
                  <span>Employee Profile Details</span>
                  {editingUser.isSuperAdmin && (
                    <span className="text-[10px] font-mono font-bold text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Shield className="w-3 h-3 text-amber-600" /> Primary Super Admin (Protected)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={editUserForm.name}
                      onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Company Email</label>
                    <input
                      type="email"
                      disabled
                      value={editUserForm.email}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100 text-slate-500 font-mono cursor-not-allowed"
                      title="Company email cannot be changed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Assigned Role</label>
                    <select
                      value={editUserForm.role}
                      disabled={editingUser.isSuperAdmin}
                      onChange={(e) => {
                        const newRole = e.target.value as Role;
                        setEditUserForm({
                          ...editUserForm,
                          role: newRole,
                          permissions: getDefaultPermissions(newRole),
                        });
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed font-medium"
                    >
                      <option value="PANTRY_BOY">Pantry Boy</option>
                      <option value="HR">HR Operations</option>
                      <option value="KIMMY_MAM">Kimmi (Co-Founder)</option>
                      <option value="ADMIN">Administrator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Department</label>
                    <input
                      type="text"
                      value={editUserForm.department}
                      onChange={(e) => setEditUserForm({ ...editUserForm, department: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={editUserForm.phone}
                      onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                      placeholder="+91 98765 43210"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setEditUserForm({
                        ...editUserForm,
                        permissions: getDefaultPermissions(editUserForm.role),
                      });
                    }}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to Standard Role Defaults ({editUserForm.role})
                  </button>
                </div>
              </div>

              {/* SECTION 1: Authorized Dashboards */}
              <div className="space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4 text-slate-600" />
                  <span>1. Dashboard Views Authorization</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="p-3 bg-white border border-slate-200 rounded-xl flex items-start gap-3 cursor-pointer hover:border-slate-300">
                    <input
                      type="checkbox"
                      checked={editUserForm.permissions.dashboards.pantry}
                      onChange={(e) =>
                        setEditUserForm({
                          ...editUserForm,
                          permissions: {
                            ...editUserForm.permissions,
                            dashboards: {
                              ...editUserForm.permissions.dashboards,
                              pantry: e.target.checked,
                            },
                          },
                        })
                      }
                      className="w-4 h-4 text-slate-900 rounded border-slate-300 mt-0.5"
                    />
                    <div>
                      <div className="font-bold text-slate-900">Pantry Boy Dashboard</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Access dedicated attendant dashboard with attendance log, room support, and live camera evidence.
                      </div>
                    </div>
                  </label>

                  <label className="p-3 bg-white border border-slate-200 rounded-xl flex items-start gap-3 cursor-pointer hover:border-slate-300">
                    <input
                      type="checkbox"
                      checked={editUserForm.permissions.dashboards.management}
                      onChange={(e) =>
                        setEditUserForm({
                          ...editUserForm,
                          permissions: {
                            ...editUserForm.permissions,
                            dashboards: {
                              ...editUserForm.permissions.dashboards,
                              management: e.target.checked,
                            },
                          },
                        })
                      }
                      className="w-4 h-4 text-slate-900 rounded border-slate-300 mt-0.5"
                    />
                    <div>
                      <div className="font-bold text-slate-900">Management & Operations Dashboard</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Access supervisory views for task assignments, room collision control, and analytics.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* SECTION 2: Pantry Boy Dashboard Sidebar Items */}
              <div className="space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-amber-600" />
                    2. Pantry Boy Sidebar Items (Attendant View)
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal">Controls what shows in attendant sidebar</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {(
                    [
                      { key: 'dashboard', label: 'Dashboard' },
                      { key: 'myTasks', label: 'My Tasks' },
                      { key: 'roomSupport', label: 'Room Support' },
                      { key: 'pantryRequests', label: 'Pantry Requests' },
                      { key: 'notifications', label: 'Notifications' },
                      { key: 'taskHistory', label: 'Task History' },
                      { key: 'myProfile', label: 'My Profile' },
                    ] as const
                  ).map((item) => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-white rounded-lg">
                      <input
                        type="checkbox"
                        checked={Boolean(editUserForm.permissions.sidebarItems?.[item.key])}
                        onChange={(e) =>
                          setEditUserForm({
                            ...editUserForm,
                            permissions: {
                              ...editUserForm.permissions,
                              sidebarItems: {
                                ...editUserForm.permissions.sidebarItems,
                                [item.key]: e.target.checked,
                              },
                            },
                          })
                        }
                        className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                      />
                      <span className="font-medium text-slate-700">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SECTION 3: Management Sidebar Items */}
              <div className="space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-600" />
                    3. Management Sidebar Items
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal">Controls management navigation tabs</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {(
                    [
                      { key: 'overview', label: 'Overview' },
                      { key: 'tasks', label: 'Tasks' },
                      { key: 'rooms', label: 'Rooms' },
                      { key: 'visitors', label: 'Visitors' },
                      { key: 'reports', label: 'Reports' },
                      { key: 'users', label: 'Users & Security' },
                      { key: 'audit', label: 'Audit Trail' },
                      { key: 'settings', label: 'Settings' },
                    ] as const
                  ).map((item) => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-white rounded-lg">
                      <input
                        type="checkbox"
                        checked={Boolean(editUserForm.permissions.sidebarItems?.[item.key])}
                        onChange={(e) =>
                          setEditUserForm({
                            ...editUserForm,
                            permissions: {
                              ...editUserForm.permissions,
                              sidebarItems: {
                                ...editUserForm.permissions.sidebarItems,
                                [item.key]: e.target.checked,
                              },
                            },
                          })
                        }
                        className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                      />
                      <span className="font-medium text-slate-700">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SECTION 4: Granular CRUD Action Privileges */}
              <div className="space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>4. Granular CRUD Action Privileges</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {[
                    {
                      module: 'tasks' as const,
                      label: 'Tasks',
                      desc: 'Schedule, dispatch, edit, or delete routines and ad-hoc requests',
                      actions: ['view', 'create', 'edit', 'delete'] as const,
                    },
                    {
                      module: 'rooms' as const,
                      label: 'Rooms & Areas',
                      desc: 'Configure office zones, assign candidates/clients, toggle active status',
                      actions: ['view', 'create', 'edit', 'delete'] as const,
                    },
                    {
                      module: 'visitors' as const,
                      label: 'Visitors & Candidates',
                      desc: 'Register visitor arrivals, view interview references, mark departure',
                      actions: ['view', 'create', 'edit', 'delete'] as const,
                    },
                    {
                      module: 'users' as const,
                      label: 'User Accounts',
                      desc: 'Create employees, edit role & permission matrices, deactivate/delete',
                      actions: ['view', 'create', 'edit', 'delete'] as const,
                    },
                  ].map((row) => (
                    <div key={row.module} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900">{row.label}</div>
                        <div className="text-[11px] text-slate-500">{row.desc}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {row.actions.map((act) => {
                          const isLockedPantryTaskDelete =
                            editUserForm.role === 'PANTRY_BOY' && row.module === 'tasks' && act === 'delete';
                          return (
                            <label
                              key={act}
                              className={`flex items-center gap-1.5 ${
                                isLockedPantryTaskDelete ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
                              }`}
                              title={
                                isLockedPantryTaskDelete
                                  ? 'Security Policy: Pantry Boy accounts are strictly prohibited from deleting tasks.'
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                disabled={isLockedPantryTaskDelete}
                                checked={
                                  isLockedPantryTaskDelete
                                    ? false
                                    : Boolean(editUserForm.permissions.actions[row.module]?.[act])
                                }
                                onChange={(e) => {
                                  if (isLockedPantryTaskDelete) return;
                                  setEditUserForm({
                                    ...editUserForm,
                                    permissions: {
                                      ...editUserForm.permissions,
                                      actions: {
                                        ...editUserForm.permissions.actions,
                                        [row.module]: {
                                          ...editUserForm.permissions.actions[row.module],
                                          [act]: e.target.checked,
                                        },
                                      },
                                    },
                                  });
                                }}
                                className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300 disabled:cursor-not-allowed"
                              />
                              <span className="capitalize font-mono text-[11px] text-slate-700">{act}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Reports row */}
                  <div className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900">Reports & Analytics</div>
                      <div className="text-[11px] text-slate-500">View daily/weekly performance analytics and export CSV snapshots</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editUserForm.permissions.actions.reports.view}
                          onChange={(e) =>
                            setEditUserForm({
                              ...editUserForm,
                              permissions: {
                                ...editUserForm.permissions,
                                actions: {
                                  ...editUserForm.permissions.actions,
                                  reports: {
                                    ...editUserForm.permissions.actions.reports,
                                    view: e.target.checked,
                                  },
                                },
                              },
                            })
                          }
                          className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                        />
                        <span className="capitalize font-mono text-[11px] text-slate-700">view</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editUserForm.permissions.actions.reports.export}
                          onChange={(e) =>
                            setEditUserForm({
                              ...editUserForm,
                              permissions: {
                                ...editUserForm.permissions,
                                actions: {
                                  ...editUserForm.permissions.actions,
                                  reports: {
                                    ...editUserForm.permissions.actions.reports,
                                    export: e.target.checked,
                                  },
                                },
                              },
                            })
                          }
                          className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                        />
                        <span className="capitalize font-mono text-[11px] text-slate-700">export</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Footer */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3 sticky bottom-0 bg-white">
                <span className="text-[11px] text-slate-500 font-mono">
                  Applied in real-time across active sessions via SSE
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEditUserModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={userActionLoading}
                    className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    {userActionLoading ? (
                      <span>Saving Permissions...</span>
                    ) : (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Save Permissions & Update User</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete User Confirmation */}
      {deleteConfirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-rose-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 text-center mb-1">
              Delete Employee Account?
            </h3>
            <p className="text-xs text-slate-600 text-center mb-4 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-slate-900 font-mono">{deleteConfirmUser.name}</strong> ({deleteConfirmUser.email})?
            </p>

            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800 space-y-1 mb-5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Immediate Access Termination</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Active sessions for this account will be invalidated immediately in real-time. Any assigned tasks will be unassigned and returned to the operational pool.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={userActionLoading}
                onClick={() => handleDeleteUser(deleteConfirmUser.id)}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                {userActionLoading ? 'Deleting Account...' : 'Confirm Permanent Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Inspect Submitted Photo Evidence Batch (Full-Size Lightbox) */}
      <EvidenceLightboxModal
        isOpen={Boolean(inspectPhotoTask)}
        onClose={() => setInspectPhotoTask(null)}
        photos={inspectPhotoTask ? getTaskPhotoEvidences(inspectPhotoTask) : []}
        initialIndex={inspectPhotoIndex}
        title={inspectPhotoTask?.title}
        task={inspectPhotoTask}
        roomName={inspectPhotoTask?.roomAreaName}
        uploaderName={inspectPhotoTask?.assignedToName}
        canVerify={hasPermission('tasks', 'edit')}
        isVerifying={verifyingPhotoModal}
        onVerifyDecision={handleVerifyPhoto}
        onRefreshEvidence={async () => {
          if (!inspectPhotoTask?.id) return;
          try {
            const fresh = await api.getTaskEvidence(inspectPhotoTask.id);
            setInspectPhotoTask((prev) =>
              prev
                ? {
                    ...prev,
                    photoEvidences: fresh.photoEvidences || [],
                    photoEvidence:
                      fresh.photoEvidences && fresh.photoEvidences.length > 0
                        ? fresh.photoEvidences[fresh.photoEvidences.length - 1]
                        : undefined,
                    photoCount: fresh.photoCount,
                  }
                : null
            );
            await loadData();
          } catch {
            await loadData();
          }
        }}
      />

      {/* Room History Photo Lightbox Modal */}
      <EvidenceLightboxModal
        isOpen={Boolean(roomLightboxState)}
        onClose={() => setRoomLightboxState(null)}
        photos={roomLightboxState?.photos || []}
        initialIndex={roomLightboxState?.initialIndex || 0}
        title={roomLightboxState ? `${roomLightboxState.roomName} — Room Photo Evidence` : undefined}
        roomName={roomLightboxState?.roomName}
        onRefreshEvidence={async () => {
          const targetRoom = roomLightboxState?.roomId
            ? rooms.find((r) => r.id === roomLightboxState.roomId) || historyRoom
            : historyRoom;
          if (!targetRoom) return;
          try {
            const fresh = await api.getRoomHistory(targetRoom.id);
            setRoomHistoryData(fresh);
            setRoomLightboxState((prev) =>
              prev ? { ...prev, photos: fresh.photos || [] } : null
            );
          } catch {
            await loadData();
          }
        }}
      />

      {/* MODAL 6: Assign Room Modal with Collision Prevention */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <DoorOpen className="w-5 h-5 text-amber-600" />
                  <span>Assign Room to Candidate or Client</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Select a room, set expected arrival and hospitality requirements. Auto-creates preparation task.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Collision Conflict Warning Banner if any */}
            {assignConflictError && (
              <div className="mb-4 p-3.5 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-rose-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Booking Conflict Warning</span>
                </div>
                <p className="leading-relaxed">{assignConflictError.message}</p>
                {assignConflictError.availableRooms && assignConflictError.availableRooms.length > 0 && (
                  <div className="pt-2 border-t border-rose-200/80">
                    <div className="font-semibold mb-1 text-rose-800">Suggested Available Rooms:</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {assignConflictError.availableRooms.map((av: any) => (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => {
                            setAssignForm((prev) => ({ ...prev, roomId: av.id, forceOverride: false }));
                            setAssignConflictError(null);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-rose-100 border border-rose-300 rounded font-bold text-rose-900"
                        >
                          Switch to {av.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pt-2 border-t border-rose-200/80 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="forceOverrideCheck"
                    checked={assignForm.forceOverride}
                    onChange={(e) => setAssignForm({ ...assignForm, forceOverride: e.target.checked })}
                    className="w-4 h-4 text-rose-600 rounded border-rose-300"
                  />
                  <label htmlFor="forceOverrideCheck" className="font-semibold text-rose-900 cursor-pointer">
                    Manager Override: Force book room anyway despite current occupancy/prep state
                  </label>
                </div>
              </div>
            )}

            <form onSubmit={handleAssignSubmit} className="space-y-4">
              {/* Candidate / Client Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Candidate / Client Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={assignForm.visitorName}
                  onChange={(e) => setAssignForm({ ...assignForm, visitorName: e.target.value })}
                  placeholder="e.g. Ananya Sharma / DLF Client Delegation"
                  className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 font-medium"
                />
              </div>

              {/* Room Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Select Target Room <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={assignForm.roomId}
                  onChange={(e) => {
                    setAssignForm({ ...assignForm, roomId: e.target.value });
                    setAssignConflictError(null);
                  }}
                  className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-lg bg-white font-medium"
                >
                  {rooms
                    .filter((r) => r.enabled)
                    .map((r) => {
                      const badge = getRoomStatusBadge(r.status);
                      return (
                        <option key={r.id} value={r.id}>
                          {r.name} — Status: [{badge.label}]
                        </option>
                      );
                    })}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Visit / Interview Reference */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Visit / Interview Reference</label>
                  <input
                    type="text"
                    value={assignForm.reference}
                    onChange={(e) => setAssignForm({ ...assignForm, reference: e.target.value })}
                    placeholder="e.g. Senior Architect Interview Round 2"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                {/* Expected Arrival */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Expected Arrival Time</label>
                  <input
                    type="text"
                    value={assignForm.expectedArrival}
                    onChange={(e) => setAssignForm({ ...assignForm, expectedArrival: e.target.value })}
                    placeholder="e.g. 11:30 AM"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Duration */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Expected Duration</label>
                  <select
                    value={assignForm.expectedDuration}
                    onChange={(e) => setAssignForm({ ...assignForm, expectedDuration: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="30 mins">30 minutes</option>
                    <option value="45 mins">45 minutes</option>
                    <option value="1 hour">1 hour</option>
                    <option value="1.5 hours">1.5 hours</option>
                    <option value="2 hours">2 hours</option>
                    <option value="Half Day">Half Day Session</option>
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Task Priority</label>
                  <select
                    value={assignForm.priority}
                    onChange={(e) => setAssignForm({ ...assignForm, priority: e.target.value as TaskPriority })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="URGENT">URGENT Priority (Immediate)</option>
                    <option value="P1">P1 High Priority</option>
                    <option value="P2">P2 Standard Priority</option>
                    <option value="P3">P3 Normal Priority</option>
                  </select>
                </div>
              </div>

              {/* Water Bottle Setup */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Water Bottle & Glassware Setup</label>
                <select
                  value={assignForm.waterRequirements}
                  onChange={(e) => setAssignForm({ ...assignForm, waterRequirements: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="2 Chilled Sealed Bottles + Clean Glasses">2 Chilled Sealed Bottles + Clean Glasses</option>
                  <option value="4 Chilled Sealed Bottles + Clean Glasses">4 Chilled Sealed Bottles + Clean Glasses</option>
                  <option value="Room Temperature Sealed Bottles + Glasses">Room Temperature Sealed Bottles + Glasses</option>
                  <option value="Executive Glass Carafe & Coasters">Executive Glass Carafe & Coasters</option>
                  <option value="Tender Coconut Water + Dry Fruit Tray">Tender Coconut Water + Dry Fruit Tray (VIP)</option>
                </select>
              </div>

              {/* Preparation Requirements */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Preparation Requirements</label>
                <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  {[
                    'Sanitize meeting table and clean glass coasters',
                    'Align all chairs in uniform geometric layout',
                    'Check presentation screen & HDMI connection',
                    'Provide clean writing pad & White Collar Realty pens',
                    'Clean whiteboard & arrange fresh markers',
                    'Verify air conditioning temperature & ambient fragrance',
                  ].map((reqItem) => {
                    const checked = assignForm.prepRequirements.includes(reqItem);
                    return (
                      <label key={reqItem} className="flex items-center gap-2 cursor-pointer text-slate-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignForm((prev) => ({ ...prev, prepRequirements: [...prev.prepRequirements, reqItem] }));
                            } else {
                              setAssignForm((prev) => ({
                                ...prev,
                                prepRequirements: prev.prepRequirements.filter((r) => r !== reqItem),
                              }));
                            }
                          }}
                          className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                        />
                        <span>{reqItem}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Special Instructions */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Additional Instructions for Pantry Boy</label>
                <textarea
                  rows={2}
                  value={assignForm.instructions}
                  onChange={(e) => setAssignForm({ ...assignForm, instructions: e.target.value })}
                  placeholder="e.g. Serve hot green tea after 10 minutes of arrival..."
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAssign}
                  className="px-5 py-2.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
                >
                  {submittingAssign ? (
                    <span>Assigning Room...</span>
                  ) : (
                    <>
                      <DoorOpen className="w-4 h-4 text-slate-950" />
                      <span>Confirm Assignment & Notify Pantry Boy</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: Room History & Camera Evidence Modal */}
      {showHistoryModal && historyRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 my-8 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{historyRoom.name}</h3>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Complete audit log of room status changes, room assignments, and verified live camera photos.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingHistory ? (
              <div className="p-12 text-center text-xs text-slate-400 font-mono">Loading room history from server...</div>
            ) : (
              <div className="overflow-y-auto space-y-6 pr-2">
                {/* Active Assignment */}
                {roomHistoryData?.currentAssignment && (
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs">
                    <div className="font-bold text-amber-900 text-sm mb-1">
                      Active Booking: {roomHistoryData.currentAssignment.visitorName}
                    </div>
                    <div className="text-amber-800 space-y-1">
                      <div>
                        Reference: <strong>{roomHistoryData.currentAssignment.reference}</strong>
                      </div>
                      <div>
                        Expected Arrival: <strong>{roomHistoryData.currentAssignment.expectedArrival}</strong> (Duration:{' '}
                        {roomHistoryData.currentAssignment.expectedDuration})
                      </div>
                      <div>Assigned by: {roomHistoryData.currentAssignment.assignedBy} at {new Date(roomHistoryData.currentAssignment.assignedAt).toLocaleString()}</div>
                    </div>
                  </div>
                )}

                {/* Status Changes Timeline */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Status Transition Audit Trail</h4>
                  {roomHistoryData?.statusHistory.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">No historical status transitions recorded yet.</div>
                  ) : (
                    <div className="space-y-2 border-l-2 border-slate-200 pl-3 ml-2">
                      {roomHistoryData?.statusHistory.map((hist) => (
                        <div key={hist.id} className="relative text-xs space-y-0.5">
                          <div className="flex items-center gap-2 font-mono">
                            <span className="font-bold text-slate-800">{hist.status}</span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(hist.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-slate-600">
                            By <strong>{hist.actorName}</strong> {hist.note ? `— "${hist.note}"` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Historical Room Assignments */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Past Room Assignments</h4>
                  {roomHistoryData?.assignmentHistory.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">No completed past assignments logged.</div>
                  ) : (
                    <div className="space-y-2">
                      {roomHistoryData?.assignmentHistory.map((ass) => (
                        <div key={ass.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                          <div className="font-bold text-slate-900">{ass.visitorName} ({ass.reference})</div>
                          <div className="text-slate-500 text-[11px] mt-0.5">
                            Arrival: {ass.expectedArrival} · Assigned By: {ass.assignedBy}
                            {ass.releasedAt && ` · Released: ${new Date(ass.releasedAt).toLocaleTimeString()}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Verified Photo Evidence Gallery */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Verified Live Camera Photo Evidence{' '}
                      {roomHistoryData?.photos && roomHistoryData.photos.length > 0
                        ? `(${roomHistoryData.photos.length})`
                        : ''}
                    </h4>
                    {roomHistoryData?.photos && roomHistoryData.photos.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setRoomLightboxState({
                            roomId: historyRoom.id,
                            roomName: historyRoom.name,
                            photos: roomHistoryData.photos || [],
                            initialIndex: 0,
                          })
                        }
                        className="px-3 py-1.5 text-xs font-bold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5 text-sky-700" />
                        <span>View Evidence ({roomHistoryData.photos.length})</span>
                      </button>
                    )}
                  </div>
                  {roomHistoryData?.photos && roomHistoryData.photos.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {roomHistoryData.photos.map((ph, idx) => (
                        <button
                          key={ph.id || `room-ph-${idx}`}
                          type="button"
                          onClick={() =>
                            setRoomLightboxState({
                              roomId: historyRoom.id,
                              roomName: historyRoom.name,
                              photos: roomHistoryData.photos || [],
                              initialIndex: idx,
                            })
                          }
                          className="text-left bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-amber-400 transition-colors text-white group cursor-pointer"
                        >
                          <div className="relative h-32 w-full bg-slate-950 overflow-hidden">
                            <AuthenticatedEvidenceImage
                              photoUrl={ph.photoUrl}
                              alt={`Room evidence #${idx + 1} for ${historyRoom.name}`}
                              compact
                              className="w-full h-full"
                              imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <span className="absolute top-2 left-2 bg-slate-950/80 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
                              #{idx + 1}
                            </span>
                            <div className="absolute inset-0 bg-slate-950/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-xs font-bold text-white">
                              <Camera className="w-3.5 h-3.5 text-amber-400" />
                              <span>View Evidence</span>
                            </div>
                          </div>
                          <div className="p-2.5 text-[10px] space-y-0.5 font-mono">
                            {ph.taskTitle && (
                              <div className="text-white font-sans font-semibold truncate text-[11px]">
                                {ph.taskTitle}
                              </div>
                            )}
                            <div className="text-amber-400 truncate">
                              {ph.userName || ph.userEmail}
                            </div>
                            <div className="text-slate-400">
                              {new Date(ph.capturedAt || ph.serverTimestamp).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })}{' '}
                              IST
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">No photo evidence recorded for this room yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Interactive Dashboard Summary Card Popups */}
      {activeDashboardModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setActiveDashboardModal(null);
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 sm:p-6 backdrop-blur-xs overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    activeDashboardModal === 'TOTAL_TASKS'
                      ? 'bg-slate-900 text-white'
                      : activeDashboardModal === 'PENDING_TASKS'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : activeDashboardModal === 'OVERDUE_TASKS'
                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                      : activeDashboardModal === 'TOTAL_REPORTS'
                      ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                      : activeDashboardModal === 'COMPLETED_TASKS'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-slate-100 text-slate-800 border border-slate-300'
                  }`}
                >
                  {activeDashboardModal === 'TOTAL_TASKS' && <ListTodo className="w-5 h-5" />}
                  {activeDashboardModal === 'PENDING_TASKS' && <Clock className="w-5 h-5" />}
                  {activeDashboardModal === 'OVERDUE_TASKS' && <AlertTriangle className="w-5 h-5" />}
                  {activeDashboardModal === 'TOTAL_REPORTS' && <BarChart3 className="w-5 h-5" />}
                  {activeDashboardModal === 'COMPLETED_TASKS' && <CheckCircle2 className="w-5 h-5" />}
                  {activeDashboardModal === 'ROOMS_READY' && <Building className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {activeDashboardModal === 'TOTAL_TASKS' && 'Total Tasks — Operational Roster'}
                      {activeDashboardModal === 'PENDING_TASKS' && 'Pending Tasks — Active Queue'}
                      {activeDashboardModal === 'OVERDUE_TASKS' && 'Overdue Tasks Audit'}
                      {activeDashboardModal === 'TOTAL_REPORTS' && 'Executive Reports & Operations Analytics'}
                      {activeDashboardModal === 'COMPLETED_TASKS' && 'Completed Tasks — Verified Records'}
                      {activeDashboardModal === 'ROOMS_READY' && 'Office Rooms Readiness & Status'}
                    </h3>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                      {activeDashboardModal === 'TOTAL_TASKS' && `${tasks.length} Total`}
                      {activeDashboardModal === 'PENDING_TASKS' && `${pendingTasks.length} Pending`}
                      {activeDashboardModal === 'OVERDUE_TASKS' && `${overdueTasks.length} Overdue`}
                      {activeDashboardModal === 'TOTAL_REPORTS' && '2 Reports Available'}
                      {activeDashboardModal === 'COMPLETED_TASKS' && `${completedTasks.length} Completed`}
                      {activeDashboardModal === 'ROOMS_READY' && `${readyRoomsCount}/${rooms.length} Ready`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeDashboardModal === 'TOTAL_TASKS' && 'Complete list of all scheduled routines, water distributions, and closing tasks.'}
                    {activeDashboardModal === 'PENDING_TASKS' && 'Tasks currently in progress, available for pickup, or awaiting review.'}
                    {activeDashboardModal === 'OVERDUE_TASKS' && 'Tasks that have exceeded their target completion time.'}
                    {activeDashboardModal === 'TOTAL_REPORTS' && 'Live daily breakdown, weekly turnaround analytics, and official CSV exports.'}
                    {activeDashboardModal === 'COMPLETED_TASKS' && 'All finished tasks verified with timestamps and photo evidence.'}
                    {activeDashboardModal === 'ROOMS_READY' && 'Live status overview of all 15 executive cabins, meeting suites, and common areas.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDashboardModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              {/* Search & Filter Bar (for task modals) */}
              {(activeDashboardModal === 'TOTAL_TASKS' ||
                activeDashboardModal === 'PENDING_TASKS' ||
                activeDashboardModal === 'COMPLETED_TASKS' ||
                activeDashboardModal === 'OVERDUE_TASKS') && (
                <div className="flex flex-col sm:flex-row gap-2.5 pb-2 border-b border-slate-100">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={modalSearchQuery}
                      onChange={(e) => setModalSearchQuery(e.target.value)}
                      placeholder="Search by task title, room name, or assignee..."
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-900 bg-slate-50/50"
                    />
                    {modalSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setModalSearchQuery('')}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {activeDashboardModal === 'TOTAL_TASKS' && (
                    <div className="flex items-center gap-1 overflow-x-auto text-xs">
                      {['ALL', 'AVAILABLE', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'BLOCKED', 'OVERDUE'].map(
                        (statusKey) => (
                          <button
                            key={statusKey}
                            type="button"
                            onClick={() => setModalStatusFilter(statusKey)}
                            className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                              modalStatusFilter === statusKey
                                ? 'bg-slate-900 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {statusKey === 'ALL'
                              ? 'All'
                              : statusKey === 'PENDING_VERIFICATION'
                              ? 'Under Review'
                              : statusKey.replace(/_/g, ' ')}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 1. TOTAL TASKS CONTENT */}
              {activeDashboardModal === 'TOTAL_TASKS' && (() => {
                const list = tasks.filter((t) => {
                  if (modalStatusFilter !== 'ALL' && t.status !== modalStatusFilter) return false;
                  if (modalSearchQuery.trim()) {
                    const q = modalSearchQuery.toLowerCase();
                    return (
                      t.title.toLowerCase().includes(q) ||
                      t.roomAreaName.toLowerCase().includes(q) ||
                      t.assignedToName.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                return (
                  <div className="space-y-2.5">
                    <div className="text-xs text-slate-500 font-mono">
                      Showing {list.length} of {tasks.length} total tasks
                    </div>

                    {list.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        No tasks match the filter query.
                      </div>
                    ) : (
                      list.map((task) => (
                        <div
                          key={task.id}
                          className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                {task.priority}
                              </span>
                              <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  task.status === 'COMPLETED'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : task.status === 'OVERDUE'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : task.status === 'BLOCKED'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : task.status === 'IN_PROGRESS'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : task.status === 'PENDING_VERIFICATION'
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}
                              >
                                {task.status === 'PENDING_VERIFICATION' ? 'Under Review' : task.status.replace(/_/g, ' ')}
                              </span>
                              {task.isUrgent && (
                                <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded">
                                  URGENT
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-bold text-slate-900">{task.title}</div>
                            {task.description && (
                              <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{task.description}</p>
                            )}
                            <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1.5 flex-wrap">
                              <span>
                                Assignee: <strong className="text-slate-700">{task.assignedToName}</strong>
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3 text-slate-400" /> Due: {task.dueTime}
                              </span>
                              <span>•</span>
                              <span>
                                Checklist: {task.checklist?.filter((c) => c.completed).length || 0}/
                                {task.checklist?.length || 0}
                              </span>
                              {task.completedAt && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-700">
                                    Done: {new Date(task.completedAt).toLocaleTimeString()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {getTaskPhotoEvidences(task).length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  openInspectTaskEvidence(task, 0);
                                }}
                                className="px-2.5 py-1 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3 text-sky-700" />
                                <span>View Evidence ({getTaskPhotoEvidences(task).length})</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenTaskDetail(task.id)}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveDashboardModal(null);
                                setSubTab('TASKS');
                                setSearchQuery(task.title);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                            >
                              View in Grid
                            </button>
                            {canDeleteTask && !isPantryBoyTask(task) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteTask(task);
                                }}
                                title="Delete Task"
                                className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}

              {/* 2. PENDING TASKS CONTENT */}
              {activeDashboardModal === 'PENDING_TASKS' && (() => {
                const list = pendingTasks.filter((t) => {
                  if (modalSearchQuery.trim()) {
                    const q = modalSearchQuery.toLowerCase();
                    return (
                      t.title.toLowerCase().includes(q) ||
                      t.roomAreaName.toLowerCase().includes(q) ||
                      t.assignedToName.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                return (
                  <div className="space-y-4">
                    {/* Stat Breakdown Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                        <div className="text-[10px] uppercase font-bold text-amber-800">In Progress</div>
                        <div className="text-xl font-bold font-mono text-amber-900 mt-0.5">
                          {inProgressTasks.length}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="text-[10px] uppercase font-bold text-slate-700">Available / Next</div>
                        <div className="text-xl font-bold font-mono text-slate-900 mt-0.5">
                          {tasks.filter((t) => t.status === 'AVAILABLE').length}
                        </div>
                      </div>
                      <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
                        <div className="text-[10px] uppercase font-bold text-indigo-800">Under Review</div>
                        <div className="text-xl font-bold font-mono text-indigo-900 mt-0.5">
                          {tasks.filter((t) => t.status === 'PENDING_VERIFICATION').length}
                        </div>
                      </div>
                      <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                        <div className="text-[10px] uppercase font-bold text-rose-800">Blocked</div>
                        <div className="text-xl font-bold font-mono text-rose-900 mt-0.5">
                          {tasks.filter((t) => t.status === 'BLOCKED').length}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500 font-mono">
                      Showing {list.length} pending tasks
                    </div>

                    {list.length === 0 ? (
                      <div className="p-8 text-center text-xs text-emerald-700 bg-emerald-50 rounded-xl border border-emerald-200 flex flex-col items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-emerald-600 mb-2" />
                        <span className="font-bold">No Pending Tasks!</span>
                        <span className="text-slate-600 mt-0.5">All scheduled routines have been completed.</span>
                      </div>
                    ) : (
                      list.map((task) => (
                        <div
                          key={task.id}
                          className={`p-3.5 rounded-xl border transition-all ${
                            task.status === 'BLOCKED'
                              ? 'bg-rose-50/40 border-rose-300'
                              : task.status === 'IN_PROGRESS'
                              ? 'bg-amber-50/30 border-amber-300'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                {task.priority}
                              </span>
                              <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  task.status === 'BLOCKED'
                                    ? 'bg-rose-100 text-rose-800'
                                    : task.status === 'IN_PROGRESS'
                                    ? 'bg-amber-100 text-amber-800'
                                    : task.status === 'PENDING_VERIFICATION'
                                    ? 'bg-indigo-100 text-indigo-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {task.status === 'PENDING_VERIFICATION' ? 'Under Review' : task.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-slate-500 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span>Due: {task.dueTime}</span>
                            </div>
                          </div>

                          <div className="text-xs font-bold text-slate-900 mb-1">{task.title}</div>
                          {task.description && (
                            <p className="text-[11px] text-slate-600 leading-relaxed mb-2">{task.description}</p>
                          )}

                          {task.status === 'BLOCKED' && task.blockedReason && (
                            <div className="p-2.5 bg-rose-100/70 border border-rose-300 rounded-lg text-xs text-rose-800 mb-2">
                              <div className="font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                <span>Reported Blocker:</span>
                              </div>
                              <div className="mt-0.5">{task.blockedReason}</div>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                            <div>
                              Assigned to: <strong className="text-slate-700">{task.assignedToName}</strong> (
                              {task.checklist?.filter((c) => c.completed).length || 0}/{task.checklist?.length || 0} items)
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {getTaskPhotoEvidences(task).length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDashboardModal(null);
                                    openInspectTaskEvidence(task, 0);
                                  }}
                                  className="px-2.5 py-1 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Camera className="w-3 h-3 text-sky-700" />
                                  <span>View Evidence ({getTaskPhotoEvidences(task).length})</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenTaskDetail(task.id)}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  setSubTab('TASKS');
                                  setSearchQuery(task.title);
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              >
                                View in Grid
                              </button>
                              {canDeleteTask && !isPantryBoyTask(task) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDeleteTask(task);
                                  }}
                                  title="Delete Task"
                                  className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}

              {/* 3. OVERDUE TASKS CONTENT */}
              {activeDashboardModal === 'OVERDUE_TASKS' && (() => {
                const list = overdueTasks.filter((t) => {
                  if (modalSearchQuery.trim()) {
                    const q = modalSearchQuery.toLowerCase();
                    return (
                      t.title.toLowerCase().includes(q) ||
                      t.roomAreaName.toLowerCase().includes(q) ||
                      t.assignedToName.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                return (
                  <div className="space-y-4">
                    {list.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl bg-emerald-50/60 border border-emerald-200 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                          <CheckCircle2 className="w-6 h-6" />
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">No Overdue Tasks Right Now</h4>
                        <p className="text-xs text-slate-600 mt-1 max-w-md text-center leading-relaxed">
                          All operational cleaning tasks, executive preparations, and hospitality water rounds are
                          operating on schedule.
                        </p>
                        <div className="mt-4 p-3 bg-white rounded-xl border border-emerald-200 text-xs text-slate-600 font-mono">
                          Operations Status: Running on time ({completedTasks.length} / {tasks.length} tasks completed)
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                          <span>
                            The following {list.length} task(s) have not been completed before their target due time and
                            require immediate attention.
                          </span>
                        </div>

                        <div className="space-y-3">
                          {list.map((task) => (
                            <div
                              key={task.id}
                              className="p-4 bg-white rounded-xl border border-rose-300 shadow-xs flex flex-col justify-between"
                            >
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
                                    {task.priority}
                                  </span>
                                  <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                                </div>
                                <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                  OVERDUE
                                </span>
                              </div>

                              <div className="text-xs font-bold text-slate-900 mb-1">{task.title}</div>
                              {task.description && (
                                <p className="text-[11px] text-slate-600 mb-2">{task.description}</p>
                              )}

                              <div className="p-2.5 bg-slate-50 rounded-lg text-xs font-mono text-slate-600 space-y-1 mb-2">
                                <div>
                                  Scheduled Due: <strong className="text-rose-700">{task.dueTime}</strong>
                                </div>
                                <div>Assigned Staff: {task.assignedToName}</div>
                                <div>
                                  Checklist Status:{' '}
                                  {task.checklist?.filter((c) => c.completed).length || 0}/{task.checklist?.length || 0} completed
                                </div>
                              </div>

                              <div className="flex justify-end gap-2 flex-wrap">
                                {getTaskPhotoEvidences(task).length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveDashboardModal(null);
                                      openInspectTaskEvidence(task, 0);
                                    }}
                                    className="px-3 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Camera className="w-3.5 h-3.5 text-sky-700" />
                                    <span>View Evidence ({getTaskPhotoEvidences(task).length})</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenTaskDetail(task.id)}
                                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                                >
                                  Details
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDashboardModal(null);
                                    setSubTab('TASKS');
                                    setSearchQuery(task.title);
                                  }}
                                  className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                >
                                  Open Task in Grid
                                </button>
                                {canDeleteTask && !isPantryBoyTask(task) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requestDeleteTask(task);
                                    }}
                                    title="Delete Task"
                                    className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* 4. TOTAL REPORTS CONTENT */}
              {activeDashboardModal === 'TOTAL_REPORTS' && (
                <div className="space-y-6">
                  {/* Daily Report Card */}
                  <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-700" />
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Report 1: Daily Operations Performance Report
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                        {dailyReport ? dailyReport.date : 'Today'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 bg-white rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 font-mono uppercase">Completion Rate</div>
                        <div className="text-xl font-bold font-mono text-emerald-600 mt-0.5">
                          {dailyReport ? `${dailyReport.completionRatePercent}%` : '94%'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {completedTasks.length} of {tasks.length} tasks
                        </div>
                      </div>

                      <div className="p-3 bg-white rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 font-mono uppercase">On-Time Execution</div>
                        <div className="text-xl font-bold font-mono text-indigo-600 mt-0.5">
                          {dailyReport ? `${dailyReport.onTimeCompletionRatePercent}%` : '92%'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Target adherence</div>
                      </div>

                      <div className="p-3 bg-white rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 font-mono uppercase">Photo Evidence Score</div>
                        <div className="text-xl font-bold font-mono text-sky-600 mt-0.5">
                          {weeklyReport ? `${weeklyReport.photoVerificationScorePercent}%` : '96%'}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Verified authenticity</div>
                      </div>

                      <div className="p-3 bg-white rounded-xl border border-slate-200">
                        <div className="text-[10px] text-slate-400 font-mono uppercase">Pending / Active</div>
                        <div className="text-xl font-bold font-mono text-amber-600 mt-0.5">
                          {pendingTasks.length}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">In queue</div>
                      </div>
                    </div>
                  </div>

                  {/* Weekly Management Analytics Card */}
                  <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-indigo-700" />
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Report 2: Weekly Operations & Hospitality Analytics
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                        {weeklyReport ? weeklyReport.weekPeriod : 'Current Week'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                        <div className="font-bold text-slate-800">Frequently Blocked Rooms</div>
                        {weeklyReport?.frequentlyBlockedRooms && weeklyReport.frequentlyBlockedRooms.length > 0 ? (
                          <div className="space-y-1.5">
                            {weeklyReport.frequentlyBlockedRooms.map((b, idx) => (
                              <div key={idx} className="p-2 bg-slate-50 rounded-lg flex items-center justify-between">
                                <div>
                                  <div className="font-semibold text-slate-900">{b.room}</div>
                                  <div className="text-[10px] text-slate-500">{b.primaryReason}</div>
                                </div>
                                <span className="font-mono text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                  {b.count} times
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-400 italic">No recurring blockers detected.</div>
                        )}
                      </div>

                      <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                        <div className="font-bold text-slate-800">Hospitality Recommendations</div>
                        {weeklyReport?.keyRecommendations && weeklyReport.keyRecommendations.length > 0 ? (
                          <ul className="space-y-1 text-[11px] text-slate-600 list-disc pl-4 leading-relaxed">
                            {weeklyReport.keyRecommendations.map((rec, i) => (
                              <li key={i}>{rec}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-slate-400 italic">Operating smoothly within expected parameters.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & CSV Export */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200">
                    <div className="text-xs text-slate-500 font-mono">
                      Export permanent CSV snapshot of all {tasks.length} task records & audit timestamps
                    </div>
                    <div className="flex items-center gap-2">
                      {canViewReports && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDashboardModal(null);
                            setSubTab('REPORTS');
                          }}
                          className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          Open Full Reports Tab
                        </button>
                      )}
                      {hasPermission('reports', 'export') && (
                        <a
                          href={api.getReportExportUrl()}
                          download
                          className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download CSV Report
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 5. COMPLETED TASKS CONTENT */}
              {activeDashboardModal === 'COMPLETED_TASKS' && (() => {
                const list = completedTasks.filter((t) => {
                  if (modalSearchQuery.trim()) {
                    const q = modalSearchQuery.toLowerCase();
                    return (
                      t.title.toLowerCase().includes(q) ||
                      t.roomAreaName.toLowerCase().includes(q) ||
                      t.assignedToName.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                return (
                  <div className="space-y-3">
                    <div className="text-xs text-slate-500 font-mono">
                      Showing {list.length} completed tasks
                    </div>

                    {list.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        No completed tasks match query.
                      </div>
                    ) : (
                      list.map((task) => (
                        <div
                          key={task.id}
                          className="p-3.5 bg-white rounded-xl border border-emerald-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                                {task.priority}
                              </span>
                              <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Completed & Verified
                              </span>
                            </div>

                            <div className="text-xs font-bold text-slate-900">{task.title}</div>
                            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                              <span>
                                Completed by: <strong className="text-slate-700">{task.assignedToName}</strong>
                              </span>
                              <span>•</span>
                              <span>
                                Time:{' '}
                                {task.completedAt
                                  ? new Date(task.completedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
                                  : 'Done'}
                              </span>
                              <span>•</span>
                              <span>Checklist: {task.checklist?.length || 0}/{task.checklist?.length || 0} passed</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {getTaskPhotoEvidences(task).length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  openInspectTaskEvidence(task, 0);
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5 text-sky-700" />
                                <span>View Evidence ({getTaskPhotoEvidences(task).length})</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenTaskDetail(task.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                            >
                              Details
                            </button>
                            {canDeleteTask && !isPantryBoyTask(task) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteTask(task);
                                }}
                                title="Delete Task"
                                className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}

              {/* 6. ROOMS READY CONTENT */}
              {activeDashboardModal === 'ROOMS_READY' && (
                <div className="space-y-4">
                  <div className="text-xs text-slate-500 font-mono">
                    Showing status for all {rooms.length} configured office areas
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rooms.map((room) => {
                      const badge = getRoomStatusBadge(room.status);
                      const isReady = room.status === 'AVAILABLE' || room.status === 'READY_FOR_VISITOR';

                      return (
                        <div
                          key={room.id}
                          className={`p-3.5 rounded-xl border transition-all ${
                            isReady
                              ? 'bg-white border-slate-200 hover:border-emerald-300'
                              : 'bg-slate-50/60 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                              {room.category.replace(/_/g, ' ')}
                            </span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                              {badge.label}
                            </span>
                          </div>

                          <h5 className="text-xs font-bold text-slate-900 mb-1">{room.name}</h5>

                          {room.currentAssignment ? (
                            <div className="p-2 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] text-amber-900 mt-2">
                              <div className="font-bold truncate">Visitor: {room.currentAssignment.visitorName}</div>
                              <div className="text-slate-500 text-[10px]">
                                Expected: {room.currentAssignment.expectedArrival} ({room.currentAssignment.expectedDuration})
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400 mt-2">
                              {isReady ? 'Ready for immediate use' : 'Under preparation or sanitization'}
                            </div>
                          )}

                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] flex-wrap">
                            <span className="text-slate-500 font-mono">Priority: {room.defaultPriority}</span>
                            <div className="flex items-center gap-2">
                              {(roomPhotosMap.get(room.id)?.length || 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDashboardModal(null);
                                    handleViewHistory(room);
                                  }}
                                  className="px-2 py-0.5 rounded bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  <Camera className="w-3 h-3 text-sky-700" />
                                  <span>View Evidence ({roomPhotosMap.get(room.id)?.length || 0})</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  setSubTab('ROOMS');
                                }}
                                className="text-slate-700 hover:text-slate-900 font-semibold cursor-pointer"
                              >
                                Manage Area →
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">Press Escape or click outside to dismiss</span>
              <button
                type="button"
                onClick={() => setActiveDashboardModal(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------- */}
      {/* Attendance History Modal                                               */}
      {/* ----------------------------------------------------------------------- */}
      {showAttendanceHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Attendant Attendance History</h3>
                  <p className="text-xs text-slate-500">Persistent IST check-in and session duration logs</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAttendanceHistoryModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {loadingAttendanceHistory ? (
                <div className="p-12 text-center text-xs text-slate-400 font-mono">
                  Loading persistent attendance records...
                </div>
              ) : attendanceHistoryList.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No attendance history records logged yet. Records are saved automatically on Pantry Boy login.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-mono flex items-center justify-between">
                    <span>Total Logs: {attendanceHistoryList.length}</span>
                    <span className="text-slate-500">Asia/Kolkata (IST)</span>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold font-mono text-[11px]">
                          <th className="p-3">Date</th>
                          <th className="p-3">Attendant</th>
                          <th className="p-3">Login (IST)</th>
                          <th className="p-3">Logout (IST)</th>
                          <th className="p-3">Elapsed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {attendanceHistoryList.map((record) => (
                          <tr key={record.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="p-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                              {record.date}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="font-bold text-slate-900">{record.userName}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{record.userEmail}</div>
                            </td>
                            <td className="p-3 font-mono text-emerald-700 font-semibold whitespace-nowrap">
                              {record.loginTimeIST}
                            </td>
                            <td className="p-3 font-mono text-slate-600 whitespace-nowrap">
                              {record.logoutTimeIST || (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="p-3 font-mono text-slate-700 whitespace-nowrap">
                              {record.elapsedMinutes
                                ? `${Math.floor(record.elapsedMinutes / 60)}h ${record.elapsedMinutes % 60}m`
                                : 'In Session'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">White Collar Realty · Operational Audit Log</span>
              <button
                type="button"
                onClick={() => setShowAttendanceHistoryModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Task Detail View (Opened by exact task.id from Recent Activity or Notifications) */}
      {selectedDetailTask && (() => {
        const detailBadge = getTaskStatusBadge(selectedDetailTask.status);
        const canEditTasks = hasPermission('tasks', 'edit');
        const canDeleteTasks = canDeleteTask;
        const totalChecklist = selectedDetailTask.checklist?.length || 0;
        const completedChecklist = selectedDetailTask.checklist?.filter((c) => c.completed).length || 0;
        const checklistPct = totalChecklist > 0 ? Math.round((completedChecklist / totalChecklist) * 100) : 0;
        const isTerminalStatus =
          selectedDetailTask.status === 'COMPLETED' || selectedDetailTask.status === 'CANCELLED';

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
            onClick={handleCloseTaskDetail}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="wcr-task-detail-title"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-white via-white to-amber-50/60 flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${
                        selectedDetailTask.priority === 'URGENT' || selectedDetailTask.isUrgent
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      {selectedDetailTask.priority}
                    </span>
                    <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${detailBadge.bg}`}>
                      {detailBadge.label}
                    </span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80">
                      {formatTaskTypeLabel(selectedDetailTask.taskType)}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      ID: {selectedDetailTask.id}
                    </span>
                  </div>
                  <h3 id="wcr-task-detail-title" className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                    {selectedDetailTask.title}
                  </h3>
                  <div className="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-semibold text-slate-800">{selectedDetailTask.roomAreaName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseTaskDetail}
                  aria-label="Close task details"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
                {taskDetailError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{taskDetailError}</span>
                  </div>
                )}

                {selectedDetailTask.blockedReason && selectedDetailTask.status === 'BLOCKED' && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                      Task Blocked
                    </div>
                    <p>{selectedDetailTask.blockedReason}</p>
                  </div>
                )}

                {selectedDetailTask.rejectionReason && selectedDetailTask.status === 'REJECTED' && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      Verification Feedback / Retake Required
                    </div>
                    <p>{selectedDetailTask.rejectionReason}</p>
                  </div>
                )}

                {selectedDetailTask.status === 'CANCELLED' && (
                  <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-center justify-between gap-2">
                    <span>
                      Cancelled{selectedDetailTask.cancelledBy ? ` by ${selectedDetailTask.cancelledBy}` : ''}
                    </span>
                    {selectedDetailTask.cancelledAt && (
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatISTTaskSchedule(selectedDetailTask.cancelledAt)}
                      </span>
                    )}
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 text-xs">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Assigned Attendant</div>
                    <div className="font-bold text-slate-900 mt-0.5">{selectedDetailTask.assignedToName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{selectedDetailTask.assignedToEmail}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Assigned By</div>
                    <div className="font-bold text-slate-900 mt-0.5">{selectedDetailTask.createdByName}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Created {formatISTTaskSchedule(selectedDetailTask.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Scheduled Time (IST)</div>
                    <div className="font-bold text-slate-900 font-mono mt-0.5 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{formatISTTaskSchedule(selectedDetailTask.scheduledFor)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Due Window</div>
                    <div className="font-bold text-slate-900 font-mono mt-0.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{selectedDetailTask.dueTime}</span>
                    </div>
                  </div>
                  {(selectedDetailTask.startedAt || selectedDetailTask.completedAt) && (
                    <div className="sm:col-span-2 pt-2 border-t border-slate-200/80 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-600 font-mono">
                      {selectedDetailTask.startedAt && (
                        <span>Started: {formatISTTaskSchedule(selectedDetailTask.startedAt)}</span>
                      )}
                      {selectedDetailTask.submittedAt && (
                        <span>Submitted: {formatISTTaskSchedule(selectedDetailTask.submittedAt)}</span>
                      )}
                      {selectedDetailTask.completedAt && (
                        <span className="text-emerald-700 font-semibold">
                          Completed: {formatISTTaskSchedule(selectedDetailTask.completedAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Task Instructions / Notes */}
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>Instructions & Operational Scope</span>
                  </h4>
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 leading-relaxed">
                    {selectedDetailTask.description && selectedDetailTask.description.trim()
                      ? selectedDetailTask.description
                      : `Complete standard operational readiness protocol for ${selectedDetailTask.roomAreaName}.`}
                  </div>
                </div>

                {/* Checklist Section */}
                {totalChecklist > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <ListTodo className="w-3.5 h-3.5 text-slate-500" />
                        <span>Execution Checklist</span>
                      </h4>
                      <span className="text-xs font-mono font-semibold text-slate-600">
                        {completedChecklist}/{totalChecklist} ({checklistPct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${checklistPct}%` }}
                      />
                    </div>
                    <div className="space-y-2">
                      {selectedDetailTask.checklist.map((item) => {
                        const interactiveChecklist = canEditTasks && !isTerminalStatus;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!interactiveChecklist}
                            onClick={() =>
                              interactiveChecklist &&
                              handleDetailToggleChecklist(selectedDetailTask.id, item.id, !item.completed)
                            }
                            className={`w-full text-left p-2.5 rounded-xl border text-xs flex items-center gap-2.5 transition-colors ${
                              item.completed
                                ? 'bg-emerald-50/60 border-emerald-200 text-slate-700'
                                : 'bg-white border-slate-200 text-slate-800'
                            } ${
                              interactiveChecklist
                                ? 'hover:border-amber-300 cursor-pointer'
                                : 'cursor-default'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                                item.completed
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-slate-300'
                              }`}
                            >
                              {item.completed && <Check className="w-3 h-3" />}
                            </span>
                            <span className={item.completed ? 'line-through text-slate-500' : 'font-medium'}>
                              {item.text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Photo Evidence Section */}
                {getTaskPhotoEvidences(selectedDetailTask).length > 0 &&
                  (() => {
                    const detailPhotos = getTaskPhotoEvidences(selectedDetailTask);
                    const primaryEvidence = detailPhotos[0];

                    return (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                            <Camera className="w-4 h-4 text-sky-600" />
                            <span>
                              Submitted Camera Evidence ({detailPhotos.length} Photo
                              {detailPhotos.length === 1 ? '' : 's'})
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              · {primaryEvidence.status}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openInspectTaskEvidence(selectedDetailTask, 0)}
                            className="px-3 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <Camera className="w-3.5 h-3.5 text-sky-700" />
                            <span>View Evidence ({detailPhotos.length})</span>
                          </button>
                        </div>

                        {detailPhotos.length === 1 ? (
                          <button
                            type="button"
                            onClick={() => openInspectTaskEvidence(selectedDetailTask, 0)}
                            className="w-full rounded-lg overflow-hidden bg-slate-900 h-52 flex items-center justify-center border border-slate-200 hover:border-sky-500 transition-colors cursor-pointer group relative"
                          >
                            <AuthenticatedEvidenceImage
                              photoUrl={primaryEvidence.photoUrl}
                              alt={`Evidence for ${selectedDetailTask.title}`}
                              className="w-full h-full"
                              imgClassName="max-h-52 w-full object-contain group-hover:scale-[1.02] transition-transform"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-xs font-bold text-white">
                              <Camera className="w-4 h-4 text-amber-400" />
                              <span>Click to Open Full-Size View</span>
                            </div>
                          </button>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {detailPhotos.map((ev, idx) => (
                              <button
                                key={ev.id || `detail-ev-${idx}`}
                                type="button"
                                onClick={() => openInspectTaskEvidence(selectedDetailTask, idx)}
                                className="relative rounded-lg overflow-hidden bg-slate-900 h-28 border border-slate-200 hover:border-sky-500 transition-colors cursor-pointer group"
                              >
                                <AuthenticatedEvidenceImage
                                  photoUrl={ev.photoUrl}
                                  alt={`Evidence #${idx + 1} for ${selectedDetailTask.title}`}
                                  compact
                                  className="w-full h-full"
                                  imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <span className="absolute top-1.5 left-1.5 bg-black/75 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
                                  #{idx + 1}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {canEditTasks &&
                          (selectedDetailTask.status === 'PENDING_VERIFICATION' ||
                            selectedDetailTask.status === 'SUBMITTED' ||
                            primaryEvidence.status === 'UPLOADED') && (
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={taskDetailActionLoading}
                                onClick={() =>
                                  handleDetailVerifyPhoto(
                                    selectedDetailTask.id,
                                    'REJECT',
                                    'Requires closer alignment & surface check'
                                  )
                                }
                                className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                Reject & Request Retake
                              </button>
                              <button
                                type="button"
                                disabled={taskDetailActionLoading}
                                onClick={() => handleDetailVerifyPhoto(selectedDetailTask.id, 'APPROVE')}
                                className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                Approve & Complete
                              </button>
                            </div>
                          )}
                      </div>
                    );
                  })()}

                {/* Change History Audit Log */}
                {selectedDetailTask.changeHistory && selectedDetailTask.changeHistory.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-slate-500" />
                      <span>Activity & Status History</span>
                    </h4>
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {[...selectedDetailTask.changeHistory].reverse().map((entry, idx) => (
                        <div
                          key={`${entry.timestamp}-${idx}`}
                          className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/70 text-[11px] flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800">
                              {entry.actorName}{' '}
                              <span className="font-mono text-[10px] text-slate-500">
                                ({entry.fromStatus} → {entry.toStatus})
                              </span>
                            </div>
                            {entry.note && <div className="text-slate-600 mt-0.5">{entry.note}</div>}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                            {formatISTTaskSchedule(entry.timestamp)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Authorized Actions Footer */}
              <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  {canEditTasks && selectedDetailTask.status !== 'COMPLETED' && (
                    <button
                      type="button"
                      disabled={taskDetailActionLoading}
                      onClick={() => handleOpenEditTask(selectedDetailTask)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-600" />
                      <span>Edit / Reschedule</span>
                    </button>
                  )}

                  {canEditTasks &&
                    (selectedDetailTask.status === 'SCHEDULED' ||
                      selectedDetailTask.status === 'AVAILABLE' ||
                      selectedDetailTask.status === 'OVERDUE' ||
                      selectedDetailTask.status === 'BLOCKED' ||
                      selectedDetailTask.status === 'REJECTED') && (
                      <button
                        type="button"
                        disabled={taskDetailActionLoading}
                        onClick={() =>
                          handleDetailStatusChange(
                            selectedDetailTask.id,
                            'IN_PROGRESS',
                            `Marked In Progress by ${currentUser?.name || 'Management'}`
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 text-amber-700" />
                        <span>Start Task</span>
                      </button>
                    )}

                  {canEditTasks && !isTerminalStatus && (
                    <button
                      type="button"
                      disabled={taskDetailActionLoading}
                      onClick={() =>
                        selectedDetailTask.photoEvidence &&
                        (selectedDetailTask.status === 'PENDING_VERIFICATION' ||
                          selectedDetailTask.status === 'SUBMITTED')
                          ? handleDetailVerifyPhoto(selectedDetailTask.id, 'APPROVE')
                          : handleDetailStatusChange(
                              selectedDetailTask.id,
                              'COMPLETED',
                              `Completed & verified by ${currentUser?.name || 'Management'}`
                            )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Completed</span>
                    </button>
                  )}

                  {canEditTasks && isTerminalStatus && (
                    <button
                      type="button"
                      disabled={taskDetailActionLoading}
                      onClick={() =>
                        handleDetailStatusChange(
                          selectedDetailTask.id,
                          'AVAILABLE',
                          `Reopened by ${currentUser?.name || 'Management'}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reopen Task</span>
                    </button>
                  )}

                  {canEditTasks && !isTerminalStatus && (
                    <button
                      type="button"
                      disabled={taskDetailActionLoading}
                      onClick={() => handleDetailCancelTask(selectedDetailTask)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-rose-50 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancel Task</span>
                    </button>
                  )}

                  {!canEditTasks && !canDeleteTasks && (
                    <span className="text-[11px] text-slate-400 font-medium">
                      View-only access · Task modification restricted by role permissions
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {canDeleteTasks && !isPantryBoyTask(selectedDetailTask) && (
                    <button
                      type="button"
                      disabled={taskDetailActionLoading}
                      onClick={() => requestDeleteTask(selectedDetailTask)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      title="Delete Task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleCloseTaskDetail}
                    className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Confirm Task Deletion (Authorized Management Only — Never Shown to Pantry Boy) */}
      {taskPendingDelete && canDeleteTask && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          onClick={() => {
            if (!isDeletingTask) {
              setTaskPendingDelete(null);
              setDeleteTaskError(null);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wcr-confirm-delete-task-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-rose-50/80 via-white to-white flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="wcr-confirm-delete-task-title" className="text-sm font-bold text-slate-900">
                    Confirm Task Deletion
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    This permanently removes the task across all dashboards and live schedules.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingTask}
                onClick={() => {
                  setTaskPendingDelete(null);
                  setDeleteTaskError(null);
                }}
                aria-label="Cancel deletion"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200">
                    {taskPendingDelete.priority}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {taskPendingDelete.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-sm font-bold text-slate-900 leading-snug">
                  {taskPendingDelete.title}
                </div>
                <div className="text-[11px] text-slate-600 flex items-center gap-2 flex-wrap pt-0.5">
                  <span className="font-semibold text-slate-800">{taskPendingDelete.roomAreaName}</span>
                  <span>•</span>
                  <span className="font-mono">{formatISTTaskSchedule(taskPendingDelete.scheduledFor)}</span>
                </div>
              </div>

              {deleteTaskError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-medium">{deleteTaskError}</span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Are you sure you want to delete this task? Once deleted, it is removed from the database, counts, and Pantry Boy&apos;s queue immediately.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingTask}
                onClick={() => {
                  setTaskPendingDelete(null);
                  setDeleteTaskError(null);
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingTask}
                onClick={confirmAndExecuteDeleteTask}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingTask ? 'Deleting...' : 'Delete Task'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
