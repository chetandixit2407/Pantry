import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Task, TaskStatus, RoomArea, PantryRequest, AppNotification, TaskPriority, AttendanceRecord } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { CameraCaptureModal } from '../common/CameraCaptureModal.tsx';
import {
  LayoutDashboard,
  ListTodo,
  DoorOpen,
  Coffee,
  Bell,
  History,
  User,
  LogOut,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Play,
  ArrowRight,
  Sparkles,
  MapPin,
  MapPinOff,
  Compass,
  X,
  ChevronLeft,
  ChevronRight,
  Menu,
  RefreshCw,
  Search,
  Filter,
  Check,
  Send,
  Droplets,
  Calendar,
  Layers,
  ShieldCheck,
  Info,
} from 'lucide-react';

type PantryViewTab =
  | 'dashboard'
  | 'myTasks'
  | 'roomSupport'
  | 'pantryRequests'
  | 'notifications'
  | 'taskHistory'
  | 'myProfile';

export const PantryBoyView: React.FC = () => {
  const { currentUser, logout, hasSidebarAccess, notifications, unreadNotifCount, markNotificationRead, todayAttendance } = useAuth();

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<PantryViewTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  // Operational states
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<RoomArea[]>([]);
  const [pantryRequests, setPantryRequests] = useState<PantryRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Modals & details
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [cameraModalTask, setCameraModalTask] = useState<Task | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  // Blocker modal state
  const [showBlockerModal, setShowBlockerModal] = useState<boolean>(false);
  const [blockerReason, setBlockerReason] = useState<string>('Room occupied for client meeting / interview in progress');
  const [customReason, setCustomReason] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Attendance History state
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceRecord[]>([]);
  const [showAttendanceHistoryModal, setShowAttendanceHistoryModal] = useState<boolean>(false);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const handleOpenAttendanceHistory = async () => {
    setShowAttendanceHistoryModal(true);
    setLoadingHistory(true);
    try {
      const res = await api.getAttendanceHistory();
      setAttendanceHistory(res.history || []);
    } catch (err) {
      console.error('Failed to load attendance history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Task list filter
  const [taskFilterStatus, setTaskFilterStatus] = useState<'ALL' | 'AVAILABLE' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED'>('ALL');
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [hoveredSidebarTab, setHoveredSidebarTab] = useState<string | null>(null);

  // Live IST Clock
  const [currentTime, setCurrentTime] = useState<string>(() =>
    new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time elapsed shift timer
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

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

  const elapsedDuration = useMemo(() => {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }, [elapsedSeconds]);

  // Data loader
  const loadData = useCallback(async () => {
    try {
      const [fetchedTasks, fetchedRooms, fetchedRequests] = await Promise.all([
        api.getTasks(),
        api.getRooms(),
        api.getPantryRequests(),
      ]);
      setTasks(fetchedTasks);
      setRooms(fetchedRooms);
      setPantryRequests(fetchedRequests);

      if (selectedTask) {
        const updated = fetchedTasks.find((t) => t.id === selectedTask.id);
        if (updated) setSelectedTask(updated);
      }
    } catch (err) {
      console.error('Failed to load pantry data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTask?.id]);

  useEffect(() => {
    loadData();

    const unsubscribe = api.subscribeRealtime((event) => {
      if (
        event === 'task:updated' ||
        event === 'room:updated' ||
        event === 'pantry_request:created' ||
        event === 'pantry_request:updated'
      ) {
        loadData();
      }
    });

    const interval = setInterval(loadData, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadData]);

  // Handle manual refresh
  const handleManualRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  // Task mutations
  const handleStartTask = async (task: Task) => {
    setActionLoading(true);
    try {
      const updated = await api.updateTaskStatus(task.id, 'IN_PROGRESS');
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedTask(updated);
    } catch (err) {
      console.error('Error starting task:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleChecklist = async (task: Task, itemId: string, completed: boolean) => {
    try {
      const updated = await api.updateChecklistItem(task.id, itemId, completed);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (selectedTask?.id === task.id) setSelectedTask(updated);
    } catch (err) {
      console.error('Error updating checklist:', err);
    }
  };

  const handleReportBlocked = async () => {
    if (!selectedTask) return;
    setActionLoading(true);
    try {
      const reason = blockerReason === 'Other custom reason' ? customReason : blockerReason;
      const updated = await api.updateTaskStatus(selectedTask.id, 'BLOCKED', { blockedReason: reason });
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSelectedTask(updated);
      setShowBlockerModal(false);
      setCustomReason('');
    } catch (err) {
      console.error('Error reporting blocked task:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePhotoUploaded = (updatedTask: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
    setSelectedTask(updatedTask);
  };

  const handleUpdatePantryRequest = async (requestId: string, status: 'IN_PREPARATION' | 'SERVED') => {
    try {
      const updated = await api.updatePantryRequestStatus(requestId, status);
      setPantryRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      console.error('Error updating pantry request:', err);
    }
  };

  const handleMarkRoomReady = async (roomId: string) => {
    try {
      const res = await api.roomStatusAction(roomId, 'MARK_READY', 'Verified ready by Pantry Attendant');
      setRooms((prev) => prev.map((r) => (r.id === res.room.id ? res.room : r)));
    } catch (err) {
      console.error('Error marking room ready:', err);
    }
  };

  // Filtered Task Computations
  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED'),
    [tasks]
  );
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === 'COMPLETED'), [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (taskFilterStatus === 'AVAILABLE' && t.status !== 'AVAILABLE') return false;
      if (taskFilterStatus === 'IN_PROGRESS' && t.status !== 'IN_PROGRESS') return false;
      if (taskFilterStatus === 'PENDING' && t.status !== 'PENDING_VERIFICATION') return false;
      if (taskFilterStatus === 'COMPLETED' && t.status !== 'COMPLETED') return false;
      if (taskSearch.trim()) {
        const query = taskSearch.toLowerCase();
        return (
          t.title.toLowerCase().includes(query) ||
          t.roomAreaName.toLowerCase().includes(query) ||
          t.priority.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [tasks, taskFilterStatus, taskSearch]);

  // Next high-priority actionable task
  const nextEligibleTask = useMemo(() => {
    return activeTasks.find((t) => t.status === 'IN_PROGRESS') || activeTasks[0];
  }, [activeTasks]);

  // Priority Styling Helper
  const getPriorityStyle = (priority: TaskPriority) => {
    switch (priority) {
      case 'URGENT':
        return 'text-rose-700 bg-rose-50 border-rose-200';
      case 'P1':
        return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'P2':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'P3':
        return 'text-indigo-700 bg-indigo-50 border-indigo-200';
      case 'P4':
        return 'text-purple-700 bg-purple-50 border-purple-200';
      default:
        return 'text-slate-700 bg-slate-100 border-slate-200';
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'IN_PROGRESS':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">In Progress</span>;
      case 'BLOCKED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Blocked</span>;
      case 'PENDING_VERIFICATION':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800">Under Review</span>;
      case 'COMPLETED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Completed</span>;
      case 'REJECTED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Photo Rejected</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">Available</span>;
    }
  };

  // Nav Items definition filtered by Admin Permissions
  const allNavItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'myTasks' as const, label: 'My Tasks', icon: ListTodo, badge: activeTasks.length },
    { id: 'roomSupport' as const, label: 'Room Support', icon: DoorOpen, badge: rooms.filter((r) => r.status === 'PREPARATION_REQUIRED' || r.status === 'CLEANING_REQUIRED').length },
    { id: 'pantryRequests' as const, label: 'Pantry Requests', icon: Coffee, badge: pantryRequests.filter((p) => p.status === 'PENDING').length },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell, badge: unreadNotifCount },
    { id: 'taskHistory' as const, label: 'Task History', icon: History },
    { id: 'myProfile' as const, label: 'My Profile', icon: User },
  ];

  const authorizedNavItems = allNavItems.filter((item) => hasSidebarAccess(item.id));

  // If currently on an unauthorized tab, auto-switch to first authorized item
  useEffect(() => {
    if (authorizedNavItems.length > 0 && !authorizedNavItems.some((item) => item.id === activeTab)) {
      setActiveTab(authorizedNavItems[0].id);
    }
  }, [authorizedNavItems, activeTab]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row antialiased text-slate-800">
      {/* ----------------------------------------------------------------------- */}
      {/* Collapsible Animated Sidebar (Desktop & Tablet)                         */}
      {/* ----------------------------------------------------------------------- */}
      <aside
        className={`hidden md:flex flex-col bg-white border-r border-slate-200 transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-30 shrink-0 ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand Wordmark & Collapse Button */}
        <div
          className={`h-16 px-4 flex items-center border-b border-slate-200 shrink-0 transition-all duration-300 ${
            sidebarCollapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-3 overflow-hidden min-w-0">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              className="w-9 h-9 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-xs cursor-pointer"
              onClick={() => {
                if (sidebarCollapsed) setSidebarCollapsed(false);
              }}
              title={sidebarCollapsed ? 'Click to expand' : undefined}
            >
              <img src="/assets/wcr_logo.png" alt="WCR" className="w-full h-full object-contain" />
            </motion.div>

            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0"
                >
                  <div className="font-bold text-slate-900 text-sm leading-tight truncate">White Collar Realty</div>
                  <div className="text-[10px] text-slate-500 font-medium tracking-tight">SmartPantry Attendant</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <motion.div
              animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            >
              <ChevronLeft className="w-4 h-4" />
            </motion.div>
          </button>
        </div>

        {/* Sidebar Nav Items with Apple-Style Gliding Hover & Active Pill */}
        <nav
          className="p-3 space-y-1.5 flex-1 overflow-y-auto overflow-x-hidden"
          onMouseLeave={() => setHoveredSidebarTab(null)}
        >
          {authorizedNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isHovered = hoveredSidebarTab === item.id;

            return (
              <div key={item.id} className="relative group">
                <button
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  onMouseEnter={() => setHoveredSidebarTab(item.id)}
                  className={`w-full relative flex items-center ${
                    sidebarCollapsed ? 'justify-center' : 'justify-between'
                  } px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors duration-200 cursor-pointer overflow-hidden select-none ${
                    isActive ? 'text-white font-bold' : isHovered ? 'text-slate-900' : 'text-slate-600'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {/* Apple-Style Sliding Active Pill */}
                  {isActive && (
                    <motion.div
                      layoutId="pantryActiveNavPill"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      className="absolute inset-0 bg-slate-900 rounded-xl shadow-md z-0"
                      style={{
                        boxShadow: '0 4px 14px -2px rgba(15, 23, 42, 0.35)',
                      }}
                    />
                  )}

                  {/* Apple-Style Gliding Hover Pill */}
                  {!isActive && isHovered && (
                    <motion.div
                      layoutId="pantryHoverNavPill"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className="absolute inset-0 bg-slate-100/90 border border-slate-200/80 rounded-xl shadow-2xs z-0"
                    />
                  )}

                  {/* Icon & Label with Fluid Lift */}
                  <motion.div
                    className="relative z-10 flex items-center gap-3 min-w-0"
                    whileHover={{ y: -1.5, x: sidebarCollapsed ? 0 : 2 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  >
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: [0, -3, 3, 0] }}
                      transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                      className="shrink-0 flex items-center justify-center"
                    >
                      <Icon
                        className={`w-4 h-4 transition-colors duration-200 ${
                          isActive ? 'text-amber-400' : isHovered ? 'text-amber-600' : 'text-slate-500'
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
                  </motion.div>

                  {/* Badge Counter (When Expanded) */}
                  {!sidebarCollapsed && Boolean(item.badge) && item.badge! > 0 && (
                    <span
                      className={`relative z-10 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold tabular-nums transition-colors duration-200 ${
                        isActive
                          ? 'bg-amber-400 text-slate-950 shadow-xs'
                          : isHovered
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}

                  {/* Collapsed Mode Indicator Dot */}
                  {sidebarCollapsed && Boolean(item.badge) && item.badge! > 0 && (
                    <span className="hidden md:block absolute top-2 right-2.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white z-20" />
                  )}
                </button>

                {/* Collapsed Floating Tooltip with Arrow (Dribbble Signature) */}
                {sidebarCollapsed && (
                  <div className="hidden md:flex absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xl pointer-events-none whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 items-center gap-2">
                    <span>{item.label}</span>
                    {Boolean(item.badge) && item.badge! > 0 && (
                      <span className="bg-amber-400 text-slate-950 text-[10px] font-bold px-1.5 py-0.2 rounded-full tabular-nums">
                        {item.badge}
                      </span>
                    )}
                    <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer Logout */}
        <div className="p-3 border-t border-slate-200 shrink-0 relative group">
          <button
            type="button"
            onClick={() => logout()}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'gap-3'
            } px-3 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer`}
            title={sidebarCollapsed ? 'Log Out' : undefined}
          >
            <motion.div whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}>
              <LogOut className="w-4 h-4 shrink-0 text-rose-500" />
            </motion.div>
            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                  className="truncate"
                >
                  Sign Out
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          {/* Collapsed Tooltip for Sign Out */}
          {sidebarCollapsed && (
            <div className="hidden md:flex absolute left-full ml-3 bottom-2 px-3 py-1.5 bg-rose-900 text-rose-100 text-xs font-semibold rounded-xl shadow-xl pointer-events-none whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 items-center gap-2">
              <span>Sign Out</span>
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-rose-900" />
            </div>
          )}
        </div>
      </aside>

      {/* ----------------------------------------------------------------------- */}
      {/* Mobile Drawer (Small Screens with Smooth Backdrop & Slide-In Animation) */}
      {/* ----------------------------------------------------------------------- */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
              onClick={() => setMobileDrawerOpen(false)}
            />

            {/* Slide-out Panel */}
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="relative w-72 bg-white h-full flex flex-col p-4 shadow-2xl z-10"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 p-1 flex items-center justify-center shadow-xs">
                    <img src="/assets/wcr_logo.png" alt="WCR" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-xs">White Collar Realty</div>
                    <div className="text-[10px] text-slate-500">Pantry Attendant Portal</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1 flex-1 overflow-y-auto">
                {authorizedNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileDrawerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors duration-200 relative cursor-pointer select-none ${
                        isActive ? 'text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="pantryMobileNavPill"
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                          className="absolute inset-0 bg-slate-900 rounded-xl shadow-xs z-0"
                        />
                      )}
                      <div className="relative z-10 flex items-center gap-3">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                        <span>{item.label}</span>
                      </div>
                      {Boolean(item.badge) && item.badge! > 0 && (
                        <span className="relative z-10 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-slate-950">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------------- */}
      {/* Main Content Area                                                       */}
      {/* ----------------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Mobile Top Navbar with Hamburger */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs font-bold text-slate-900 truncate">
              {authorizedNavItems.find((n) => n.id === activeTab)?.label || 'Pantry Dashboard'}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-900">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>{currentTime.split(' ')[0]} IST</span>
          </div>
        </div>

        <div className="max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
          {/* ------------------------------------------------------------------- */}
          {/* Reference Dark Navy Header Banner                                   */}
          {/* ------------------------------------------------------------------- */}
          <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-xl border border-slate-800 relative overflow-hidden">
            {/* Top Shift Status & Live IST Clock */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                <span className="text-xs font-semibold tracking-wider uppercase text-emerald-300">
                  Attendance · {todayAttendance?.logoutTimeIST ? `Logged Out (${todayAttendance.logoutTimeIST})` : todayAttendance?.loginTimeIST ? `Logged In (${todayAttendance.loginTimeIST})` : 'Active Session'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 bg-slate-800/90 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                  title="Refresh state"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <div className="text-sm font-mono font-bold text-amber-400 tabular-nums px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-lg">
                  {currentTime} IST
                </div>
              </div>
            </div>

            {/* Profile, Shift Info & Remaining Tasks */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-white p-1.5 flex items-center justify-center shrink-0 shadow-md overflow-hidden border-2 border-white/20">
                  <img
                    src="/assets/wcr_logo.png"
                    alt="White Collar Realty"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white tracking-tight">{currentUser?.name}</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-amber-300 font-medium">Pantry & Hospitality Attendant</span>
                    <span className="text-xs text-slate-500">•</span>
                    <span className="text-xs text-slate-400">{currentUser?.department || 'Operations'}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {currentUser?.email}
                  </div>
                </div>
              </div>

              <div className="flex items-center sm:flex-col sm:items-end justify-between border-t border-slate-800 sm:border-0 pt-3 sm:pt-0">
                <div className="text-xs text-slate-400">Today's Remaining</div>
                <div className="text-2xl font-bold text-white font-mono tabular-nums flex items-baseline gap-1.5">
                  {activeTasks.length}{' '}
                  <span className="text-xs font-normal text-slate-400">tasks pending</span>
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-rose-300 bg-rose-950/70 hover:bg-rose-900 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>

            {/* Real-time Login Attendance & Office Location Verification Strip */}
            <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-slate-400 font-mono text-[11px]">Logged in at:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {todayAttendance?.loginTimeIST || '09:00:15 AM'} IST
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 font-mono text-[11px]">Elapsed Working Time:</span>
                <span className="font-mono font-bold text-amber-300">
                  {elapsedDuration}
                </span>
              </div>

              {/* Geofence Status Pill */}
              <div className="flex items-center gap-2">
                {todayAttendance?.locationVerification?.status === 'INSIDE_OFFICE' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-2xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Inside Office · {todayAttendance.locationVerification.officeName || 'White Collar Realty HQ'}</span>
                  </span>
                ) : todayAttendance?.locationVerification?.status === 'OUTSIDE_OFFICE' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-2xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>Outside Office ({todayAttendance?.locationVerification?.distanceFromOfficeMeters}m away)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-2xs">
                    <MapPinOff className="w-3.5 h-3.5 text-amber-400" />
                    <span>Location Unverified</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------------- */}
          {/* TAB 1: DASHBOARD OVERVIEW                                           */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Operational Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Attendance & Location</span>
                    <Clock className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">
                    {todayAttendance?.loginTimeIST?.split(' ')[0] || '09:00:15'}
                    <span className="text-xs font-normal text-slate-500 ml-1">
                      {todayAttendance?.loginTimeIST?.split(' ')[1] || 'AM'}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium mt-1 flex items-center gap-1">
                    {todayAttendance?.locationVerification?.status === 'INSIDE_OFFICE' ? (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Inside Office (Verified)
                      </span>
                    ) : todayAttendance?.locationVerification?.status === 'OUTSIDE_OFFICE' ? (
                      <span className="text-rose-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        Outside Office Geofence
                      </span>
                    ) : (
                      <span className="text-amber-700 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Location Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Active Tasks</span>
                    <ListTodo className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">{activeTasks.length}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{completedTasks.length} verified today</div>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Room Action</span>
                    <DoorOpen className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">
                    {rooms.filter((r) => r.status === 'PREPARATION_REQUIRED' || r.status === 'CLEANING_REQUIRED').length}
                  </div>
                  <div className="text-[11px] text-blue-600 font-medium mt-1">Need Prep / Cleaning</div>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Pantry Orders</span>
                    <Coffee className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono">
                    {pantryRequests.filter((p) => p.status === 'PENDING').length}
                  </div>
                  <div className="text-[11px] text-purple-600 font-medium mt-1">Pending Beverage Orders</div>
                </div>
              </div>

              {/* Prominent Next Task Card */}
              {nextEligibleTask ? (
                <div className="p-5 rounded-2xl border-2 border-amber-500/50 bg-gradient-to-br from-amber-50/70 via-white to-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      {nextEligibleTask.status === 'IN_PROGRESS' ? 'Currently In Progress' : 'Immediate Priority Task'}
                    </span>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(nextEligibleTask.priority)}`}>
                      {nextEligibleTask.priority}
                    </span>
                  </div>

                  <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-1.5">{nextEligibleTask.title}</h2>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mb-3">
                    <span className="font-semibold text-slate-800 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {nextEligibleTask.roomAreaName}
                    </span>
                    <span>•</span>
                    <span className="font-mono text-slate-700">Due {nextEligibleTask.dueTime}</span>
                    <span>•</span>
                    <span>Assigned by {nextEligibleTask.createdByName}</span>
                  </div>

                  {nextEligibleTask.description && (
                    <p className="text-xs text-slate-600 leading-relaxed mb-4 bg-white/70 p-3 rounded-xl border border-amber-200/50">
                      {nextEligibleTask.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-amber-200/70">
                    <div className="text-xs text-slate-600">
                      {nextEligibleTask.checklist.filter((c) => c.completed).length} of {nextEligibleTask.checklist.length} checklist items done
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedTask(nextEligibleTask)}
                      className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      {nextEligibleTask.status === 'IN_PROGRESS' ? 'Continue Checklist' : 'Start Task'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-slate-900">All Scheduled Tasks Completed!</h3>
                  <p className="text-xs text-slate-500 mt-1">Outstanding work. All routine cleaning and room setup tasks are verified.</p>
                </div>
              )}

              {/* Quick Room Status Glance */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Office Room Status Glance</h3>
                    <p className="text-xs text-slate-500">Live readiness across all 15 configured spaces</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('roomSupport')}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1"
                  >
                    <span>View All Rooms</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {rooms.slice(0, 10).map((room) => (
                    <div
                      key={room.id}
                      onClick={() => setActiveTab('roomSupport')}
                      className="p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer text-xs"
                    >
                      <div className="font-semibold text-slate-900 truncate">{room.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{room.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 2: MY TASKS (Filterable, Actionable)                             */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'myTasks' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Header & Filter Controls */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search tasks by title, room, priority..."
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      className="w-full text-xs pl-9 pr-3.5 py-2 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900"
                    />
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60">
                    {[
                      { key: 'ALL', label: `All (${tasks.length})` },
                      { key: 'AVAILABLE', label: 'Available' },
                      { key: 'IN_PROGRESS', label: 'In Progress' },
                      { key: 'PENDING', label: 'Review' },
                      { key: 'COMPLETED', label: 'Completed' },
                    ].map((tab) => {
                      const isActive = taskFilterStatus === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setTaskFilterStatus(tab.key as any)}
                          className={`relative px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors select-none cursor-pointer ${
                            isActive ? 'text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="taskFilterActivePill"
                              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                              className="absolute inset-0 bg-slate-900 rounded-lg shadow-xs z-0"
                            />
                          )}
                          <span className="relative z-10">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Task Cards List */}
              {filteredTasks.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                  <Info className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-900">No tasks found</div>
                  <p className="text-[11px] text-slate-500 mt-1">Try resetting search or filter filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredTasks.map((task) => {
                    const completedItems = task.checklist.filter((c) => c.completed).length;
                    const totalItems = task.checklist.length;
                    return (
                      <div
                        key={task.id}
                        className={`p-4 bg-white rounded-2xl border shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between ${
                          task.isUrgent ? 'border-l-4 border-l-rose-600' : 'border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                              {task.priority}
                            </span>
                            <div className="shrink-0">{getStatusBadge(task.status)}</div>
                          </div>

                          <h3 className="text-sm font-bold text-slate-900 mb-1 leading-snug">{task.title}</h3>

                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                            <span className="font-semibold text-slate-700 flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              {task.roomAreaName}
                            </span>
                            <span>•</span>
                            <span className="font-mono text-[11px] flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" /> Due {task.dueTime}
                            </span>
                          </div>

                          {task.description && (
                            <p className="text-xs text-slate-600 line-clamp-2 mb-3 bg-slate-50 p-2 rounded-lg">
                              {task.description}
                            </p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-mono text-[11px]">
                            {completedItems}/{totalItems} Done
                          </span>

                          <button
                            type="button"
                            onClick={() => setSelectedTask(task)}
                            className="px-3.5 py-1.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <span>Open Task</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 3: ROOM SUPPORT (15 Rooms, Water, Refreshments, Readiness)      */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'roomSupport' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Room Support & Hospitality</h2>
                  <p className="text-xs text-slate-500">Live room readiness, water carafe replenishment, and meeting setup for 15 office rooms.</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                    {rooms.filter((r) => r.status === 'AVAILABLE' || r.status === 'READY_FOR_VISITOR').length} Available / Ready
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rooms.map((room) => {
                  const isNeedsAttention = room.status === 'PREPARATION_REQUIRED' || room.status === 'CLEANING_REQUIRED';
                  return (
                    <div
                      key={room.id}
                      className={`p-4 bg-white rounded-2xl border transition-all ${
                        isNeedsAttention ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          {room.category}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            room.status === 'AVAILABLE' || room.status === 'READY_FOR_VISITOR'
                              ? 'bg-emerald-100 text-emerald-800'
                              : room.status === 'OCCUPIED'
                              ? 'bg-slate-200 text-slate-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {room.status}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 mb-1">{room.name}</h3>

                      <div className="space-y-1.5 text-xs text-slate-600 my-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                          <Droplets className="w-3.5 h-3.5 text-blue-500" />
                          <span>Water & Glasses: Sealed bottles placed</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Standard: {room.defaultChecklist[0] || 'Sanitize surfaces and align chairs'}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {room.status !== 'AVAILABLE' && room.status !== 'READY_FOR_VISITOR' ? (
                          <button
                            type="button"
                            onClick={() => handleMarkRoomReady(room.id)}
                            className="w-full py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark Ready</span>
                          </button>
                        ) : (
                          <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Room Verified & Ready
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 4: PANTRY REQUESTS (Beverage, Tea, Coffee, Snacks)              */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'pantryRequests' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Pantry & Hospitality Requests</h2>
                  <p className="text-xs text-slate-500">Ad-hoc hot beverage, mineral water, and refreshment requests dispatched by staff.</p>
                </div>
                <div className="text-xs font-semibold text-slate-700">
                  {pantryRequests.filter((p) => p.status === 'PENDING').length} Orders Pending
                </div>
              </div>

              {pantryRequests.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                  <Coffee className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-900">No active pantry requests</div>
                  <p className="text-[11px] text-slate-500 mt-1">Hot beverage and snack orders from staff will appear here in real time.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pantryRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              req.priority === 'URGENT'
                                ? 'bg-rose-100 text-rose-800 font-mono'
                                : 'bg-slate-100 text-slate-700 font-mono'
                            }`}
                          >
                            {req.priority}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{req.roomAreaName}</span>
                          <span className="text-xs text-slate-400">• Requested by {req.requesterName} ({req.requesterRole})</span>
                        </div>

                        <div className="text-xs font-semibold text-slate-800">
                          Items: <span className="text-amber-800">{req.items.join(', ')}</span>
                        </div>

                        {req.instructions && (
                          <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg">
                            Note: {req.instructions}
                          </p>
                        )}
                        <div className="text-[10px] text-slate-400 font-mono">
                          Received at {new Date(req.createdAt).toLocaleTimeString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {req.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={() => handleUpdatePantryRequest(req.id, 'IN_PREPARATION')}
                            className="px-3.5 py-1.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors shadow-xs"
                          >
                            Start Prep
                          </button>
                        )}

                        {req.status === 'IN_PREPARATION' && (
                          <button
                            type="button"
                            onClick={() => handleUpdatePantryRequest(req.id, 'SERVED')}
                            className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark Served</span>
                          </button>
                        )}

                        {req.status === 'SERVED' && (
                          <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Delivered & Served
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 5: NOTIFICATIONS                                                */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'notifications' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Activity Notifications</h2>
                  <p className="text-xs text-slate-500">Live operational alerts, room assignments, and photo verification updates.</p>
                </div>
                <span className="text-xs text-slate-400 font-mono">{notifications.length} logged</span>
              </div>

              {notifications.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                  <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-900">No recent notifications</div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markNotificationRead(n.id)}
                      className={`p-4 bg-white rounded-2xl border transition-all cursor-pointer ${
                        !n.read ? 'border-amber-300 bg-amber-50/40 shadow-xs' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900 text-xs">{n.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 6: TASK HISTORY                                                 */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'taskHistory' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Task Completion History</h2>
                  <p className="text-xs text-slate-500">Audit logs and verified photographs of completed maintenance tasks.</p>
                </div>
                <span className="text-xs text-slate-400 font-mono">{completedTasks.length} Completed</span>
              </div>

              {completedTasks.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                  <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-900">No completed tasks yet today</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {completedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                          <span className="text-xs text-slate-400">• Priority {task.priority}</span>
                          <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-slate-700">{task.title}</h4>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Completed: {task.completedAt ? new Date(task.completedAt).toLocaleString() : 'Today'}
                        </div>
                      </div>

                      {task.photoEvidence && (
                        <button
                          type="button"
                          onClick={() => setPreviewPhotoUrl(task.photoEvidence!.photoUrl)}
                          className="flex items-center gap-2 p-1.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50 shrink-0"
                        >
                          <img
                            src={task.photoEvidence.photoUrl}
                            alt="Photo Evidence"
                            className="w-12 h-12 object-cover rounded-lg"
                          />
                          <span className="text-xs font-semibold text-slate-700 pr-2">View Photo</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 7: MY PROFILE                                                   */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'myProfile' && (
            <div className="space-y-4 animate-in fade-in duration-200 max-w-2xl">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
                <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 p-2 shadow-sm flex items-center justify-center overflow-hidden">
                    <img src="/assets/wcr_logo.png" alt="WCR Logo" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{currentUser?.name}</h2>
                    <div className="text-xs text-slate-500 font-mono">{currentUser?.email}</div>
                    <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800">
                      Pantry & Hospitality Attendant
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Today's Attendance</div>
                    <div className="text-slate-900 font-bold mt-0.5">
                      {todayAttendance?.loginTimeIST ? `In: ${todayAttendance.loginTimeIST}` : 'Recorded on Login'}
                      {todayAttendance?.logoutTimeIST ? ` · Out: ${todayAttendance.logoutTimeIST}` : ''}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Company Role</div>
                    <div className="text-slate-900 font-bold mt-0.5">Pantry Attendant (PANTRY_BOY)</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Department</div>
                    <div className="text-slate-900 font-bold mt-0.5">{currentUser?.department || 'Hospitality & Operations'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Contact Phone</div>
                    <div className="text-slate-900 font-mono mt-0.5">{currentUser?.phone || '+91 98765 43210'}</div>
                  </div>
                </div>

                {/* Attendance & Geofence Verification Status */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-indigo-600" />
                      <span className="font-bold text-slate-900 text-xs">Today's Attendance & Office Location</span>
                    </div>
                    {todayAttendance?.locationVerification?.status === 'INSIDE_OFFICE' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Inside Office
                      </span>
                    ) : todayAttendance?.locationVerification?.status === 'OUTSIDE_OFFICE' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        Outside Office
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                        <MapPinOff className="w-3 h-3 text-amber-600" />
                        Location Unverified
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-400">Login IST:</span>{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {todayAttendance?.loginTimeIST || '09:00:15 AM'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Status:</span>{' '}
                      <span className="font-bold text-emerald-700">
                        {todayAttendance?.logoutTime ? 'Completed' : 'Present (Active)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Working Elapsed:</span>{' '}
                      <span className="font-mono font-bold text-amber-700">
                        {elapsedDuration}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Geofence Distance:</span>{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {todayAttendance?.locationVerification?.distanceFromOfficeMeters !== undefined
                          ? `${todayAttendance.locationVerification.distanceFromOfficeMeters}m from HQ`
                          : 'Unavailable'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 text-[10px] text-slate-500 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3 h-3 text-indigo-500 shrink-0" />
                      <span>Privacy Notice: Your location was verified only once upon login. Continuous background tracking is disabled.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenAttendanceHistory}
                      className="px-2.5 py-1 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition-colors shrink-0 cursor-pointer"
                    >
                      More · Attendance History
                    </button>
                  </div>
                </div>

                <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>White Collar Realty Company Policy</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Daily attendance login/logout is recorded automatically with IST timestamps and location verification. All 15 room morning routines (9:00 AM), water bottle distribution (10:00 AM), recheck (3:00 PM), and closing inspection (7:30 PM) require live photo verification.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Attendance History Modal */}
      {showAttendanceHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold tracking-tight">Pantry Attendant Login & Attendance History</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAttendanceHistoryModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Showing daily server IST attendance records and GPS verification statuses</span>
                <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  {attendanceHistory.length} total records
                </span>
              </div>

              {loadingHistory ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                  <p className="text-xs font-medium">Fetching attendance history log...</p>
                </div>
              ) : attendanceHistory.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2 border border-dashed border-slate-200 rounded-xl">
                  <Calendar className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-xs font-semibold text-slate-600">No attendance logs found</p>
                  <p className="text-[11px] text-slate-400">Attendance records will appear after Pantry Boy logs in.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {attendanceHistory.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/80 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                            {rec.date}
                          </span>
                          <span className="text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            {rec.userName || 'Pantry Attendant'}
                          </span>
                          {rec.logoutTime ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                              Session Completed
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse">
                              Active
                            </span>
                          )}
                        </div>

                        <div className="text-xs font-mono text-slate-600 flex items-center gap-3 pt-1">
                          <span>
                            Login IST: <strong className="text-slate-900">{rec.loginTimeIST || 'N/A'}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Logout IST: <strong className="text-slate-900">{rec.logoutTimeIST || 'Active'}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-start sm:items-end text-xs space-y-1 shrink-0">
                        {rec.locationVerification?.status === 'INSIDE_OFFICE' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            Inside Office ({rec.locationVerification.distanceFromOfficeMeters}m)
                          </span>
                        ) : rec.locationVerification?.status === 'OUTSIDE_OFFICE' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            Outside Office ({rec.locationVerification.distanceFromOfficeMeters}m)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                            <MapPinOff className="w-3 h-3 text-amber-600" />
                            Location Unverified
                          </span>
                        )}
                        {rec.elapsedMinutes !== undefined && (
                          <span className="text-[10px] font-mono text-slate-500">
                            Elapsed: {Math.floor(rec.elapsedMinutes / 60)}h {rec.elapsedMinutes % 60}m
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAttendanceHistoryModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Close Log
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------- */}
      {/* Task Detail Modal / Sheet                                               */}
      {/* ----------------------------------------------------------------------- */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(selectedTask.priority)}`}>
                    {selectedTask.priority}
                  </span>
                  <span className="text-xs font-bold text-slate-800">{selectedTask.roomAreaName}</span>
                  <span className="text-xs text-slate-400">• Due {selectedTask.dueTime}</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 leading-snug">{selectedTask.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-5">
              {selectedTask.description && (
                <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed">
                  {selectedTask.description}
                </div>
              )}

              {selectedTask.status === 'BLOCKED' && (
                <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Task Marked as Blocked</div>
                    <div className="mt-0.5">{selectedTask.blockedReason}</div>
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Mandatory Operations Checklist
                  </h4>
                  <span className="text-xs font-mono text-slate-400">
                    {selectedTask.checklist.filter((c) => c.completed).length} of {selectedTask.checklist.length} done
                  </span>
                </div>

                <div className="space-y-2">
                  {selectedTask.checklist.map((item) => (
                    <label
                      key={item.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                        item.completed ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(e) => handleToggleChecklist(selectedTask, item.id, e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
                      />
                      <span className={`leading-snug ${item.completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                        {item.text}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Live Photo Evidence */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Photo Evidence</h4>
                  <span className="text-[11px] text-amber-700 font-semibold">Live Camera Required</span>
                </div>

                {selectedTask.photoEvidence ? (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50">
                    <img
                      src={selectedTask.photoEvidence.photoUrl}
                      alt="Captured Evidence"
                      className="w-full h-48 object-cover cursor-pointer"
                      onClick={() => setPreviewPhotoUrl(selectedTask.photoEvidence!.photoUrl)}
                    />
                    <div className="p-3 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Photo Captured & Server Timestamped
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {new Date(selectedTask.photoEvidence.serverTimestamp).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                          })}
                        </div>
                      </div>
                      {selectedTask.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => setCameraModalTask(selectedTask)}
                          className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                        >
                          Retake
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center bg-slate-50">
                    <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs text-slate-600 mb-3">
                      Capture clean room arrangement, chair alignment, and water bottles using the live camera.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCameraModalTask(selectedTask)}
                      className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors inline-flex items-center gap-1.5 shadow-sm"
                    >
                      <Camera className="w-4 h-4" />
                      Open Live Camera
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between gap-3">
              {selectedTask.status === 'AVAILABLE' && (
                <button
                  type="button"
                  onClick={() => handleStartTask(selectedTask)}
                  disabled={actionLoading}
                  className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start This Task
                </button>
              )}

              {selectedTask.status === 'IN_PROGRESS' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBlockerModal(true)}
                    className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors"
                  >
                    Report Blocked
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraModalTask(selectedTask)}
                    className="flex-1 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {selectedTask.photoEvidence ? 'Retake Photo' : 'Capture Live Photo'}
                  </button>
                </>
              )}

              {selectedTask.status === 'BLOCKED' && (
                <button
                  type="button"
                  onClick={() => handleStartTask(selectedTask)}
                  className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  Room is Free · Resume Task
                </button>
              )}

              {selectedTask.status === 'PENDING_VERIFICATION' && (
                <div className="w-full text-center py-2 text-xs font-semibold text-sky-700 bg-sky-50 rounded-xl border border-sky-200">
                  Evidence Submitted · Under Review by HR / Kimmi
                </div>
              )}

              {selectedTask.status === 'COMPLETED' && (
                <div className="w-full text-center py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Task Completed & Photo Verified
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------- */}
      {/* Blocker Modal                                                           */}
      {/* ----------------------------------------------------------------------- */}
      {showBlockerModal && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Report Blocked Task</h3>
            <p className="text-xs text-slate-500 mb-4">
              Why are you unable to clean or prepare {selectedTask.roomAreaName} right now?
            </p>

            <div className="space-y-2 mb-4">
              {[
                'Room occupied for client meeting / interview in progress',
                'VIP guests currently inside',
                'Cleaning detergent / linen exhausted in pantry storage',
                'Maintenance / electrical repair currently underway',
                'Other custom reason',
              ].map((reason) => (
                <label
                  key={reason}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer ${
                    blockerReason === reason ? 'bg-amber-50 border-amber-300 font-semibold' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="blockerReason"
                    checked={blockerReason === reason}
                    onChange={() => setBlockerReason(reason)}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            {blockerReason === 'Other custom reason' && (
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the roadblock..."
                className="w-full text-xs p-2.5 border border-slate-300 rounded-xl mb-4 focus:ring-1 focus:ring-slate-900"
                rows={3}
              />
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBlockerModal(false)}
                className="px-3 py-2 text-xs text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReportBlocked}
                disabled={actionLoading || (blockerReason === 'Other custom reason' && !customReason.trim())}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors"
              >
                Submit Blocked Notice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------- */}
      {/* Live Camera Modal                                                       */}
      {/* ----------------------------------------------------------------------- */}
      {cameraModalTask && (
        <CameraCaptureModal
          taskId={cameraModalTask.id}
          taskTitle={cameraModalTask.title}
          roomName={cameraModalTask.roomAreaName}
          userEmail={currentUser?.email || 'raju.sharma@whitecollarrealty.com'}
          isOpen={Boolean(cameraModalTask)}
          onClose={() => setCameraModalTask(null)}
          onPhotoUploaded={handlePhotoUploaded}
        />
      )}

      {/* ----------------------------------------------------------------------- */}
      {/* Photo Preview Modal                                                     */}
      {/* ----------------------------------------------------------------------- */}
      {previewPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div className="relative max-w-2xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl">
            <button
              type="button"
              onClick={() => setPreviewPhotoUrl(null)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-900/70 text-white hover:bg-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={previewPhotoUrl} alt="Preview" className="w-full max-h-[80vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};
