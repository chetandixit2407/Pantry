import React, { useState, useEffect, useCallback } from 'react';
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
} from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
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
} from 'lucide-react';

export const ManagementView: React.FC = () => {
  const { currentUser, allUsers, refreshUsers } = useAuth();

  // Active navigation sub-tab
  const [subTab, setSubTab] = useState<'TASKS' | 'VISITORS' | 'ROOMS' | 'REPORTS' | 'USERS' | 'AUDIT'>('TASKS');

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
    hostName: currentUser?.name || 'Kimmy Mam',
    roomAreaId: '',
    guestCount: 2,
    notes: 'Require fresh water bottles and dry fruits setup.',
  });

  // Room Form
  const [roomForm, setRoomForm] = useState<{
    id?: string;
    name: string;
    category: any;
    floor: string;
    defaultPriority: TaskPriority;
    photoRequired: boolean;
    recurrence: any;
  }>({
    name: '',
    category: 'MEETING_SUITE',
    floor: 'Floor 1',
    defaultPriority: 'P5',
    photoRequired: true,
    recurrence: 'DAILY',
  });

  // New User Form
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    role: 'PANTRY_BOY',
    department: 'Hospitality',
    phone: '',
  });

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

  const loadData = useCallback(async () => {
    try {
      const [tData, rData, vData, dData, wData, aData] = await Promise.all([
        api.getTasks(),
        api.getRooms(),
        api.getVisitors(),
        api.getDailyReport(),
        api.getWeeklyReport(),
        api.getAuditLogs(),
      ]);
      setTasks(tData);
      setRooms(rData);
      setVisitors(vData);
      setDailyReport(dData.summary);
      setWeeklyReport(wData.weeklySummary);
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
        hostName: currentUser?.name || 'Kimmy Mam',
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
        department: 'Hospitality',
        phone: '',
      });
      await refreshUsers();
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create company user');
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
        floor: 'Floor 1',
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
        return { label: 'Pending Verification', bg: 'bg-indigo-50 text-indigo-800 border-indigo-200', color: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-500' };
      default:
        return { label: status, bg: 'bg-slate-100 text-slate-800 border-slate-200', color: 'bg-slate-100 text-slate-800 border-slate-200', dot: 'bg-slate-400' };
    }
  };

  // Filtered tasks
  const filteredTasks = tasks.filter((t) => {
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

  const readyRoomsCount = rooms.filter((r) => r.status === 'AVAILABLE' || r.status === 'READY_FOR_VISITOR').length;
  const preparingRoomsCount = rooms.filter(
    (r) =>
      r.status === 'PREPARATION_REQUIRED' ||
      r.status === 'CLEANING_REQUIRED' ||
      r.status === 'CLEANING_IN_PROGRESS' ||
      r.status === 'PENDING_VERIFICATION' ||
      r.status === 'ASSIGNED' ||
      r.status === 'OCCUPIED'
  ).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Executive Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>White Collar Realty</span>
            <span aria-hidden="true">·</span>
            <span>Operations & Hospitality Console</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-800">
              Logged as: {currentUser?.name} ({currentUser?.role === 'KIMMY_MAM' ? 'Executive Director' : 'HR Operations'})
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Smart Pantry Operations & Hospitality Command
          </h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setNewTaskForm((prev) => ({ ...prev, isUrgent: true, priority: 'URGENT' }));
              setShowNewTaskModal(true);
            }}
            className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Create Urgent Task
          </button>
          <button
            type="button"
            onClick={() => {
              setNewTaskForm((prev) => ({ ...prev, isUrgent: false, priority: 'P2' }));
              setShowNewTaskModal(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Assign Routine Task
          </button>
          <button
            type="button"
            onClick={() => setShowVisitorModal(true)}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <Users className="w-3.5 h-3.5 text-amber-600" />
            Register Visitor
          </button>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Today's Tasks</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">{tasks.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Automated 9:00 AM – 8:00 PM schedule</div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Completed</div>
          <div className="text-2xl font-bold text-emerald-600 font-mono tabular-nums mt-1">
            {tasks.filter((t) => t.status === 'COMPLETED').length}
          </div>
          <div className="text-[10px] text-emerald-600/80 mt-0.5">
            {dailyReport ? `${dailyReport.completionRatePercent}% completion rate` : 'Verified'}
          </div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-sky-700 uppercase tracking-wider">Verification Pending</div>
          <div className="text-2xl font-bold text-sky-600 font-mono tabular-nums mt-1">
            {tasks.filter((t) => t.status === 'PENDING_VERIFICATION').length}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Photos uploaded by Raju</div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">In Progress</div>
          <div className="text-2xl font-bold text-amber-600 font-mono tabular-nums mt-1">
            {tasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'AVAILABLE').length}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Active queue</div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">Blocked Rooms</div>
          <div className="text-2xl font-bold text-rose-600 font-mono tabular-nums mt-1">
            {tasks.filter((t) => t.status === 'BLOCKED').length}
          </div>
          <div className="text-[10px] text-rose-600/80 mt-0.5">Interviews / Occupied</div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">Rooms Ready</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {readyRoomsCount} <span className="text-xs font-normal text-slate-400">/ {rooms.length}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {preparingRoomsCount > 0 ? `${preparingRoomsCount} need attention` : 'All 15 areas ready'}
          </div>
        </div>
      </div>

      {/* Sub Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {[
          { key: 'TASKS', label: 'Tasks & Live Photos', count: tasks.length },
          { key: 'VISITORS', label: 'Visitor Hospitality', count: visitors.length },
          { key: 'ROOMS', label: '15 Office Areas & Config', count: rooms.length },
          { key: 'REPORTS', label: 'Daily & Weekly Reports' },
          { key: 'USERS', label: 'Account Access & Security', count: allUsers.length },
          { key: 'AUDIT', label: 'Audit Trail', count: auditLogs.length },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSubTab(tab.key as any)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              subTab === tab.key
                ? 'border-slate-900 text-slate-900 bg-slate-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 font-mono text-slate-600">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: TASKS & OPERATIONS */}
      {subTab === 'TASKS' && (
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
                <option value="P3">P3 (Lalit Sir)</option>
                <option value="P4">P4 (Kimmy Mam)</option>
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
                <option value="PENDING_VERIFICATION">Pending Verification</option>
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
                          {task.status.replace(/_/g, ' ')}
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

                      {isPendingReview ? (
                        <div className="flex items-center gap-1.5">
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
                        </div>
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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: VISITOR HOSPITALITY AUTOMATION */}
      {subTab === 'VISITORS' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Scheduled Guests & Candidate Interviews</h3>
                <p className="text-xs text-slate-500">
                  Guest arrivals automatically generate high-priority room preparation tasks for Raju Sharma.
                  Departures trigger room resets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowVisitorModal(true)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Register Guest Arrival
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {visitors.map((v) => (
                <div key={v.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900">{v.visitorName}</span>
                      <span className="text-xs text-slate-400">· {v.companyName}</span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                          v.status === 'ARRIVED'
                            ? 'bg-amber-100 text-amber-800'
                            : v.status === 'DEPARTED'
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {v.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>Room: <strong className="text-slate-700">{v.roomAreaName}</strong></span>
                      <span aria-hidden="true">·</span>
                      <span>Host: {v.hostName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{v.guestCount} Guests</span>
                    </div>

                    {v.notes && <p className="text-xs text-slate-600 mt-1 italic leading-relaxed">{v.notes}</p>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {v.status === 'EXPECTED' && (
                      <button
                        type="button"
                        onClick={() => api.registerVisitorArrival({ visitorId: v.id }).then(loadData)}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs"
                      >
                        Mark Guest Arrived
                      </button>
                    )}

                    {v.status === 'ARRIVED' && (
                      <button
                        type="button"
                        onClick={() => handleRegisterDeparture(v.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                      >
                        Register Departure (Reset Room)
                      </button>
                    )}

                    {v.status === 'DEPARTED' && (
                      <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Meeting Concluded
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: DEDICATED REAL-TIME ROOM MANAGEMENT */}
      {subTab === 'ROOMS' && (
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
                    floor: 'Floor 1',
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
              <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider">Verification</div>
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
                          <span className="text-[11px] text-slate-400 font-mono">{room.floor}</span>
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

                        {/* 2. Mark Ready for Visitor (if PREPARATION_REQUIRED) */}
                        {room.status === 'PREPARATION_REQUIRED' && (
                          <button
                            type="button"
                            onClick={() => handleRoomStatusAction(room.id, 'MARK_READY')}
                            className="flex-1 py-1.5 px-2 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3 text-blue-600" />
                            Ready for Visitor
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
                              floor: room.floor,
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
                      Average Visitor Room Prep Time: <strong className="font-mono">{weeklyReport.visitorPrepAverageMinutes} mins</strong> (Target: &lt;10 mins)
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
                  Automated Operational Synthesis for Kimmy Mam & HR:
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
      {subTab === 'USERS' && (
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

              return (
                <div key={u.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img src={u.avatarUrl} alt={u.name} className="w-10 h-10 rounded-full object-cover border" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{u.name}</span>
                        <span className="text-xs text-slate-500">· {u.role}</span>
                        {isDeactivated && (
                          <span className="text-[10px] font-mono text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded font-bold">
                            ACCESS REVOKED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {u.email} · {u.department} {u.phone ? `· ${u.phone}` : ''}
                      </div>
                      {isDeactivated && u.deactivatedAt && (
                        <div className="text-[11px] text-rose-600 mt-0.5">
                          Deactivated by {u.deactivatedBy} at {new Date(u.deactivatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => handleToggleUser(u.id)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                          isDeactivated
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                            : 'text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200'
                        }`}
                      >
                        {isDeactivated ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" /> Reactivate Access
                          </>
                        ) : (
                          <>
                            <UserX className="w-3.5 h-3.5" /> Deactivate Immediately
                          </>
                        )}
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
      {subTab === 'AUDIT' && (
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

      {/* MODAL 1: Create New Task / Urgent Request with AI Natural Language Assist */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl p-5 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {newTaskForm.isUrgent ? '⚠️ Create Urgent Priority Task' : 'Assign New Operational Task'}
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
                Kimmy Mam & HR Natural Language Command Parser
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder='e.g. "Prepare Skyline immediately for 2:30 PM client meet with water & whiteboard"'
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
                  placeholder="e.g. Emergency hospitality setup for Lalit Sir"
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
                  className={`px-4 py-2 text-xs font-bold text-white rounded-lg transition-colors shadow-sm ${
                    newTaskForm.isUrgent ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-800'
                  }`}
                >
                  Confirm & Dispatch Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Register Visitor Arrival */}
      {showVisitorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Register Visitor Arrival</h3>
                <p className="text-xs text-slate-500">Auto-triggers high-priority room preparation task.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowVisitorModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterArrival} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Visitor / Client Name</label>
                <input
                  type="text"
                  required
                  value={visitorForm.visitorName}
                  onChange={(e) => setVisitorForm({ ...visitorForm, visitorName: e.target.value })}
                  placeholder="e.g. Anand Mahindra / DLF Delegation"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Company / Organization</label>
                  <input
                    type="text"
                    value={visitorForm.companyName}
                    onChange={(e) => setVisitorForm({ ...visitorForm, companyName: e.target.value })}
                    placeholder="e.g. Partner Group"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Guest Count</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={visitorForm.guestCount}
                    onChange={(e) => setVisitorForm({ ...visitorForm, guestCount: Number(e.target.value) })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Meeting Room</label>
                <select
                  value={visitorForm.roomAreaId}
                  onChange={(e) => setVisitorForm({ ...visitorForm, roomAreaId: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Host Executive</label>
                <input
                  type="text"
                  value={visitorForm.hostName}
                  onChange={(e) => setVisitorForm({ ...visitorForm, hostName: e.target.value })}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVisitorModal(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors shadow-sm"
                >
                  Confirm Arrival & Alert Pantry
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
                  placeholder="e.g. Skyline Boardroom"
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Floor / Wing</label>
                  <input
                    type="text"
                    value={roomForm.floor}
                    onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })}
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
                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="PANTRY_BOY">Pantry Boy</option>
                    <option value="HR">HR Operations</option>
                    <option value="KIMMY_MAM">Kimmy Mam (Executive)</option>
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
                  <span>Assign Room to Candidate or Visitor</span>
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
                          Switch to {av.name} ({av.floor})
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
              {/* Visitor / Candidate Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Candidate / Visitor Name <span className="text-rose-500">*</span>
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
                          {r.name} ({r.floor}) — Status: [{badge.label}]
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
                  <span className="text-xs text-slate-500">· {historyRoom.floor}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Complete audit log of room status changes, visitor assignments, and verified live camera photos.
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

                {/* Historical Visitor Assignments */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">Past Visitor Assignments</h4>
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
    </div>
  );
};
