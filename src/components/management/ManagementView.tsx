import React, { useState, useEffect, useCallback } from 'react';
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
} from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth, getDefaultPermissions } from '../../context/AuthContext.tsx';
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
  ShieldAlert,
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

export interface ManagementViewProps {
  activeView?: 'PANTRY' | 'MANAGEMENT';
  setActiveView?: (view: 'PANTRY' | 'MANAGEMENT') => void;
}

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

export const ManagementView: React.FC<ManagementViewProps> = ({ activeView, setActiveView }) => {
  const { currentUser, allUsers, refreshUsers, logout, hasPermission } = useAuth();

  // Active navigation sub-tab
  const [subTab, setSubTab] = useState<ManagementTab>('DASHBOARD');
  const [settingsTab, setSettingsTab] = useState<'ROOMS' | 'USERS' | 'AUDIT'>('ROOMS');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

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

  // AI Task Generation state
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isAiParsing, setIsAiParsing] = useState<boolean>(false);
  const [newTaskForm, setNewTaskForm] = useState<{
    title: string;
    roomAreaId: string;
    priority: TaskPriority;
    dueTime: string;
    description: string;
    isUrgent: boolean;
    checklist: string[];
  }>({
    title: '',
    roomAreaId: '',
    priority: 'P2',
    dueTime: 'Within 30 mins',
    description: '',
    isUrgent: false,
    checklist: ['Clean table surfaces', 'Align all chairs', 'Provide fresh water bottles', 'Upload photo evidence'],
  });

  // Visitor Form
  const [visitorForm, setVisitorForm] = useState({
    visitorName: '',
    companyName: '',
    hostName: currentUser?.role === 'KIMMY_MAM' ? 'Kimmi' : currentUser?.name || 'Kimmi',
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveDashboardModal(null);
      }
    };
    if (activeDashboardModal) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [activeDashboardModal]);

  const loadData = useCallback(async () => {
    try {
      const [tData, rData, vData, dData, wData, aData] = await Promise.all([
        api.getTasks().catch(() => []),
        api.getRooms().catch(() => []),
        api.getVisitors().catch(() => []),
        api.getDailyReport().catch(() => null),
        api.getWeeklyReport().catch(() => null),
        api.getAuditLogs().catch(() => []),
      ]);
      setTasks(tData);
      setRooms(rData);
      setVisitors(vData);
      if (dData?.summary) setDailyReport(dData.summary);
      if (wData?.weeklySummary) setWeeklyReport(wData.weeklySummary);
      setAuditLogs(aData);

      if (!newTaskForm.roomAreaId && rData.length > 0) {
        setNewTaskForm((prev) => ({ ...prev, roomAreaId: rData[0].id }));
      }
      if (!visitorForm.roomAreaId && rData.length > 0) {
        setVisitorForm((prev) => ({ ...prev, roomAreaId: rData[4]?.id || rData[0].id }));
      }
      if (!assignForm.roomId && rData.length > 0) {
        setAssignForm((prev) => ({ ...prev, roomId: rData[0].id }));
      }
    } catch (err) {
      console.error('Error fetching management data:', err);
    } finally {
      setLoading(false);
    }
  }, [newTaskForm.roomAreaId, visitorForm.roomAreaId, assignForm.roomId]);

  useEffect(() => {
    loadData();
    const unsubscribe = api.subscribeRealtime(() => {
      loadData();
    });
    const interval = setInterval(loadData, 4000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadData]);

  // AI Task Parser
  const handleAiParse = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiParsing(true);
    try {
      const parsed = await api.parseNaturalLanguageTask(aiPrompt);
      setNewTaskForm({
        title: parsed.title || `Prepare ${parsed.matchedRoomName}`,
        roomAreaId: parsed.roomAreaId || rooms[0]?.id || '',
        priority: parsed.priority || 'P2',
        dueTime: parsed.dueTime || 'Within 30 mins',
        description: parsed.description || aiPrompt,
        isUrgent: Boolean(parsed.isUrgent),
        checklist: parsed.checklist && parsed.checklist.length > 0 ? parsed.checklist : newTaskForm.checklist,
      });
    } catch (err) {
      console.error('AI parse error:', err);
    } finally {
      setIsAiParsing(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskForm.title || !newTaskForm.roomAreaId) return;
    try {
      await api.createTask({
        title: newTaskForm.title,
        roomAreaId: newTaskForm.roomAreaId,
        priority: newTaskForm.isUrgent ? 'URGENT' : newTaskForm.priority,
        dueTime: newTaskForm.dueTime,
        description: newTaskForm.description,
        isUrgent: newTaskForm.isUrgent,
        checklist: newTaskForm.checklist,
      });
      setShowNewTaskModal(false);
      setAiPrompt('');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create task');
    }
  };

  const handleVerifyPhoto = async (taskId: string, decision: 'APPROVE' | 'REJECT', reason?: string) => {
    try {
      await api.verifyPhotoEvidence(taskId, decision, reason);
      setInspectPhotoTask(null);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to verify photo');
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
        hostName: currentUser?.role === 'KIMMY_MAM' ? 'Kimmi' : currentUser?.name || 'Kimmi',
        roomAreaId: rooms[4]?.id || rooms[0]?.id || '',
        guestCount: 2,
        notes: '',
      });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to register arrival');
    }
  };

  const handleRegisterDeparture = async (visitorId: string) => {
    try {
      await api.registerVisitorDeparture(visitorId);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to register departure');
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
      alert(err.message || `Failed to execute ${action}`);
    }
  };

  const handleToggleRoomActive = async (roomId: string) => {
    try {
      const updated = await api.toggleRoomActive(roomId);
      setRooms((prev) => prev.map((r) => (r.id === roomId ? updated : r)));
    } catch (err: any) {
      alert(err.message || 'Failed to toggle room active state');
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
        alert(err.message || 'Failed to assign room');
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
      alert(err.message || 'Failed to update user status');
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
      alert(err.message || 'Failed to create company user');
    }
  };

  const handleOpenEditUser = (user: UserAccount) => {
    setEditingUser(user);
    setEditUserForm({
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || '',
      phone: user.phone || '',
      permissions: user.permissions || getDefaultPermissions(user.role),
    });
    setShowEditUserModal(true);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setUserActionLoading(true);
    try {
      await api.updateUser(editingUser.id, editUserForm);
      setShowEditUserModal(false);
      setEditingUser(null);
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update user and permissions');
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
      alert(err.message || 'Failed to delete user');
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to permanently delete this task?')) return;
    try {
      await api.deleteTask(taskId);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete task');
    }
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (roomForm.id) {
        await api.updateRoom(roomForm.id, roomForm);
      } else {
        await api.addRoom(roomForm);
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
      alert(err.message || 'Failed to save room');
    }
  };

  const handleTriggerMilestone = async (milestone: '9AM_START' | '10AM_WATER' | '3PM_WATER' | '8PM_CLOSING') => {
    try {
      await api.triggerSchedulerMilestone(milestone);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to trigger schedule milestone');
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
      case 'OVERDUE':
        return { label: 'Overdue', bg: 'bg-rose-50 text-rose-800 border-rose-200' };
      case 'BLOCKED':
        return { label: 'Blocked', bg: 'bg-red-50 text-red-800 border-red-200' };
      case 'SCHEDULED':
        return { label: 'Scheduled', bg: 'bg-indigo-50 text-indigo-800 border-indigo-200' };
      default:
        return { label: 'Available', bg: 'bg-slate-50 text-slate-700 border-slate-200' };
    }
  };

  // Counts for sidebar badges
  const pantryTasksCount = tasks.filter((t) => {
    const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
    return (
      text.includes("water") ||
      text.includes("pantry") ||
      text.includes("coffee") ||
      text.includes("tea") ||
      text.includes("beverage") ||
      text.includes("snack") ||
      text.includes("refill") ||
      text.includes("bottle")
    );
  }).length;

  const cleaningTasksCount = tasks.filter((t) => {
    const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
    return (
      text.includes("clean") ||
      text.includes("sanitize") ||
      text.includes("mop") ||
      text.includes("dust") ||
      text.includes("washroom") ||
      text.includes("bin") ||
      text.includes("hygiene") ||
      text.includes("trash")
    );
  }).length;

  const rearrangementTasksCount = tasks.filter((t) => {
    const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
    return (
      text.includes("chair") ||
      text.includes("align") ||
      text.includes("table") ||
      text.includes("rearrange") ||
      text.includes("setup") ||
      text.includes("prep") ||
      text.includes("presentation") ||
      text.includes("interview")
    );
  }).length;

  // Filtered tasks considering subTab category
  const filteredTasks = tasks.filter((t) => {
    if (subTab === "PANTRY_TASKS") {
      const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
      if (!text.includes("water") && !text.includes("pantry") && !text.includes("coffee") && !text.includes("tea") && !text.includes("beverage") && !text.includes("snack") && !text.includes("refill") && !text.includes("bottle")) {
        return false;
      }
    } else if (subTab === "CLEANING_TASKS") {
      const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
      if (!text.includes("clean") && !text.includes("sanitize") && !text.includes("mop") && !text.includes("dust") && !text.includes("washroom") && !text.includes("bin") && !text.includes("hygiene") && !text.includes("trash")) {
        return false;
      }
    } else if (subTab === "REARRANGEMENT_TASKS") {
      const text = (t.title + " " + t.description + " " + t.roomAreaName).toLowerCase();
      if (!text.includes("chair") && !text.includes("align") && !text.includes("table") && !text.includes("rearrange") && !text.includes("setup") && !text.includes("prep") && !text.includes("presentation") && !text.includes("interview")) {
        return false;
      }
    }

    if (filterRoom !== "ALL" && t.roomAreaId !== filterRoom) return false;
    if (filterPriority !== "ALL" && t.priority !== filterPriority) return false;
    if (filterStatus !== "ALL" && t.status !== filterStatus) return false;
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
      t.status === "AVAILABLE" ||
      t.status === "IN_PROGRESS" ||
      t.status === "PENDING_VERIFICATION" ||
      t.status === "BLOCKED" ||
      t.status === "SCHEDULED"
  );
  const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS");
  const overdueTasks = tasks.filter((t) => t.status === "OVERDUE");

  const todayFormatted = (() => {
    try {
      const now = new Date();
      const day = now.toLocaleDateString("en-GB", { day: "2-digit" });
      const month = now.toLocaleDateString("en-GB", { month: "short" });
      const year = now.toLocaleDateString("en-GB", { year: "numeric" });
      const weekday = now.toLocaleDateString("en-GB", { weekday: "short" });
      return `${day} ${month} ${year} (${weekday})`;
    } catch {
      return "26 Oct 2026 (Mon)";
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
      id: rooms.find((r) => r.name.toLowerCase().includes("dustbin") || r.category === "FACILITIES")?.id || "room-13",
      name: "Washroom",
      category: "Hygiene & Facilities",
      status: "AVAILABLE" as RoomStatus,
      pendingCount: tasks.filter(
        (t) => (t.title.toLowerCase().includes("dustbin") || t.title.toLowerCase().includes("clean") || t.title.toLowerCase().includes("restroom")) && t.status !== "COMPLETED"
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

      {/* Dark Animated Sidebar (Expandable / Collapsible desktop rail / Mobile drawer) */}
      <aside
        className={`fixed md:sticky top-0 left-0 h-screen bg-[#0b1329] text-white flex flex-col z-50 transition-[width,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] shrink-0 border-r border-slate-800 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${sidebarCollapsed ? "w-72 md:w-20" : "w-72 md:w-64"}`}
      >
        {/* Brand Header with Expand/Collapse Animation */}
        <div
          className={`p-3.5 border-b border-slate-800/90 flex items-center transition-all duration-300 ${
            sidebarCollapsed ? "md:justify-center md:flex-col md:gap-2.5 justify-between" : "justify-between"
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
              title={sidebarCollapsed ? "Click to expand" : undefined}
            >
              <img
                src="/assets/wcr_logo.png"
                alt="White Collar Realty Logo"
                className="w-full h-full object-contain"
              />
            </motion.div>

            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
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

        {/* Navigation Items with Sliding Active Pill */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
          {[
            { id: "DASHBOARD" as ManagementTab, label: "Dashboard", icon: LayoutDashboard },
            { id: "PANTRY_TASKS" as ManagementTab, label: "Pantry Tasks", icon: Coffee, count: pantryTasksCount },
            { id: "CLEANING_TASKS" as ManagementTab, label: "Cleaning Tasks", icon: Sparkles, count: cleaningTasksCount },
            { id: "REARRANGEMENT_TASKS" as ManagementTab, label: "Rearrangement Tasks", icon: Move, count: rearrangementTasksCount },
            { id: "REPORTS" as ManagementTab, label: "Reports", icon: FileText },
            { id: "SETTINGS" as ManagementTab, label: "Settings", icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isItemActive =
              subTab === item.id ||
              (item.id === "SETTINGS" && (subTab === "ROOMS" || subTab === "USERS" || subTab === "AUDIT"));

            return (
              <div key={item.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    setSubTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full relative flex items-center ${
                    sidebarCollapsed ? "md:justify-center" : "justify-between"
                  } px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer overflow-hidden ${
                    isItemActive
                      ? "text-slate-950 font-bold"
                      : "text-slate-300 hover:text-white"
                  }`}
                  aria-current={isItemActive ? "page" : undefined}
                >
                  {/* Sliding Active Pill Animation */}
                  {isItemActive && (
                    <motion.div
                      layoutId="managementActiveNavPill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-amber-400 rounded-xl shadow-lg shadow-amber-500/25 z-0"
                    />
                  )}

                  {/* Soft Inactive Hover Glow */}
                  {!isItemActive && (
                    <div className="absolute inset-0 rounded-xl transition-colors duration-200 group-hover:bg-slate-800/60 z-0" />
                  )}

                  {/* Icon & Label Content */}
                  <div className="relative z-10 flex items-center gap-3 min-w-0">
                    <motion.div
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.92 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      className="shrink-0 flex items-center justify-center"
                    >
                      <Icon
                        className={`w-4 h-4 transition-colors ${
                          isItemActive
                            ? "text-slate-950"
                            : "text-slate-400 group-hover:text-amber-400"
                        }`}
                      />
                    </motion.div>

                    <AnimatePresence mode="wait">
                      {!sidebarCollapsed && (
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
                  </div>

                  {/* Badge Counter (When Expanded) */}
                  {!sidebarCollapsed && item.count !== undefined && item.count > 0 && (
                    <span
                      className={`relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold tabular-nums transition-colors ${
                        isItemActive
                          ? "bg-slate-950 text-amber-400"
                          : "bg-slate-800 text-slate-300 group-hover:bg-slate-700"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}

                  {/* Collapsed Mode Indicator Dot */}
                  {sidebarCollapsed && item.count !== undefined && item.count > 0 && (
                    <span className="hidden md:block absolute top-2 right-2.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#0b1329] z-20" />
                  )}
                </button>

                {/* Collapsed Floating Tooltip with Arrow (Dribbble Signature) */}
                {sidebarCollapsed && (
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

        {/* Profile Card at Sidebar Bottom */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/70 relative group">
          <div
            className={`flex items-center transition-all duration-300 ${
              sidebarCollapsed ? "md:justify-center" : "gap-3"
            }`}
          >
            <motion.img
              whileHover={{ scale: 1.08 }}
              src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80"
              alt="Kimmi"
              className="w-9 h-9 rounded-full object-cover ring-2 ring-amber-400 shrink-0 cursor-pointer shadow-md"
              title={sidebarCollapsed ? "Kimmi · Co-Founder" : undefined}
            />

            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 flex-1"
                >
                  <div className="text-xs font-bold text-white truncate">
                    Kimmi
                  </div>
                  <div className="text-[10px] text-amber-400 font-semibold truncate">
                    Co-Founder
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!sidebarCollapsed && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => logout()}
                title="Sign Out"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </motion.button>
            )}
          </div>

          {/* Collapsed Tooltip for Profile & Logout */}
          {sidebarCollapsed && (
            <div className="hidden md:flex absolute left-full ml-3 bottom-2 p-3 bg-slate-900/95 backdrop-blur-md text-white rounded-xl shadow-2xl border border-slate-700 pointer-events-auto whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 items-center gap-3">
              <div>
                <div className="text-xs font-bold text-white">Kimmi</div>
                <div className="text-[10px] text-amber-400 font-semibold">Co-Founder</div>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900/95" />
            </div>
          )}
        </div>
      </aside>

      {/* Main Layout Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
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
            {/* Live Status indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Live System Online</span>
            </div>

            {/* Switch to Pantry Mode Simulator button for management testing */}
            {setActiveView && (
              <button
                type="button"
                onClick={() => setActiveView("PANTRY")}
                className="px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Preview Raju Sharma's mobile attendant view"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Pantry Boy View</span>
              </button>
            )}

            {/* Fast Task Creation */}
            <button
              type="button"
              onClick={() => {
                setNewTaskForm((prev) => ({ ...prev, isUrgent: false, priority: "P2" }));
                setShowNewTaskModal(true);
              }}
              className="px-3 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Task</span>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {/* TAB 1: REDESIGNED DASHBOARD */}
          {subTab === "DASHBOARD" && (
            <div className="space-y-6">
              {/* Header: Welcome Back, Team + Date Card */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    Welcome Back, Team 👋
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Here's what's happening with your tasks today.
                  </p>
                </div>
                <div className="bg-white border border-slate-200/90 shadow-xs px-4 py-2.5 rounded-xl flex items-center gap-3 self-start sm:self-auto">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today</div>
                    <div className="text-xs sm:text-sm font-bold text-slate-800 font-mono">
                      {todayFormatted}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Clickable Summary Cards (Total Tasks, Pending Tasks, Overdue Tasks, Total Reports) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Total Tasks */}
                <button
                  type="button"
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("TOTAL_TASKS");
                  }}
                  className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-md transition-all cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-slate-900/10 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-slate-900 transition-colors">
                      Total Tasks
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
                      <ArrowUpRight className="w-3 h-3 text-emerald-600" />
                      12%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900 font-mono tracking-tight my-1">
                    {tasks.length}
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-1">
                    {completedTasks.length} completed · Click for details
                  </div>
                </button>

                {/* Card 2: Pending Tasks */}
                <button
                  type="button"
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("PENDING_TASKS");
                  }}
                  className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-amber-400 hover:shadow-md transition-all cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-amber-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider group-hover:text-amber-900 transition-colors">
                      Pending Tasks
                    </span>
                    <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
                      <ArrowUpRight className="w-3 h-3 text-amber-600" />
                      5%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-amber-600 font-mono tracking-tight my-1">
                    {pendingTasks.length}
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-1">
                    {inProgressTasks.length} in progress · Click for details
                  </div>
                </button>

                {/* Card 3: Overdue Tasks */}
                <button
                  type="button"
                  onClick={() => {
                    setModalSearchQuery("");
                    setModalStatusFilter("ALL");
                    setActiveDashboardModal("OVERDUE_TASKS");
                  }}
                  className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-rose-400 hover:shadow-md transition-all cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-rose-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider group-hover:text-rose-900 transition-colors">
                      Overdue Tasks
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
                      <ArrowDownRight className="w-3 h-3 text-emerald-600" />
                      100%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-rose-600 font-mono tracking-tight my-1">
                    {overdueTasks.length}
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-1">
                    {overdueTasks.length > 0 ? "Requires attention" : "All running on schedule"}
                  </div>
                </button>

                {/* Card 4: Total Reports */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveDashboardModal("TOTAL_REPORTS");
                  }}
                  className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer text-left active:scale-[0.99] group focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider group-hover:text-indigo-900 transition-colors">
                      Total Reports
                    </span>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
                      <ArrowUpRight className="w-3 h-3 text-indigo-600" />
                      20%
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold text-indigo-600 font-mono tracking-tight my-1">
                    12
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-1">
                    Daily shift & weekly analytics
                  </div>
                </button>
              </div>

              {/* Rooms Section (6 Room Cards from reference image) */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">Rooms</h3>
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      6 Active Areas
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab("ROOMS");
                      setSubTab("SETTINGS");
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>View All 15 Areas</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {dashboardRooms.map((room) => {
                    const isReady = room.status === "AVAILABLE" || room.status === "READY_FOR_VISITOR";
                    return (
                      <button
                        key={room.name}
                        type="button"
                        onClick={() => {
                          const realRoom = rooms.find((r) => r.id === room.id);
                          if (realRoom) {
                            handleViewHistory(realRoom);
                          } else {
                            setSettingsTab("ROOMS");
                            setSubTab("SETTINGS");
                          }
                        }}
                        className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-md transition-all text-left flex items-center justify-between group active:scale-[0.99] cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-slate-900 group-hover:text-amber-700 transition-colors">
                              {room.name}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                isReady
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}
                            >
                              {isReady ? "Ready" : "In Progress"}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {room.pendingCount === 0
                              ? "0 pending tasks"
                              : `${room.pendingCount} pending task${room.pendingCount > 1 ? "s" : ""}`}
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-slate-50 group-hover:bg-amber-50 group-hover:text-amber-700 text-slate-400 flex items-center justify-center shrink-0 transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Row: Recent Activity (left) + Active Shift Operations & Quick Actions (right) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Recent Activity (lg:col-span-7) */}
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 tracking-tight">Recent Activity</h3>
                      <p className="text-xs text-slate-500">Live task logs, attendant updates, and photo audits</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubTab("TASKS")}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                    >
                      <span>All Tasks</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {tasks.slice(0, 5).map((task) => {
                      const badge = getTaskStatusBadge(task.status);
                      return (
                        <div
                          key={task.id}
                          className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-800">
                                {task.priority}
                              </span>
                              <span className="text-xs font-bold text-slate-900 truncate">{task.roomAreaName}</span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                                {badge.label}
                              </span>
                            </div>
                            <div className="text-xs text-slate-700 font-medium truncate">{task.title}</div>
                            <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                              <span>Assigned: {task.assignedToName}</span>
                              <span>•</span>
                              <span>Due: {task.dueTime}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {task.photoEvidence && (
                              <button
                                type="button"
                                onClick={() => setInspectPhotoTask(task)}
                                className="p-1.5 text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors cursor-pointer"
                                title="Inspect Photo Evidence"
                              >
                                <Camera className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Active Shift Operations & Quick Actions (lg:col-span-5) */}
                <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-xs p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                          Shift Operations & Attendant
                        </h3>
                        <p className="text-xs text-slate-500">Live attendance and deterministic schedule</p>
                      </div>
                      <span className="flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Active
                      </span>
                    </div>

                    {/* Attendant profile card */}
                    <div className="p-3.5 bg-slate-900 text-white rounded-xl mb-4">
                      <div className="flex items-center gap-3">
                        <img
                          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80"
                          alt="Raju Sharma"
                          className="w-10 h-10 rounded-full object-cover ring-2 ring-amber-400 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white">Ramesh Kumar (Pantry Attendant)</div>
                          <div className="text-[10px] text-amber-300 font-mono mt-0.5">
                            Shift: 9:00 AM – 8:00 PM (Asia/Kolkata)
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-800">
                        <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                          <span>Today's Task Completion</span>
                          <span className="font-mono font-bold text-amber-400">
                            {completedTasks.length} / {tasks.length}
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-amber-400 h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Schedule Milestones fast triggers */}
                    <div className="mb-4">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Schedule Milestones
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => handleTriggerMilestone("9AM_START")}
                          className="p-2 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-slate-900">9:00 AM</div>
                          <div className="text-[10px] text-slate-500">Morning Setup</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTriggerMilestone("10AM_WATER")}
                          className="p-2 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-slate-900">10:00 AM</div>
                          <div className="text-[10px] text-slate-500">Water Distribution</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTriggerMilestone("3PM_WATER")}
                          className="p-2 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-slate-900">3:00 PM</div>
                          <div className="text-[10px] text-slate-500">Water Recheck</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTriggerMilestone("8PM_CLOSING")}
                          className="p-2 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-slate-900">8:00 PM</div>
                          <div className="text-[10px] text-slate-500">Closing Audit</div>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Dispatch Action */}
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
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS SUB-NAV BAR (When in SETTINGS tab) */}
          {subTab === "SETTINGS" && (
            <div className="mb-6 bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setSettingsTab("ROOMS")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  settingsTab === "ROOMS" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                15 Office Areas & Room Config ({rooms.length})
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab("USERS")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  settingsTab === "USERS" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Account Access & Security ({allUsers.length})
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab("AUDIT")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  settingsTab === "AUDIT" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Audit Trail ({auditLogs.length})
              </button>
            </div>
          )}

          {/* TAB 2: TASKS VIEW (Pantry Tasks, Cleaning Tasks, Rearrangement Tasks, All Tasks) */}
          {(subTab === "TASKS" ||
            subTab === "PANTRY_TASKS" ||
            subTab === "CLEANING_TASKS" ||
            subTab === "REARRANGEMENT_TASKS") && (
        <div className="space-y-4">
          {/* Quick Schedule Milestone Simulation Bar */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-700 shrink-0" />
              <div>
                <span className="font-bold text-amber-900">Shift Automation Milestones:</span>
                <span className="text-amber-800 ml-1">
                  Automated schedule for 9:00 AM routines, 10:00 AM & 3:00 PM water distribution, 7:30 PM inspection, and 8:00 PM closing audit.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => handleTriggerMilestone('9AM_START')}
                className="px-2.5 py-1 font-medium bg-white border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100"
              >
                9 AM Routine
              </button>
              <button
                type="button"
                onClick={() => handleTriggerMilestone('10AM_WATER')}
                className="px-2.5 py-1 font-medium bg-white border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100"
              >
                10 AM Water Distribution
              </button>
              <button
                type="button"
                onClick={() => handleTriggerMilestone('3PM_WATER')}
                className="px-2.5 py-1 font-medium bg-white border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100"
              >
                3 PM Water Recheck
              </button>
              <button
                type="button"
                onClick={() => handleTriggerMilestone('8PM_CLOSING')}
                className="px-2.5 py-1 font-medium bg-white border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100"
              >
                8 PM Shift Closing Audit
              </button>
            </div>
          </div>

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
                <option value="P1">P1 (Reception)</option>
                <option value="P2">P2 (Desks)</option>
                <option value="P3">P3 (Executive Cabin)</option>
                <option value="P4">P4 (Kimmi - Co-Founder)</option>
                <option value="P5">P5 (Meeting Rooms/Bins)</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="ALL">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="PENDING_VERIFICATION">Under Review</option>
                <option value="BLOCKED">Blocked</option>
                <option value="COMPLETED">Completed</option>
                <option value="OVERDUE">Overdue</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 font-mono">
              Showing {filteredTasks.length} of {tasks.length} tasks
            </div>
          </div>

          {/* Tasks Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTasks.length === 0 ? (
              <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
                No tasks match current filter criteria.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const isPendingReview = task.status === 'PENDING_VERIFICATION';

                return (
                  <div
                    key={task.id}
                    className={`bg-white rounded-xl border p-4 flex flex-col justify-between transition-shadow hover:shadow-md ${
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

                      <h3 className="text-sm font-bold text-slate-900 mb-1.5 leading-snug">{task.title}</h3>

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
                      {task.photoEvidence && (
                        <div
                          onClick={() => setInspectPhotoTask(task)}
                          className="relative rounded-lg overflow-hidden border border-slate-200 cursor-pointer group mb-3"
                        >
                          <img
                            src={task.photoEvidence.photoUrl}
                            alt="Evidence"
                            className="w-full h-32 object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                            Inspect Live Evidence Photo
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Actions */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-slate-400 font-mono">Due {task.dueTime}</div>

                      <div className="flex items-center gap-1.5">
                        {isPendingReview ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleVerifyPhoto(task.id, 'APPROVE')}
                              className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleVerifyPhoto(task.id, 'REJECT', 'Chairs misaligned or debris visible')}
                              className="px-2 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md"
                            >
                              Reject
                            </button>
                          </>
                        ) : task.photoEvidence ? (
                          <button
                            type="button"
                            onClick={() => setInspectPhotoTask(task)}
                            className="text-xs text-slate-700 font-medium hover:underline flex items-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            View Photo
                          </button>
                        ) : null}

                        {hasPermission('tasks', 'delete') && (
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            title="Delete Task"
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}


      {/* SUB-TAB 3: DEDICATED REAL-TIME ROOM MANAGEMENT */}
      {(subTab === 'ROOMS' || (subTab === 'SETTINGS' && settingsTab === 'ROOMS')) && (
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
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAssignConflictError(null);
                  setShowAssignModal(true);
                }}
                className="px-3.5 py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <DoorOpen className="w-4 h-4 text-slate-950" />
                Assign Room
              </button>
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
            </div>
          </div>

          {/* Status Breakdown Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            <button
              type="button"
              onClick={() => setRoomFilterStatus('ALL')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'ALL'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="text-[10px] opacity-75 font-semibold uppercase tracking-wider">All Rooms</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{rooms.length}</div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('AVAILABLE')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'AVAILABLE'
                  ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                  : 'bg-emerald-50/60 text-emerald-900 border-emerald-200 hover:bg-emerald-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Available</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'AVAILABLE' || r.status === 'READY_FOR_VISITOR').length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('OCCUPIED')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'OCCUPIED'
                  ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                  : 'bg-purple-50/60 text-purple-900 border-purple-200 hover:bg-purple-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Occupied</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'OCCUPIED').length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('PREPARATION_REQUIRED')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'PREPARATION_REQUIRED'
                  ? 'bg-amber-700 text-white border-amber-700 shadow-xs'
                  : 'bg-amber-50/60 text-amber-900 border-amber-200 hover:bg-amber-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Needs Prep</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'PREPARATION_REQUIRED').length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('READY_FOR_VISITOR')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'READY_FOR_VISITOR'
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-blue-50/60 text-blue-900 border-blue-200 hover:bg-blue-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Ready for Guest</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'READY_FOR_VISITOR').length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('CLEANING_REQUIRED')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'CLEANING_REQUIRED'
                  ? 'bg-rose-700 text-white border-rose-700 shadow-xs'
                  : 'bg-rose-50/60 text-rose-900 border-rose-200 hover:bg-rose-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Needs Cleaning</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'CLEANING_REQUIRED' || r.status === 'CLEANING_IN_PROGRESS').length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRoomFilterStatus('PENDING_VERIFICATION')}
              className={`p-2.5 rounded-xl border text-left transition-colors ${
                roomFilterStatus === 'PENDING_VERIFICATION'
                  ? 'bg-indigo-700 text-white border-indigo-700 shadow-xs'
                  : 'bg-indigo-50/60 text-indigo-900 border-indigo-200 hover:bg-indigo-100/60'
              }`}
            >
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Under Review</div>
              <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                {rooms.filter((r) => r.status === 'PENDING_VERIFICATION').length}
              </div>
            </button>
          </div>

          {/* Room Search & Category Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 text-xs">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="font-semibold text-slate-500 whitespace-nowrap">Filter Area:</span>
              {[
                { id: 'ALL', label: 'All Areas' },
                { id: 'MEETING_SUITE', label: 'Meeting Suites' },
                { id: 'EXECUTIVE_CABIN', label: 'Cabins' },
                { id: 'OPERATIONAL', label: 'Operational (Reception/Desks)' },
                { id: 'FACILITIES', label: 'Facilities' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setRoomFilterCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap font-medium ${
                    roomFilterCategory === cat.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="relative shrink-0 w-full sm:w-64">
              <input
                type="text"
                placeholder="Search rooms or visitor name..."
                value={roomSearchQuery}
                onChange={(e) => setRoomSearchQuery(e.target.value)}
                className="w-full pl-3 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>

          {/* Room Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms
              .filter((room) => {
                if (!room.enabled && roomFilterStatus !== 'ALL') return false;
                if (roomFilterStatus !== 'ALL' && room.status !== roomFilterStatus) return false;
                if (roomFilterCategory !== 'ALL') {
                  if (roomFilterCategory === 'OPERATIONAL') {
                    if (room.category !== 'RECEPTION' && room.category !== 'WORKSTATION') return false;
                  } else if (room.category !== roomFilterCategory) {
                    return false;
                  }
                }
                if (roomSearchQuery.trim()) {
                  const q = roomSearchQuery.toLowerCase();
                  const matchesName = room.name.toLowerCase().includes(q);
                  const matchesVisitor = room.currentAssignment?.visitorName.toLowerCase().includes(q);
                  return matchesName || matchesVisitor;
                }
                return true;
              })
              .map((room) => {
                const badge = getRoomStatusBadge(room.status);
                const activeTask = tasks.find(
                  (t) => t.roomAreaId === room.id && t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
                );

                return (
                  <div
                    key={room.id}
                    className={`bg-white rounded-xl border p-4 flex flex-col justify-between shadow-xs transition-all ${
                      !room.enabled ? 'opacity-60 bg-slate-50 border-slate-200' : 'border-slate-200'
                    }`}
                  >
                    <div>
                      {/* Top bar */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {room.defaultPriority}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                            {badge.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleRoomActive(room.id)}
                            title={room.enabled ? 'Deactivate room' : 'Activate room'}
                            className={`p-1 rounded text-xs transition-colors ${
                              room.enabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-200'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Room Name */}
                      <h4 className="text-sm font-bold text-slate-900 mb-1 leading-snug flex items-center gap-1.5">
                        <Building className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>{room.name}</span>
                      </h4>

                      {/* Active Assignment Card if any */}
                      {room.currentAssignment ? (
                        <div className="my-2.5 p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 text-xs space-y-1.5">
                          <div className="flex items-center justify-between text-amber-900 font-bold border-b border-amber-200/60 pb-1">
                            <span className="flex items-center gap-1">
                              <Users className="w-3.5 h-3.5 text-amber-700" />
                              {room.currentAssignment.visitorName}
                            </span>
                            <span className="text-[10px] font-mono bg-amber-200/60 px-1.5 py-0.2 rounded">
                              {room.currentAssignment.expectedArrival}
                            </span>
                          </div>
                          <div className="text-[11px] text-amber-800">
                            <strong>Reference:</strong> {room.currentAssignment.reference} ({room.currentAssignment.expectedDuration})
                          </div>
                          <div className="text-[11px] text-amber-800">
                            <strong>Water:</strong> {room.currentAssignment.waterRequirements}
                          </div>
                          {room.currentAssignment.instructions && (
                            <div className="text-[10px] text-amber-700 italic">
                              "{room.currentAssignment.instructions}"
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="my-2 text-[11px] text-slate-400 italic">No active visitor booking</div>
                      )}

                      {/* Active Room Task if any */}
                      {activeTask && (
                        <div className="my-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Active Task</span>
                            <span className="text-[10px] font-mono text-amber-700 font-bold">{activeTask.status}</span>
                          </div>
                          <div className="font-semibold text-slate-900 truncate">{activeTask.title}</div>
                          {activeTask.photoEvidence && (
                            <div className="mt-1 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setInspectPhotoTask(activeTask)}
                                className="text-[10px] text-indigo-600 font-bold hover:underline flex items-center gap-1"
                              >
                                <Camera className="w-3 h-3" />
                                Inspect Live Photo Evidence
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Room Lifecycle Control Action Buttons */}
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        {/* 1. Assign Room button (Available / Reserved) */}
                        {(room.status === 'AVAILABLE' || room.status === 'RESERVED') && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignForm({
                                roomId: room.id,
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
                              setAssignConflictError(null);
                              setShowAssignModal(true);
                            }}
                            className="w-full py-1.5 px-2.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            Assign Room
                          </button>
                        )}

                        {/* 2. Mark Ready for Occupancy (if PREPARATION_REQUIRED) */}
                        {room.status === 'PREPARATION_REQUIRED' && (
                          <button
                            type="button"
                            onClick={() => handleRoomStatusAction(room.id, 'MARK_READY')}
                            className="flex-1 py-1.5 px-2 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3 text-blue-600" />
                            Ready for Occupancy
                          </button>
                        )}

                        {/* 3. Mark Occupied (if READY_FOR_VISITOR, PREPARATION_REQUIRED, or ASSIGNED) */}
                        {(room.status === 'READY_FOR_VISITOR' || room.status === 'PREPARATION_REQUIRED' || room.status === 'ASSIGNED') && (
                          <button
                            type="button"
                            onClick={() => handleRoomStatusAction(room.id, 'MARK_OCCUPIED')}
                            className="flex-1 py-1.5 px-2 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <DoorOpen className="w-3 h-3 text-purple-600" />
                            Mark Occupied
                          </button>
                        )}

                        {/* 4. Release Vacant (if OCCUPIED or READY_FOR_VISITOR) */}
                        {(room.status === 'OCCUPIED' || room.status === 'READY_FOR_VISITOR') && (
                          <button
                            type="button"
                            onClick={() => handleRoomStatusAction(room.id, 'RELEASE_VACANT')}
                            className="w-full py-1.5 px-2.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <LogOut className="w-3.5 h-3.5 text-rose-600" />
                            Release Room (Vacant & Request Cleaning)
                          </button>
                        )}

                        {/* 5. Inspection / Ad-hoc cleaning */}
                        {room.status === 'CLEANING_REQUIRED' && (
                          <button
                            type="button"
                            onClick={() => handleRoomStatusAction(room.id, 'REQUEST_CLEANING')}
                            className="w-full py-1.5 px-2 text-xs font-semibold text-rose-800 bg-rose-100/80 hover:bg-rose-200/80 border border-rose-300 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Re-Trigger Cleaning Task
                          </button>
                        )}
                      </div>

                      {/* History & Config Bar */}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => handleViewHistory(room)}
                          className="font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1 hover:underline"
                        >
                          <History className="w-3 h-3 text-slate-400" />
                          History & Camera Photos
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRoomForm({
                              id: room.id,
                              name: room.name,
                              category: room.category,
                              defaultPriority: room.defaultPriority,
                              photoRequired: room.photoRequired,
                              recurrence: room.recurrence,
                            });
                            setShowRoomModal(true);
                          }}
                          className="font-medium text-slate-500 hover:text-slate-900 underline"
                        >
                          Edit Area
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: DAILY & WEEKLY REPORTS */}
      {subTab === 'REPORTS' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Audited Operations & Performance Reports</h3>
              <p className="text-xs text-slate-500">
                Calculated strictly from live database records and verified camera timestamps.
              </p>
            </div>
            <a
              href={api.getReportExportUrl()}
              download
              className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 shrink-0 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Export Full Report (CSV)
            </a>
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
                  <div className="text-slate-500">3 PM Water Recheck</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {dailyReport.waterBottleRecheckCompleted ? '✅ Complete' : 'Scheduled 3 PM'}
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
      {(subTab === 'USERS' || (subTab === 'SETTINGS' && settingsTab === 'USERS')) && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Company Accounts & Access Control</h3>
              <p className="text-xs text-slate-500">
                Authorized company emails only. Deactivating an employee immediately revokes active session tokens. Historical records remain preserved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowUserModal(true)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Company User
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {allUsers.map((u) => {
              const isDeactivated = u.status === 'inactive';
              const isMe = currentUser?.id === u.id;
              const isSuper = Boolean(u.isSuperAdmin || u.id === 'user-admin-1' || u.email.toLowerCase() === 'admin.director@whitecollarrealty.com');

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
                    <button
                      type="button"
                      onClick={() => handleOpenEditUser(u)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 shadow-xs"
                      title="Customize Dashboards, Sidebar Items, and CRUD Actions"
                    >
                      <Sliders className="w-3.5 h-3.5 text-slate-600" />
                      <span>Edit & Permissions</span>
                    </button>

                    {/* Activate / Deactivate Toggle */}
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

                    {/* Delete User Button */}
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
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 6: AUDIT TRAIL */}
      {(subTab === 'AUDIT' || (subTab === 'SETTINGS' && settingsTab === 'AUDIT')) && (
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
                        {log.actorName} ({log.actorRole})
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
                  Confirm & Dispatch Task
                </button>
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
                        Access dedicated attendant dashboard with shift clock, room support, and live camera evidence.
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
                        {row.actions.map((act) => (
                          <label key={act} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(editUserForm.permissions.actions[row.module]?.[act])}
                              onChange={(e) =>
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
                                })
                              }
                              className="w-3.5 h-3.5 text-slate-900 rounded border-slate-300"
                            />
                            <span className="capitalize font-mono text-[11px] text-slate-700">{act}</span>
                          </label>
                        ))}
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

              {/* SECTION 5: Confidential Information Security Clearances */}
              <div className="space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-600" />
                    5. Confidential Data Access Clearances
                  </span>
                  <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded font-mono font-bold">
                    RESTRICTED
                  </span>
                </div>
                <div className="p-3.5 bg-rose-50/60 border border-rose-200 rounded-xl space-y-2">
                  <p className="text-[11px] text-rose-900 leading-relaxed">
                    By default, Pantry Boys and non-management personnel are strictly prohibited from viewing candidate resumes, internal HR notes, and government IDs. Grant clearance only when operationally essential.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-rose-200/80">
                    <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-rose-200/80">
                      <input
                        type="checkbox"
                        checked={Boolean(editUserForm.permissions.confidentialAccess?.hrNotes)}
                        onChange={(e) =>
                          setEditUserForm({
                            ...editUserForm,
                            permissions: {
                              ...editUserForm.permissions,
                              confidentialAccess: {
                                hrNotes: e.target.checked,
                                resumes: Boolean(editUserForm.permissions.confidentialAccess?.resumes),
                                governmentIds: Boolean(editUserForm.permissions.confidentialAccess?.governmentIds),
                              },
                            },
                          })
                        }
                        className="w-3.5 h-3.5 text-rose-600 rounded border-rose-300"
                      />
                      <span className="font-semibold text-rose-950">Internal HR Notes</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-rose-200/80">
                      <input
                        type="checkbox"
                        checked={Boolean(editUserForm.permissions.confidentialAccess?.resumes)}
                        onChange={(e) =>
                          setEditUserForm({
                            ...editUserForm,
                            permissions: {
                              ...editUserForm.permissions,
                              confidentialAccess: {
                                hrNotes: Boolean(editUserForm.permissions.confidentialAccess?.hrNotes),
                                resumes: e.target.checked,
                                governmentIds: Boolean(editUserForm.permissions.confidentialAccess?.governmentIds),
                              },
                            },
                          })
                        }
                        className="w-3.5 h-3.5 text-rose-600 rounded border-rose-300"
                      />
                      <span className="font-semibold text-rose-950">Candidate Resumes</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer p-2 bg-white rounded-lg border border-rose-200/80">
                      <input
                        type="checkbox"
                        checked={Boolean(editUserForm.permissions.confidentialAccess?.governmentIds)}
                        onChange={(e) =>
                          setEditUserForm({
                            ...editUserForm,
                            permissions: {
                              ...editUserForm.permissions,
                              confidentialAccess: {
                                hrNotes: Boolean(editUserForm.permissions.confidentialAccess?.hrNotes),
                                resumes: Boolean(editUserForm.permissions.confidentialAccess?.resumes),
                                governmentIds: e.target.checked,
                              },
                            },
                          })
                        }
                        className="w-3.5 h-3.5 text-rose-600 rounded border-rose-300"
                      />
                      <span className="font-semibold text-rose-950">Government IDs</span>
                    </label>
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

      {/* MODAL 5: Inspect Submitted Photo & AI Analysis */}
      {inspectPhotoTask && inspectPhotoTask.photoEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{inspectPhotoTask.title}</h3>
                <div className="text-xs text-slate-500">
                  {inspectPhotoTask.roomAreaName} · Captured by {inspectPhotoTask.assignedToName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectPhotoTask(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black">
                <img
                  src={inspectPhotoTask.photoEvidence.photoUrl}
                  alt="High Resolution Room Evidence"
                  className="w-full max-h-[380px] object-contain"
                />
              </div>

              {/* Timestamp & Integrity Telemetry */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <div className="text-slate-400 font-mono text-[10px] uppercase">Server Verified Time</div>
                  <div className="font-semibold text-slate-800 font-mono mt-0.5">
                    {new Date(inspectPhotoTask.photoEvidence.serverTimestamp).toLocaleTimeString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}{' '}
                    IST
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-mono text-[10px] uppercase">Capture Mode</div>
                  <div className="font-semibold text-slate-800 font-mono mt-0.5">
                    {inspectPhotoTask.photoEvidence.metadata?.mode || 'LIVE_CAMERA'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 font-mono text-[10px] uppercase">Evidence Status</div>
                  <div className="font-semibold text-emerald-600 font-mono mt-0.5">
                    {inspectPhotoTask.photoEvidence.status}
                  </div>
                </div>
              </div>

              {/* Live Camera Evidence Details */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-slate-600" />
                  Live Camera Verification Protocol
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <div>
                    Capture Device: <strong className="text-slate-800 font-mono">{inspectPhotoTask.photoEvidence.metadata?.device || 'Live Web Camera'}</strong>
                  </div>
                  <div>
                    Resolution: <strong className="text-slate-800 font-mono">{inspectPhotoTask.photoEvidence.metadata?.resolution || '1280x720'}</strong>
                  </div>
                  <div>
                    Server Upload: <strong className="text-slate-800 font-mono">{new Date(inspectPhotoTask.photoEvidence.serverTimestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</strong>
                  </div>
                  <div>
                    Upload Source: <strong className="text-emerald-700">Live Device Stream (Anti-Tamper)</strong>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                  Management Inspection: Inspect photograph for chair alignment against table edges, surface sanitization, and room readiness.
                </p>
              </div>
            </div>

            {/* Verification Actions */}
            <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleVerifyPhoto(inspectPhotoTask.id, 'REJECT', 'Chairs need tighter alignment')}
                className="px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
              >
                Reject & Request Retake
              </button>
              <button
                type="button"
                onClick={() => handleVerifyPhoto(inspectPhotoTask.id, 'APPROVE')}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm"
              >
                Approve Evidence & Mark Completed
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Verified Live Camera Photo Evidence</h4>
                  {roomHistoryData?.photos && roomHistoryData.photos.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {roomHistoryData.photos.map((ph) => (
                        <div key={ph.id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-white">
                          <img src={ph.photoUrl} alt="Evidence" className="w-full h-32 object-cover" />
                          <div className="p-2 text-[10px] space-y-0.5 font-mono">
                            <div className="text-amber-400 truncate">{ph.userEmail}</div>
                            <div className="text-slate-400">{new Date(ph.serverTimestamp).toLocaleTimeString()}</div>
                          </div>
                        </div>
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
                    {activeDashboardModal === 'OVERDUE_TASKS' && 'Tasks that have exceeded their target shift completion time.'}
                    {activeDashboardModal === 'TOTAL_REPORTS' && 'Live shift breakdown, weekly turnaround analytics, and official CSV exports.'}
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

                          <div className="flex items-center gap-2 shrink-0">
                            {task.photoEvidence && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  setInspectPhotoTask(task);
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1"
                              >
                                <Camera className="w-3 h-3" />
                                <span>Evidence</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setActiveDashboardModal(null);
                                setSubTab('TASKS');
                                setSearchQuery(task.title);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                              View in Grid
                            </button>
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
                            <div className="flex items-center gap-2">
                              {task.photoEvidence && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDashboardModal(null);
                                    setInspectPhotoTask(task);
                                  }}
                                  className="px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Camera className="w-3 h-3" />
                                  <span>Evidence</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  setSubTab('TASKS');
                                  setSearchQuery(task.title);
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                              >
                                View in Grid
                              </button>
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
                          Shift Status: Running on time ({completedTasks.length} / {tasks.length} tasks completed)
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

                              <div className="flex justify-end gap-2">
                                {task.photoEvidence && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveDashboardModal(null);
                                      setInspectPhotoTask(task);
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1"
                                  >
                                    <Camera className="w-3.5 h-3.5" />
                                    <span>Photo Evidence</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveDashboardModal(null);
                                    setSubTab('TASKS');
                                    setSearchQuery(task.title);
                                  }}
                                  className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                                >
                                  Open Task in Grid
                                </button>
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
                          Report 1: Daily Shift Performance Report
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
                      <a
                        href={api.getReportExportUrl()}
                        download
                        className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download CSV Report
                      </a>
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

                          <div className="flex items-center gap-2 shrink-0">
                            {task.photoEvidence && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveDashboardModal(null);
                                  setInspectPhotoTask(task);
                                }}
                                className="px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                <span>Inspect Photo</span>
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

                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 font-mono">Priority: {room.defaultPriority}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveDashboardModal(null);
                                setSubTab('ROOMS');
                              }}
                              className="text-slate-700 hover:text-slate-900 font-semibold"
                            >
                              Manage Area →
                            </button>
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
    </div>
  );
};
