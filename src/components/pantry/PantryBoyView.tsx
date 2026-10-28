import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type {
  Task,
  TaskStatus,
  RoomArea,
  PantryRequest,
  AppNotification,
  TaskPriority,
  AttendanceRecord,
  ScheduleAlertPayload,
  PhotoEvidence,
} from '../../types/index.ts';
import { api, getServerNowMs } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { CameraCaptureModal } from '../common/CameraCaptureModal.tsx';
import { AuthenticatedEvidenceImage } from '../common/AuthenticatedEvidenceImage.tsx';
import { EvidenceLightboxModal } from '../common/EvidenceLightboxModal.tsx';
import { Card3D } from '../common/Card3D.tsx';
import { getTaskPhotoEvidences } from '../../utils/textNormalizer.ts';
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
  Building2,
} from 'lucide-react';

type PantryViewTab =
  | 'dashboard'
  | 'myTasks'
  | 'roomSupport'
  | 'pantryRequests'
  | 'notifications'
  | 'taskHistory'
  | 'myProfile';

const getISTDateKey = (ms: number): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().split('T')[0];
  }
};

const formatISTScheduleBadge = (isoStr: string, refNowMs: number): string => {
  const ms = new Date(isoStr).getTime();
  if (Number.isNaN(ms)) return 'Scheduled Today';
  const d = new Date(ms);
  const timePart = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  if (getISTDateKey(ms) === getISTDateKey(refNowMs)) {
    return `Today · ${timePart} IST`;
  }
  const datePart = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
  });
  return `${datePart} · ${timePart} IST`;
};

const formatISTFullDateTime = (isoStr: string): string => {
  const ms = new Date(isoStr).getTime();
  if (Number.isNaN(ms)) return isoStr;
  const d = new Date(ms);
  const datePart = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart} IST`;
};

const formatCountdownLabel = (scheduledFor: string, serverNowMs: number): string => {
  const schedMs = new Date(scheduledFor).getTime();
  if (Number.isNaN(schedMs)) return '';
  const diffMs = schedMs - serverNowMs;
  if (diffMs <= 0) {
    return Math.abs(diffMs) <= 2 * 60 * 1000 ? 'Due Now' : 'Ready Now';
  }
  const totalSecs = Math.ceil(diffMs / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (days > 0) return `Starts in ${days}d ${hours}h ${mins}m`;
  if (hours > 0) {
    return `Starts in ${hours}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `Starts in ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
};

const playAlertTone = (kind: 'WARNING_5MIN' | 'TASK_DUE_NOW'): void => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = kind === 'TASK_DUE_NOW' ? [587.33, 783.99, 1046.5] : [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const startAt = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(kind === 'TASK_DUE_NOW' ? 0.14 : 0.08, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.26);
    });
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1200);
  } catch {}
};

const PRIORITY_SORT_WEIGHT: Record<string, number> = {
  URGENT: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
};

const sortTasksChronologically = (list: Task[]): Task[] => {
  const isTerminal = (s: TaskStatus) => s === 'COMPLETED' || s === 'CANCELLED';
  return [...list].sort((a, b) => {
    const termA = isTerminal(a.status) ? 1 : 0;
    const termB = isTerminal(b.status) ? 1 : 0;
    if (termA !== termB) return termA - termB;
    const schedA = new Date(a.scheduledFor).getTime() || 0;
    const schedB = new Date(b.scheduledFor).getTime() || 0;
    if (schedA !== schedB) return schedA - schedB;
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    return (PRIORITY_SORT_WEIGHT[a.priority] ?? 99) - (PRIORITY_SORT_WEIGHT[b.priority] ?? 99);
  });
};

export interface PantryBoyViewProps {
  isPreviewMode?: boolean;
}

export const PantryBoyView: React.FC<PantryBoyViewProps> = ({ isPreviewMode = false }) => {
  const { currentUser, logout, hasSidebarAccess, hasPermission, notifications, unreadNotifCount, markNotificationRead, todayAttendance } = useAuth();
  const canEditTasks = hasPermission('tasks', 'edit');

  // Strict Pantry-Boy-only guard for task execution popup alerts
  const isExclusivelyPantryBoy = Boolean(
    currentUser && currentUser.role === 'PANTRY_BOY' && currentUser.status === 'active'
  );

  const roleTitle =
    currentUser?.role === 'KIMMY_MAM'
      ? 'Co-Founder'
      : currentUser?.role === 'ADMIN'
      ? 'System Administrator'
      : currentUser?.role === 'HR'
      ? 'HR & Facilities Manager'
      : 'Pantry & Hospitality Attendant';

  const roleCodeLabel =
    currentUser?.role === 'KIMMY_MAM'
      ? 'Co-Founder'
      : currentUser?.role === 'ADMIN'
      ? 'System Administrator'
      : currentUser?.role === 'HR'
      ? 'HR Operations'
      : 'Pantry Attendant';

  const getUserInitials = (name?: string) => {
    if (!name) return 'WC';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

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
  const [evidenceViewerState, setEvidenceViewerState] = useState<{
    photos: PhotoEvidence[];
    initialIndex: number;
    title?: string;
    task?: Task | null;
    roomName?: string;
  } | null>(null);

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
  const [taskFilterStatus, setTaskFilterStatus] = useState<
    'ALL' | 'SCHEDULED' | 'AVAILABLE' | 'IN_PROGRESS' | 'OVERDUE' | 'PENDING' | 'COMPLETED' | 'CANCELLED'
  >('ALL');
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [hoveredSidebarTab, setHoveredSidebarTab] = useState<string | null>(null);

  // Server-synchronized IST Clock & Real-time Timestamp
  const [serverNowMs, setServerNowMs] = useState<number>(() => getServerNowMs());
  const currentTime = useMemo(
    () =>
      new Date(serverNowMs).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
    [serverNowMs]
  );

  useEffect(() => {
    api
      .getServerTime()
      .then(() => setServerNowMs(getServerNowMs()))
      .catch(() => {});

    const timer = setInterval(() => {
      setServerNowMs(getServerNowMs());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time Pantry-Boy-Only Alert Queues & Deduplication Registry
  const [warningAlerts, setWarningAlerts] = useState<Task[]>([]);
  const [dueAlerts, setDueAlerts] = useState<Task[]>([]);
  const shownAlertKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setWarningAlerts([]);
    setDueAlerts([]);
    if (!isExclusivelyPantryBoy || !currentUser?.id) {
      shownAlertKeysRef.current = new Set();
      return;
    }
    try {
      const raw = sessionStorage.getItem(`wcr_pantry_alerts_${currentUser.id}`);
      const parsed = raw ? JSON.parse(raw) : [];
      shownAlertKeysRef.current = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      shownAlertKeysRef.current = new Set();
    }
  }, [currentUser?.id, isExclusivelyPantryBoy]);

  const markAlertKeyShown = useCallback(
    (key: string) => {
      shownAlertKeysRef.current.add(key);
      if (!currentUser?.id) return;
      try {
        const serialized = Array.from(shownAlertKeysRef.current).slice(-300);
        sessionStorage.setItem(`wcr_pantry_alerts_${currentUser.id}`, JSON.stringify(serialized));
      } catch {}
    },
    [currentUser?.id]
  );

  const triggerScheduleAlert = useCallback(
    (task: Task, alertType: 'WARNING_5MIN' | 'TASK_DUE_NOW') => {
      if (!isExclusivelyPantryBoy || !currentUser?.email) return;
      if (task.assignedToEmail.toLowerCase() !== currentUser.email.toLowerCase()) return;
      if (task.status !== 'SCHEDULED' && task.status !== 'AVAILABLE') return;

      const key = `${task.id}::${task.scheduledFor}::${alertType}`;
      if (shownAlertKeysRef.current.has(key)) return;

      if (alertType === 'WARNING_5MIN') {
        const dueKey = `${task.id}::${task.scheduledFor}::TASK_DUE_NOW`;
        if (shownAlertKeysRef.current.has(dueKey)) return;
        markAlertKeyShown(key);
        playAlertTone('WARNING_5MIN');
        setWarningAlerts((prev) => {
          const filtered = prev.filter((t) => t.id !== task.id);
          return [...filtered, task];
        });
      } else {
        markAlertKeyShown(key);
        playAlertTone('TASK_DUE_NOW');
        setWarningAlerts((prev) => prev.filter((t) => t.id !== task.id));
        setDueAlerts((prev) => {
          const filtered = prev.filter((t) => t.id !== task.id);
          return [task, ...filtered];
        });
      }
    },
    [isExclusivelyPantryBoy, currentUser?.email, markAlertKeyShown]
  );

  const dismissWarningAlert = useCallback((taskId: string) => {
    setWarningAlerts((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const dismissDueAlert = useCallback((taskId: string) => {
    setDueAlerts((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  // Real-time elapsed session timer
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
        : getServerNowMs();
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
        api.getTasks().catch(() => []),
        api.getRooms().catch(() => []),
        api.getPantryRequests().catch(() => []),
      ]);
      const ordered = sortTasksChronologically(fetchedTasks);
      setTasks(ordered);
      setRooms(fetchedRooms);
      setPantryRequests(fetchedRequests);
      setServerNowMs(getServerNowMs());

      setSelectedTask((prevSelected) => {
        if (!prevSelected) return null;
        const updated = ordered.find((t) => t.id === prevSelected.id);
        return updated || null;
      });
    } catch (err) {
      console.error('Failed to load pantry data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const unsubscribe = api.subscribeRealtime((event, payload) => {
      if (event === 'connected') {
        setServerNowMs(getServerNowMs());
        if (Array.isArray(payload?.rooms)) {
          setRooms(payload.rooms);
        }
        loadData();
        return;
      }

      if (event === 'server:time') {
        setServerNowMs(getServerNowMs());
        return;
      }

      if (event === 'schedule:alert' && payload) {
        setServerNowMs(getServerNowMs());
        const alertPayload = payload as ScheduleAlertPayload;
        if (alertPayload.task) {
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === alertPayload.task.id);
            const nextList = exists
              ? prev.map((t) => (t.id === alertPayload.task.id ? alertPayload.task : t))
              : [alertPayload.task, ...prev];
            return sortTasksChronologically(nextList);
          });
          triggerScheduleAlert(alertPayload.task, alertPayload.alertType);
        }
        return;
      }

      if (event === 'task:deleted' || event === 'task:created' || event === 'task:updated') {
        setServerNowMs(getServerNowMs());
        const removedId = payload?.deletedTaskId || payload?.taskId ? String(payload.deletedTaskId || payload.taskId) : '';
        if (removedId) {
          setWarningAlerts((prev) => prev.filter((a) => a.id !== removedId));
          setDueAlerts((prev) => prev.filter((a) => a.id !== removedId));
          setSelectedTask((prevSelected) => (prevSelected?.id === removedId ? null : prevSelected));
        }

        if (payload && Array.isArray(payload.tasks) && currentUser) {
          const rawTasks: Task[] = payload.tasks;
          const visibleTasks =
            currentUser.role === 'PANTRY_BOY'
              ? rawTasks.filter(
                  (t) => t.assignedToEmail.toLowerCase() === currentUser.email.toLowerCase()
                )
              : rawTasks;
          const ordered = sortTasksChronologically(visibleTasks);
          setTasks(ordered);
          setSelectedTask((prevSelected) => {
            if (!prevSelected) return null;
            return ordered.find((t) => t.id === prevSelected.id) || null;
          });
        } else if (removedId) {
          setTasks((prev) => prev.filter((t) => t.id !== removedId));
        } else {
          loadData();
        }
        return;
      }

      if (event === 'room:updated' || event === 'room:created') {
        if (Array.isArray(payload?.rooms)) {
          setRooms(payload.rooms);
        } else if (payload?.room?.id) {
          const incomingRoom = payload.room;
          setRooms((prev) =>
            prev.some((r) => r.id === incomingRoom.id)
              ? prev.map((r) => (r.id === incomingRoom.id ? incomingRoom : r))
              : [...prev, incomingRoom]
          );
        }
        loadData();
        return;
      }

      if (event === 'pantry_request:created' || event === 'pantry_request:updated') {
        loadData();
      }
    });

    const interval = setInterval(loadData, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadData, triggerScheduleAlert, currentUser?.id, currentUser?.role, currentUser?.email]);

  // 1-second IST Server-Clock Alert Evaluation & Automatic Schedule Advancement
  useEffect(() => {
    if (!isExclusivelyPantryBoy || !currentUser?.email) {
      if (warningAlerts.length > 0) setWarningAlerts([]);
      if (dueAlerts.length > 0) setDueAlerts([]);
      return;
    }

    const FIVE_MIN_MS = 5 * 60 * 1000;
    const DUE_GRACE_MS = 90 * 1000;
    let shouldActivateScheduled = false;

    for (const task of tasks) {
      if (task.assignedToEmail.toLowerCase() !== currentUser.email.toLowerCase()) continue;
      if (task.status !== 'SCHEDULED' && task.status !== 'AVAILABLE') continue;

      const schedMs = new Date(task.scheduledFor).getTime();
      if (Number.isNaN(schedMs)) continue;
      const msUntil = schedMs - serverNowMs;

      if (msUntil > 0 && msUntil <= FIVE_MIN_MS) {
        triggerScheduleAlert(task, 'WARNING_5MIN');
      } else if (msUntil <= 0) {
        if (task.status === 'SCHEDULED') {
          shouldActivateScheduled = true;
        }
        if (Math.abs(msUntil) <= DUE_GRACE_MS) {
          triggerScheduleAlert(task, 'TASK_DUE_NOW');
        }
      }
    }

    if (shouldActivateScheduled) {
      setTasks((prev) =>
        sortTasksChronologically(
          prev.map((t) => {
            const schedMs = new Date(t.scheduledFor).getTime();
            if (t.status === 'SCHEDULED' && !Number.isNaN(schedMs) && schedMs <= serverNowMs) {
              return { ...t, status: 'AVAILABLE' };
            }
            return t;
          })
        )
      );
    }

    // Reconcile open warning & due modals against live task state (reschedule, cancel, start, complete, delete)
    setWarningAlerts((prev) => {
      if (prev.length === 0) return prev;
      const next = prev
        .map((a) => tasks.find((t) => t.id === a.id))
        .filter((t): t is Task => {
          if (!t) return false;
          if (t.assignedToEmail.toLowerCase() !== currentUser.email.toLowerCase()) return false;
          if (t.status !== 'SCHEDULED' && t.status !== 'AVAILABLE') return false;
          const diff = new Date(t.scheduledFor).getTime() - serverNowMs;
          return diff > 0 && diff <= FIVE_MIN_MS + 2000;
        });
      return next.length === prev.length && next.every((t, i) => t === prev[i]) ? prev : next;
    });

    setDueAlerts((prev) => {
      if (prev.length === 0) return prev;
      const next = prev
        .map((a) => tasks.find((t) => t.id === a.id))
        .filter((t): t is Task => {
          if (!t) return false;
          if (t.assignedToEmail.toLowerCase() !== currentUser.email.toLowerCase()) return false;
          if (t.status !== 'AVAILABLE' && t.status !== 'SCHEDULED' && t.status !== 'OVERDUE') return false;
          const schedMs = new Date(t.scheduledFor).getTime();
          return !Number.isNaN(schedMs) && schedMs <= serverNowMs + 2000;
        });
      return next.length === prev.length && next.every((t, i) => t === prev[i]) ? prev : next;
    });
  }, [
    tasks,
    serverNowMs,
    isExclusivelyPantryBoy,
    currentUser?.email,
    triggerScheduleAlert,
    warningAlerts.length,
    dueAlerts.length,
  ]);

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

  const openTaskEvidence = useCallback((task: Task, initialIndex = 0) => {
    const photos = getTaskPhotoEvidences(task);
    setEvidenceViewerState({
      photos,
      initialIndex,
      title: task.title,
      task,
      roomName: task.roomAreaName,
    });
  }, []);

  const handlePhotoUploaded = (updatedTask: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
    setSelectedTask((prev) => (prev?.id === updatedTask.id ? updatedTask : prev));
    setEvidenceViewerState((prev) => {
      if (!prev || prev.task?.id !== updatedTask.id) return prev;
      return {
        ...prev,
        task: updatedTask,
        photos: getTaskPhotoEvidences(updatedTask),
      };
    });
    api
      .getRooms()
      .then((freshRooms) => setRooms(freshRooms))
      .catch(() => {});
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

  // Authoritative IST Today Key & Strict 3-Section Task Partitioning
  const todayIST = useMemo(() => getISTDateKey(serverNowMs), [serverNowMs]);

  const getTaskISTDate = useCallback(
    (t: Task): string => {
      const ms = new Date(t.scheduledFor).getTime();
      return Number.isNaN(ms) ? todayIST : getISTDateKey(ms);
    },
    [todayIST]
  );

  // Chronologically Ordered Active & Scheduled Tasks (across all dates)
  const activeTasks = useMemo(
    () =>
      sortTasksChronologically(
        tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      ),
    [tasks]
  );
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === 'COMPLETED'), [tasks]);

  // Persisted evidence mapped per room across assigned tasks (newest first)
  const roomEvidenceMap = useMemo(() => {
    const map = new Map<string, PhotoEvidence[]>();
    const seenByRoom = new Map<string, Set<string>>();
    for (const task of tasks) {
      const photos = getTaskPhotoEvidences(task);
      if (photos.length === 0) continue;
      const roomId = task.roomAreaId;
      if (!roomId) continue;
      if (!map.has(roomId)) {
        map.set(roomId, []);
        seenByRoom.set(roomId, new Set());
      }
      const list = map.get(roomId)!;
      const seen = seenByRoom.get(roomId)!;
      for (const pe of photos) {
        const key = pe.id || pe.photoUrl;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(pe);
        }
      }
    }
    for (const [roomId, list] of map.entries()) {
      list.sort(
        (a, b) =>
          (new Date(b.serverTimestamp || b.capturedAt || 0).getTime() || 0) -
          (new Date(a.serverTimestamp || a.capturedAt || 0).getTime() || 0)
      );
      map.set(roomId, list);
    }
    return map;
  }, [tasks]);

  // Task History & Submitted Evidence records (includes COMPLETED + tasks with uploaded evidence)
  const historyWithEvidenceTasks = useMemo(() => {
    const relevant = tasks.filter(
      (t) => t.status === 'COMPLETED' || getTaskPhotoEvidences(t).length > 0
    );
    return [...relevant].sort((a, b) => {
      const aPhotos = getTaskPhotoEvidences(a);
      const bPhotos = getTaskPhotoEvidences(b);
      const aTs =
        new Date(
          a.completedAt ||
            a.submittedAt ||
            aPhotos[aPhotos.length - 1]?.serverTimestamp ||
            a.createdAt
        ).getTime() || 0;
      const bTs =
        new Date(
          b.completedAt ||
            b.submittedAt ||
            bPhotos[bPhotos.length - 1]?.serverTimestamp ||
            b.createdAt
        ).getTime() || 0;
      return bTs - aTs;
    });
  }, [tasks]);

  // 1. TODAY'S TASKS ONLY (IST date === todayIST, excluding OVERDUE & CANCELLED)
  const todayTasks = useMemo(
    () =>
      sortTasksChronologically(
        tasks.filter(
          (t) =>
            t.status !== 'CANCELLED' &&
            t.status !== 'OVERDUE' &&
            getTaskISTDate(t) === todayIST
        )
      ),
    [tasks, getTaskISTDate, todayIST]
  );

  const todayRemainingTasks = useMemo(
    () => todayTasks.filter((t) => t.status !== 'COMPLETED'),
    [todayTasks]
  );

  const todayCompletedTasks = useMemo(
    () => todayTasks.filter((t) => t.status === 'COMPLETED'),
    [todayTasks]
  );

  // 2. OVERDUE TASKS (Separate section: status === OVERDUE or uncompleted past IST dates)
  const overdueTasks = useMemo(
    () =>
      sortTasksChronologically(
        tasks.filter(
          (t) =>
            t.status !== 'COMPLETED' &&
            t.status !== 'CANCELLED' &&
            (t.status === 'OVERDUE' || getTaskISTDate(t) < todayIST)
        )
      ),
    [tasks, getTaskISTDate, todayIST]
  );

  // 3. UPCOMING TASKS (Separate section: uncompleted tasks scheduled for future IST dates > todayIST)
  const upcomingDateTasks = useMemo(
    () =>
      sortTasksChronologically(
        tasks.filter(
          (t) =>
            t.status !== 'COMPLETED' &&
            t.status !== 'CANCELLED' &&
            getTaskISTDate(t) > todayIST
        )
      ),
    [tasks, getTaskISTDate, todayIST]
  );

  // Upcoming future scheduled tasks ordered by IST timestamp (auto-advances as serverNowMs crosses scheduledFor)
  const upcomingScheduledTasks = useMemo(
    () =>
      activeTasks.filter((t) => {
        if (t.status !== 'SCHEDULED' && t.status !== 'AVAILABLE') return false;
        const schedMs = new Date(t.scheduledFor).getTime();
        return !Number.isNaN(schedMs) && schedMs > serverNowMs;
      }),
    [activeTasks, serverNowMs]
  );

  const nextUpcomingTask = upcomingScheduledTasks[0] || null;

  // Immediate execution focus task (today in-progress -> today due/available -> today blocked/rejected -> today next scheduled -> overdue -> future upcoming)
  const nextEligibleTask = useMemo(() => {
    const todayInProgress = todayRemainingTasks.find((t) => t.status === 'IN_PROGRESS');
    if (todayInProgress) return todayInProgress;

    const anyInProgress = activeTasks.find((t) => t.status === 'IN_PROGRESS');
    if (anyInProgress) return anyInProgress;

    const todayDueAvailable = todayRemainingTasks.filter((t) => {
      if (t.status !== 'AVAILABLE') return false;
      const schedMs = new Date(t.scheduledFor).getTime();
      return Number.isNaN(schedMs) || schedMs <= serverNowMs;
    });
    if (todayDueAvailable.length > 0) {
      const sortedDue = [...todayDueAvailable].sort((a, b) => {
        if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
        return (new Date(a.scheduledFor).getTime() || 0) - (new Date(b.scheduledFor).getTime() || 0);
      });
      return sortedDue[0];
    }

    const todayRejectedOrBlocked = todayRemainingTasks.find(
      (t) => t.status === 'REJECTED' || t.status === 'BLOCKED'
    );
    if (todayRejectedOrBlocked) return todayRejectedOrBlocked;

    if (todayRemainingTasks.length > 0) {
      return todayRemainingTasks[0];
    }

    if (overdueTasks.length > 0) {
      return overdueTasks[0];
    }

    return nextUpcomingTask || activeTasks[0] || null;
  }, [todayRemainingTasks, activeTasks, serverNowMs, overdueTasks, nextUpcomingTask]);

  const matchesTaskSearch = useCallback(
    (t: Task): boolean => {
      if (!taskSearch.trim()) return true;
      const query = taskSearch.toLowerCase();
      return (
        t.title.toLowerCase().includes(query) ||
        t.roomAreaName.toLowerCase().includes(query) ||
        t.priority.toLowerCase().includes(query)
      );
    },
    [taskSearch]
  );

  const filteredTasks = useMemo(() => {
    return sortTasksChronologically(tasks).filter((t) => {
      if (taskFilterStatus === 'SCHEDULED' && t.status !== 'SCHEDULED') return false;
      if (taskFilterStatus === 'AVAILABLE' && t.status !== 'AVAILABLE') return false;
      if (taskFilterStatus === 'IN_PROGRESS' && t.status !== 'IN_PROGRESS') return false;
      if (taskFilterStatus === 'OVERDUE' && t.status !== 'OVERDUE') return false;
      if (taskFilterStatus === 'PENDING' && t.status !== 'PENDING_VERIFICATION') return false;
      if (taskFilterStatus === 'COMPLETED' && t.status !== 'COMPLETED') return false;
      if (taskFilterStatus === 'CANCELLED' && t.status !== 'CANCELLED') return false;
      return matchesTaskSearch(t);
    });
  }, [tasks, taskFilterStatus, matchesTaskSearch]);

  const filteredTodayTasks = useMemo(
    () => todayTasks.filter(matchesTaskSearch),
    [todayTasks, matchesTaskSearch]
  );
  const filteredOverdueTasks = useMemo(
    () => overdueTasks.filter(matchesTaskSearch),
    [overdueTasks, matchesTaskSearch]
  );
  const filteredUpcomingDateTasks = useMemo(
    () => upcomingDateTasks.filter(matchesTaskSearch),
    [upcomingDateTasks, matchesTaskSearch]
  );

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
      case 'SCHEDULED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-800">Scheduled</span>;
      case 'IN_PROGRESS':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">In Progress</span>;
      case 'OVERDUE':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Overdue</span>;
      case 'BLOCKED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Blocked</span>;
      case 'PENDING_VERIFICATION':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800">Under Review</span>;
      case 'COMPLETED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Completed</span>;
      case 'REJECTED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Photo Rejected</span>;
      case 'CANCELLED':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-200 text-slate-600 line-through">Cancelled</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">Due / Available</span>;
    }
  };

  // Nav Items definition filtered by Admin Permissions
  const allNavItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'myTasks' as const, label: 'My Tasks', icon: ListTodo, badge: todayRemainingTasks.length },
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
      {/* Fixed Collapsible Animated Sidebar (Desktop & Tablet, 100dvh Locked)    */}
      {/* ----------------------------------------------------------------------- */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 ${
          isPreviewMode ? 'top-24 wcr-h-dvh-preview' : 'top-0 wcr-h-dvh'
        } bg-white border-r border-slate-200 transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-30 shrink-0 ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Brand Wordmark & Collapse Button */}
        <div
          className={`border-b border-slate-200 shrink-0 transition-all duration-300 ${
            sidebarCollapsed
              ? 'py-3.5 px-2 flex flex-col items-center justify-center gap-2'
              : 'h-16 px-4 flex items-center justify-between'
          }`}
        >
          <div
            className={`flex items-center min-w-0 ${
              sidebarCollapsed
                ? 'justify-center w-full'
                : 'gap-3 flex-1 mr-2'
            }`}
          >
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.96 }}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200/90 p-1 flex items-center justify-center shrink-0 shadow-xs overflow-hidden cursor-pointer"
              onClick={() => {
                if (sidebarCollapsed) setSidebarCollapsed(false);
              }}
              title={sidebarCollapsed ? 'Click to expand sidebar' : 'White Collar Realty'}
            >
              <img
                src="/assets/wcr_logo.png"
                alt="White Collar Realty"
                className="w-full h-full object-contain"
              />
            </motion.div>

            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 flex-1 overflow-hidden"
                >
                  <div className="font-bold text-slate-900 text-sm leading-tight truncate">
                    White Collar Realty
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium tracking-tight truncate">
                    SmartPantry Attendant
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
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

        {/* Sidebar Nav Items (Independent Scroll Only If Needed) */}
        <nav
          className={`p-3 space-y-1.5 flex-1 min-h-0 wcr-sidebar-scroll ${
            sidebarCollapsed ? 'md:overflow-visible overflow-y-auto' : 'overflow-y-auto overflow-x-hidden'
          }`}
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
                      transition={{
                        scale: { type: 'spring', stiffness: 450, damping: 20 },
                        rotate: { type: 'tween', duration: 0.35, ease: 'easeInOut' },
                      }}
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

        {/* Sidebar Bottom User Profile & Logout (Fixed at Bottom of 100dvh) */}
        <div className="p-3 border-t border-slate-200 bg-slate-50/70 shrink-0 mt-auto space-y-2.5 relative group">
          <div
            onClick={() => {
              if (hasSidebarAccess('myProfile')) setActiveTab('myProfile');
            }}
            className={`flex items-center transition-all duration-300 cursor-pointer rounded-xl ${
              sidebarCollapsed ? 'justify-center p-1' : 'gap-2.5 px-1.5 py-1 hover:bg-white/90'
            }`}
            title={sidebarCollapsed && currentUser ? `${currentUser.name} · ${roleCodeLabel}` : undefined}
          >
            {currentUser?.avatarUrl && currentUser.avatarUrl !== '/assets/wcr_logo.png' ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-amber-400 shrink-0 shadow-2xs"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-900 ring-2 ring-amber-400/80 flex items-center justify-center text-xs font-extrabold tracking-tight shrink-0 shadow-2xs select-none">
                {getUserInitials(currentUser?.name)}
              </div>
            )}

            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                  className="min-w-0 flex-1"
                >
                  <div className="text-xs font-bold text-slate-900 truncate">
                    {currentUser?.name || 'Pantry Attendant'}
                  </div>
                  <div className="text-[10px] text-amber-700 font-semibold truncate">
                    {roleCodeLabel}
                  </div>
                  <div className="text-[9.5px] text-slate-400 font-mono truncate">
                    {currentUser?.email}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center' : 'gap-2.5'
            } px-3 py-2 text-xs font-semibold text-rose-600 bg-white hover:bg-rose-50 border border-slate-200/80 hover:border-rose-200 rounded-xl transition-colors cursor-pointer shadow-2xs`}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
          >
            <motion.div whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.92 }}>
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

          {/* Collapsed Tooltip for User Profile & Sign Out */}
          {sidebarCollapsed && (
            <div className="hidden md:flex absolute left-full ml-3 bottom-3 p-3 bg-slate-900 text-white text-xs rounded-xl shadow-xl pointer-events-none whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 flex-col gap-0.5">
              <span className="font-bold text-white">{currentUser?.name || 'Pantry Attendant'}</span>
              <span className="text-[10px] text-amber-400 font-semibold">{roleCodeLabel}</span>
              <span className="text-[9.5px] text-slate-400 font-mono">{currentUser?.email}</span>
              <div className="absolute right-full bottom-4 border-4 border-transparent border-r-slate-900" />
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

            {/* Slide-out Panel (100dvh Locked) */}
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="relative w-72 bg-white wcr-h-dvh flex flex-col p-4 shadow-2xl z-10"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200/90 p-1 flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                    <img src="/assets/wcr_logo.png" alt="White Collar Realty" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-xs truncate">White Collar Realty</div>
                    <div className="text-[10px] text-slate-500 truncate">Pantry Attendant Portal</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1 flex-1 min-h-0 overflow-y-auto wcr-sidebar-scroll">
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

              <div className="pt-3 mt-3 border-t border-slate-200 shrink-0 space-y-2.5">
                <div className="flex items-center gap-2.5 px-1">
                  {currentUser?.avatarUrl && currentUser.avatarUrl !== '/assets/wcr_logo.png' ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-amber-400 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-900 ring-2 ring-amber-400/80 flex items-center justify-center text-xs font-extrabold shrink-0">
                      {getUserInitials(currentUser?.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 truncate">{currentUser?.name}</div>
                    <div className="text-[10px] text-amber-700 font-semibold truncate">{roleCodeLabel}</div>
                    <div className="text-[9.5px] text-slate-400 font-mono truncate">{currentUser?.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 bg-rose-50/60 hover:bg-rose-50 border border-rose-200/70 rounded-xl transition-colors"
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
      {/* Main Content Area (Offset by Fixed Desktop Sidebar Width)               */}
      {/* ----------------------------------------------------------------------- */}
      <main
        className={`flex-1 flex flex-col min-w-0 ${
          isPreviewMode ? 'min-h-[calc(100dvh-6rem)]' : 'min-h-screen'
        } transition-[padding] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          sidebarCollapsed ? 'md:pl-20' : 'md:pl-64'
        }`}
      >
        {/* Mobile Top Navbar with Hamburger */}
        <div
          className={`md:hidden sticky ${
            isPreviewMode ? 'top-24' : 'top-0'
          } z-20 flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur-md border-b border-slate-200 shrink-0`}
        >
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
            {/* Top Attendance Status & Live IST Clock */}
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

            {/* Profile, Session Info & Remaining Tasks */}
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
                    <span className="text-xs text-amber-300 font-medium">{roleTitle}</span>
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
                  {todayRemainingTasks.length}{' '}
                  <span className="text-xs font-normal text-slate-400">tasks today</span>
                </div>
                {(overdueTasks.length > 0 || upcomingDateTasks.length > 0) && (
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex items-center gap-2">
                    {overdueTasks.length > 0 && (
                      <span className="text-rose-300">{overdueTasks.length} overdue</span>
                    )}
                    {upcomingDateTasks.length > 0 && (
                      <span className="text-indigo-300">{upcomingDateTasks.length} upcoming</span>
                    )}
                  </div>
                )}
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

            {/* Real-time Login Attendance Strip */}
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

              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {todayAttendance?.logoutTimeIST
                    ? `Session Completed · ${todayAttendance.logoutTimeIST}`
                    : 'Active Session · Asia/Kolkata'}
                </span>
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
                <Card3D className="p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Today's Attendance</span>
                    <Clock className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {todayAttendance?.loginTimeIST?.split(' ')[0] || '09:00:15'}
                    <span className="text-xs font-normal text-slate-500 ml-1">
                      {todayAttendance?.loginTimeIST?.split(' ')[1] || 'AM'}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium mt-1 text-emerald-700 font-mono tabular-nums">
                    {todayAttendance?.logoutTimeIST
                      ? `Logged out ${todayAttendance.logoutTimeIST}`
                      : `Elapsed · ${elapsedDuration}`}
                  </div>
                </Card3D>

                <Card3D className="p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Today's Tasks</span>
                    <ListTodo className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {todayRemainingTasks.length}
                    <span className="text-xs font-normal text-slate-400 ml-1">/ {todayTasks.length}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {todayCompletedTasks.length} verified today
                    {overdueTasks.length > 0 ? ` · ${overdueTasks.length} overdue` : ''}
                  </div>
                </Card3D>

                <Card3D className="p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Room Action</span>
                    <DoorOpen className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {rooms.filter((r) => r.status === 'PREPARATION_REQUIRED' || r.status === 'CLEANING_REQUIRED').length}
                  </div>
                  <div className="text-[11px] text-blue-600 font-medium mt-1">Need Prep / Cleaning</div>
                </Card3D>

                <Card3D className="p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Pantry Orders</span>
                    <Coffee className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {pantryRequests.filter((p) => p.status === 'PENDING').length}
                  </div>
                  <div className="text-[11px] text-purple-600 font-medium mt-1">Pending Beverage Orders</div>
                </Card3D>
              </div>

              {/* Daily IST Schedule Protocol Overview */}
              <div className="bg-white rounded-2xl p-4 border border-amber-200/80 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Daily IST Routine Schedule ({todayIST})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    5-min warning &amp; due-time alerts active
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-[11px]">
                  <div className="p-2 rounded-xl bg-amber-50/60 border border-amber-200/60">
                    <div className="font-mono font-bold text-amber-900">09:00–09:30 AM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Reception &amp; Employee Desks</div>
                  </div>
                  <div className="p-2 rounded-xl bg-sky-50/60 border border-sky-200/60">
                    <div className="font-mono font-bold text-sky-900">10:00 AM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Deliver Desk Water Bottles</div>
                  </div>
                  <div className="p-2 rounded-xl bg-indigo-50/60 border border-indigo-200/60">
                    <div className="font-mono font-bold text-indigo-900">By 11:00 AM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Priority 1 Rooms (5)</div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="font-mono font-bold text-slate-900">By 12:00 PM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Priority 2 Rooms (4)</div>
                  </div>
                  <div className="p-2 rounded-xl bg-emerald-50/60 border border-emerald-200/60">
                    <div className="font-mono font-bold text-emerald-900">12:00 PM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Water All Office Plants</div>
                  </div>
                  <div className="p-2 rounded-xl bg-blue-50/60 border border-blue-200/60">
                    <div className="font-mono font-bold text-blue-900">04:00 PM</div>
                    <div className="text-slate-700 font-medium mt-0.5">Refill Desk Water Bottles</div>
                  </div>
                </div>
              </div>

              {/* Current Focus Task & Live Next Upcoming Scheduled Countdown */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className={nextUpcomingTask && nextEligibleTask?.id !== nextUpcomingTask.id ? 'lg:col-span-2' : 'lg:col-span-3'}>
                  {nextEligibleTask ? (
                    <Card3D
                      variant="amber"
                      maxTilt={2}
                      liftPx={3}
                      className="h-full p-5 rounded-2xl border-2 border-amber-500/50 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                            {nextEligibleTask.status === 'IN_PROGRESS'
                              ? 'Currently In Progress'
                              : nextEligibleTask.status === 'SCHEDULED'
                              ? 'Next Scheduled Task'
                              : nextEligibleTask.status === 'OVERDUE'
                              ? 'Overdue · Action Required'
                              : 'Current Due Task'}
                          </span>
                          <div className="flex items-center gap-2">
                            {new Date(nextEligibleTask.scheduledFor).getTime() > serverNowMs && (
                              <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-slate-900 text-amber-300 tabular-nums">
                                {formatCountdownLabel(nextEligibleTask.scheduledFor, serverNowMs)}
                              </span>
                            )}
                            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(nextEligibleTask.priority)}`}>
                              {nextEligibleTask.priority}
                            </span>
                            {getStatusBadge(nextEligibleTask.status)}
                          </div>
                        </div>

                        <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-1.5">{nextEligibleTask.title}</h2>

                        <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-600 mb-3">
                          <span className="font-semibold text-slate-800 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            {nextEligibleTask.roomAreaName}
                          </span>
                          <span>•</span>
                          <span className="font-mono font-semibold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-indigo-600" />
                            {formatISTScheduleBadge(nextEligibleTask.scheduledFor, serverNowMs)}
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
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-amber-200/70 flex-wrap">
                        <div className="text-xs text-slate-600">
                          {nextEligibleTask.checklist.filter((c) => c.completed).length} of {nextEligibleTask.checklist.length} checklist items done
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {getTaskPhotoEvidences(nextEligibleTask).length > 0 && (
                            <button
                              type="button"
                              onClick={() => openTaskEvidence(nextEligibleTask, 0)}
                              className="px-3.5 py-2 text-xs font-bold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5 text-sky-700" />
                              <span>
                                View Evidence ({getTaskPhotoEvidences(nextEligibleTask).length})
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedTask(nextEligibleTask)}
                            className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            {nextEligibleTask.status === 'IN_PROGRESS' ? 'Continue Checklist' : 'Open / Start Task'}
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </Card3D>
                  ) : (
                    <Card3D maxTilt={2} className="p-8 text-center rounded-2xl border border-slate-200">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      <h3 className="text-sm font-bold text-slate-900">All Scheduled Tasks Completed!</h3>
                      <p className="text-xs text-slate-500 mt-1">Outstanding work. All routine cleaning and room setup tasks are verified.</p>
                    </Card3D>
                  )}
                </div>

                {/* Live Next Upcoming Scheduled Countdown Card (Auto-Advances in Real Time) */}
                {nextUpcomingTask && nextEligibleTask?.id !== nextUpcomingTask.id && (
                  <Card3D
                    variant="dark"
                    maxTilt={2.4}
                    liftPx={3}
                    className="p-5 rounded-2xl border border-slate-700/80 text-white flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Up Next on Schedule
                        </span>
                        {new Date(nextUpcomingTask.scheduledFor).getTime() - serverNowMs <= 5 * 60 * 1000 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950 animate-pulse">
                            5m Warning Window
                          </span>
                        )}
                      </div>

                      <div className="text-lg font-mono font-bold text-amber-300 tabular-nums mb-2">
                        {formatCountdownLabel(nextUpcomingTask.scheduledFor, serverNowMs)}
                      </div>

                      <h3 className="text-sm font-bold text-white leading-snug mb-1.5 line-clamp-2">
                        {nextUpcomingTask.title}
                      </h3>

                      <div className="space-y-1 text-xs text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate font-semibold">{nextUpcomingTask.roomAreaName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                          <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span>{formatISTScheduleBadge(nextUpcomingTask.scheduledFor, serverNowMs)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400 font-mono">
                        {upcomingScheduledTasks.length} scheduled ahead
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedTask(nextUpcomingTask)}
                        className="px-3 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer"
                      >
                        View Details
                      </button>
                    </div>
                  </Card3D>
                )}
              </div>

              {/* SECTION 1: TODAY'S TASKS ONLY (IST Synchronized) */}
              <Card3D maxTilt={1.2} liftPx={2.5} className="rounded-2xl p-5 border border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-amber-600" />
                        <span>Today's Tasks ({todayIST} · IST)</span>
                      </h3>
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                        {todayRemainingTasks.length} Remaining · {todayCompletedTasks.length} Done
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Showing only today's scheduled &amp; active tasks in chronological IST order
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTaskFilterStatus('ALL');
                      setActiveTab('myTasks');
                    }}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 cursor-pointer self-start sm:self-auto"
                  >
                    <span>Open My Tasks ({todayTasks.length} Today)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {todayTasks.length === 0 ? (
                  <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-1.5" />
                    <div className="text-xs font-bold text-slate-900">No active tasks remaining in Today's Tasks</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Overdue and future-dated upcoming tasks are organized in separate sections below.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {todayTasks.map((task) => {
                      const schedMs = new Date(task.scheduledFor).getTime();
                      const msUntil = schedMs - serverNowMs;
                      const isUpcomingSoon =
                        (task.status === 'SCHEDULED' || task.status === 'AVAILABLE') &&
                        msUntil > 0 &&
                        msUntil <= 5 * 60 * 1000;
                      const isDueRightNow =
                        task.status === 'AVAILABLE' && msUntil <= 0 && Math.abs(msUntil) <= 2 * 60 * 1000;

                      return (
                        <div
                          key={task.id}
                          className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            task.status === 'COMPLETED'
                              ? 'border-emerald-200/80 bg-emerald-50/25 opacity-85'
                              : task.status === 'IN_PROGRESS'
                              ? 'border-amber-300 bg-amber-50/40'
                              : isDueRightNow
                              ? 'border-emerald-400 bg-emerald-50/40 ring-1 ring-emerald-200'
                              : isUpcomingSoon
                              ? 'border-amber-300 bg-amber-50/30'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-amber-300">
                                {formatISTScheduleBadge(task.scheduledFor, serverNowMs)}
                              </span>
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                                {task.priority}
                              </span>
                              {getStatusBadge(task.status)}
                              {(task.status === 'SCHEDULED' || task.status === 'AVAILABLE') && msUntil > 0 && (
                                <span
                                  className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded tabular-nums ${
                                    isUpcomingSoon
                                      ? 'bg-amber-200 text-amber-950'
                                      : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                                  }`}
                                >
                                  {formatCountdownLabel(task.scheduledFor, serverNowMs)}
                                </span>
                              )}
                              {isDueRightNow && (
                                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-600 text-white">
                                  Due Now
                                </span>
                              )}
                            </div>

                            <div className={`text-xs sm:text-sm font-bold truncate ${task.status === 'COMPLETED' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                              {task.title}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-semibold text-slate-700 flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-400" />
                                {task.roomAreaName}
                              </span>
                              <span>•</span>
                              <span className="font-mono">Deadline: {task.dueTime}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {getTaskPhotoEvidences(task).length > 0 && (
                              <button
                                type="button"
                                onClick={() => openTaskEvidence(task, 0)}
                                className="px-3 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5 text-sky-700" />
                                <span>
                                  View Evidence ({getTaskPhotoEvidences(task).length})
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedTask(task)}
                              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                                task.status === 'COMPLETED'
                                  ? 'text-emerald-800 bg-emerald-100 hover:bg-emerald-200'
                                  : 'text-slate-900 bg-amber-400 hover:bg-amber-300'
                              }`}
                            >
                              <span>
                                {task.status === 'COMPLETED'
                                  ? 'View'
                                  : task.status === 'IN_PROGRESS'
                                  ? 'Continue'
                                  : 'Open'}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card3D>

              {/* SECTION 2 & SECTION 3: SEPARATE OVERDUE TASKS & UPCOMING TASKS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Separate Overdue Tasks Section */}
                <Card3D maxTilt={1.4} liftPx={2.5} className="rounded-2xl p-5 border border-rose-200/80">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span>Overdue Tasks</span>
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                          {overdueTasks.length}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Past-due tasks separated from Today's Tasks
                      </p>
                    </div>
                    {overdueTasks.length > 5 && (
                      <button
                        type="button"
                        onClick={() => {
                          setTaskFilterStatus('OVERDUE');
                          setActiveTab('myTasks');
                        }}
                        className="text-xs font-bold text-rose-700 hover:text-rose-800 cursor-pointer"
                      >
                        View All ({overdueTasks.length})
                      </button>
                    )}
                  </div>

                  {overdueTasks.length === 0 ? (
                    <div className="p-5 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500">
                      Zero overdue tasks. All past deadlines are clear.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {overdueTasks.slice(0, 5).map((task) => (
                        <div
                          key={task.id}
                          className="p-3 rounded-xl border border-rose-200 bg-rose-50/30 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                                {formatISTScheduleBadge(task.scheduledFor, serverNowMs)}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">Due {task.dueTime}</span>
                            </div>
                            <div className="text-xs font-bold text-slate-900 truncate">{task.title}</div>
                            <div className="text-[11px] text-slate-600 truncate">{task.roomAreaName}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {getTaskPhotoEvidences(task).length > 0 && (
                              <button
                                type="button"
                                onClick={() => openTaskEvidence(task, 0)}
                                className="px-2.5 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5 text-sky-700" />
                                <span>View Evidence</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedTask(task)}
                              className="px-2.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shrink-0 cursor-pointer"
                            >
                              Resolve
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card3D>

                {/* Separate Upcoming Tasks Section (Future Dates > Today) */}
                <Card3D maxTilt={1.4} liftPx={2.5} className="rounded-2xl p-5 border border-indigo-200/80">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-600" />
                        <span>Upcoming Tasks</span>
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {upcomingDateTasks.length}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Future-date tasks scheduled beyond today ({todayIST})
                      </p>
                    </div>
                  </div>

                  {upcomingDateTasks.length === 0 ? (
                    <div className="p-5 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500">
                      <div>No tasks scheduled for future dates beyond today.</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Recurring daily tasks auto-generate each morning in IST.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {upcomingDateTasks.slice(0, 5).map((task) => (
                        <div
                          key={task.id}
                          className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/30 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                                {formatISTScheduleBadge(task.scheduledFor, serverNowMs)}
                              </span>
                              <span className="text-[10px] font-mono text-indigo-700 font-semibold">
                                {formatCountdownLabel(task.scheduledFor, serverNowMs)}
                              </span>
                            </div>
                            <div className="text-xs font-bold text-slate-900 truncate">{task.title}</div>
                            <div className="text-[11px] text-slate-600 truncate">{task.roomAreaName}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedTask(task)}
                            className="px-2.5 py-1.5 text-xs font-bold text-indigo-900 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition-colors shrink-0 cursor-pointer"
                          >
                            Details
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card3D>
              </div>

              {/* Quick Room Status Glance */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Office Room Status Glance</h3>
                    <p className="text-xs text-slate-500">Live readiness across all {rooms.length} configured spaces</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('roomSupport')}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 cursor-pointer"
                  >
                    <span>View All Rooms</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {rooms.slice(0, 10).map((room) => (
                    <Card3D
                      key={room.id}
                      onClick={() => setActiveTab('roomSupport')}
                      maxTilt={3.2}
                      liftPx={3}
                      className="p-2.5 rounded-xl border border-slate-200 cursor-pointer text-xs active:scale-[0.99]"
                    >
                      <div className="font-semibold text-slate-900 truncate">{room.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{room.status}</div>
                      {room.setupConfig?.summary && (
                        <div className="text-[10px] text-amber-800 font-medium mt-0.5 truncate">
                          {room.setupConfig.summary}
                        </div>
                      )}
                    </Card3D>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------- */}
          {/* TAB 2: MY TASKS (Today's Tasks, Overdue & Upcoming Separated)       */}
          {/* ------------------------------------------------------------------- */}
          {activeTab === 'myTasks' && (
            <div className="space-y-5 animate-in fade-in duration-200">
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
                      { key: 'ALL', label: `Sections (${todayTasks.length} Today)` },
                      { key: 'SCHEDULED', label: 'Scheduled' },
                      { key: 'AVAILABLE', label: 'Due / Available' },
                      { key: 'IN_PROGRESS', label: 'In Progress' },
                      { key: 'OVERDUE', label: `Overdue (${overdueTasks.length})` },
                      { key: 'PENDING', label: 'Review' },
                      { key: 'COMPLETED', label: 'Completed' },
                      { key: 'CANCELLED', label: 'Cancelled' },
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

              {(() => {
                const renderPantryTaskCard = (task: Task) => {
                  const completedItems = task.checklist.filter((c) => c.completed).length;
                  const totalItems = task.checklist.length;
                  const schedMs = new Date(task.scheduledFor).getTime();
                  const msUntil = schedMs - serverNowMs;
                  const taskPhotos = getTaskPhotoEvidences(task);
                  return (
                    <Card3D
                      key={task.id}
                      maxTilt={2.2}
                      liftPx={3}
                      className={`p-4 rounded-2xl border flex flex-col justify-between ${
                        task.status === 'CANCELLED'
                          ? 'opacity-65 border-slate-200 bg-slate-50'
                          : task.isUrgent
                          ? 'border-l-4 border-l-rose-600 border-slate-200'
                          : 'border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                              {task.priority}
                            </span>
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                              {formatISTScheduleBadge(task.scheduledFor, serverNowMs)}
                            </span>
                          </div>
                          <div className="shrink-0">{getStatusBadge(task.status)}</div>
                        </div>

                        <h3 className="text-sm font-bold text-slate-900 mb-1 leading-snug">{task.title}</h3>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
                          <span className="font-semibold text-slate-700 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            {task.roomAreaName}
                          </span>
                          <span>•</span>
                          <span className="font-mono text-[11px] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" /> Due {task.dueTime}
                          </span>
                          {(task.status === 'SCHEDULED' || task.status === 'AVAILABLE') && msUntil > 0 && (
                            <>
                              <span>•</span>
                              <span className="font-mono font-bold text-[11px] text-amber-700 tabular-nums">
                                {formatCountdownLabel(task.scheduledFor, serverNowMs)}
                              </span>
                            </>
                          )}
                        </div>

                        {task.description && (
                          <p className="text-xs text-slate-600 line-clamp-2 mb-3 bg-slate-50 p-2 rounded-lg">
                            {task.description}
                          </p>
                        )}

                        {taskPhotos.length > 0 && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => openTaskEvidence(task, 0)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openTaskEvidence(task, 0);
                              }
                            }}
                            className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 h-28 mb-3 cursor-pointer group"
                          >
                            <AuthenticatedEvidenceImage
                              photoUrl={taskPhotos[0].photoUrl}
                              alt={`Evidence for ${task.title}`}
                              compact
                              className="w-full h-full"
                              imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div className="absolute top-2 left-2 bg-slate-950/80 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded backdrop-blur-xs">
                              {taskPhotos.length} Photo{taskPhotos.length === 1 ? '' : 's'}
                            </div>
                            <div className="absolute inset-0 bg-slate-950/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1.5">
                              <Camera className="w-3.5 h-3.5 text-amber-400" />
                              <span>View Evidence</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs flex-wrap">
                        <span className="text-slate-500 font-mono text-[11px]">
                          {completedItems}/{totalItems} Done
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {taskPhotos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openTaskEvidence(task, 0)}
                              className="px-3 py-1.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5 text-sky-700" />
                              <span>View Evidence ({taskPhotos.length})</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedTask(task)}
                            className="px-3.5 py-1.5 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Task</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </Card3D>
                  );
                };

                if (taskFilterStatus === 'ALL') {
                  return (
                    <div className="space-y-6">
                      {/* 1. Today's Tasks Only */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-amber-600" />
                              <span>Today's Tasks ({todayIST} · IST)</span>
                              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                                {filteredTodayTasks.length}
                              </span>
                            </h3>
                            <p className="text-xs text-slate-500">
                              Strictly today's scheduled &amp; active tasks (overdue and upcoming tasks are separated below)
                            </p>
                          </div>
                        </div>

                        {filteredTodayTasks.length === 0 ? (
                          <div className="p-6 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                            No tasks in Today's Tasks match your current search.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {filteredTodayTasks.map(renderPantryTaskCard)}
                          </div>
                        )}
                      </div>

                      {/* 2. Separate Overdue Tasks Section */}
                      <div className="space-y-3 pt-2 border-t border-slate-200/80">
                        <div className="flex items-center justify-between px-1">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-rose-600" />
                              <span>Overdue Tasks</span>
                              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                                {filteredOverdueTasks.length}
                              </span>
                            </h3>
                            <p className="text-xs text-slate-500">
                              Uncompleted tasks past their scheduled IST due time or from prior dates
                            </p>
                          </div>
                        </div>

                        {filteredOverdueTasks.length === 0 ? (
                          <div className="p-5 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                            No overdue tasks.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {filteredOverdueTasks.map(renderPantryTaskCard)}
                          </div>
                        )}
                      </div>

                      {/* 3. Separate Upcoming Tasks Section */}
                      <div className="space-y-3 pt-2 border-t border-slate-200/80">
                        <div className="flex items-center justify-between px-1">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <Clock className="w-4 h-4 text-indigo-600" />
                              <span>Upcoming Tasks</span>
                              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                                {filteredUpcomingDateTasks.length}
                              </span>
                            </h3>
                            <p className="text-xs text-slate-500">
                              Future tasks scheduled for dates after {todayIST}
                            </p>
                          </div>
                        </div>

                        {filteredUpcomingDateTasks.length === 0 ? (
                          <div className="p-5 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                            No upcoming tasks scheduled beyond today ({todayIST}).
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {filteredUpcomingDateTasks.map(renderPantryTaskCard)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return filteredTasks.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                    <Info className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <div className="text-xs font-bold text-slate-900">No tasks found</div>
                    <p className="text-[11px] text-slate-500 mt-1">Try resetting search or status filters.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredTasks.map(renderPantryTaskCard)}
                  </div>
                );
              })()}
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
                  <p className="text-xs text-slate-500">
                    Verified room configurations (Standard: 1 table + 4 chairs · The Community: 1 large table + 10 chairs), water replenishment, and readiness by 11:00 AM IST.
                  </p>
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
                    <Card3D
                      key={room.id}
                      maxTilt={2.4}
                      liftPx={3}
                      className={`p-4 rounded-2xl border ${
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
                      {room.setupConfig?.summary && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200/80 text-[11px] font-mono font-semibold text-amber-900 mb-1">
                          <Layers className="w-3 h-3 text-amber-600" />
                          <span>Verified Setup: {room.setupConfig.summary}</span>
                        </div>
                      )}

                      <div className="space-y-1.5 text-xs text-slate-600 my-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                          <Droplets className="w-3.5 h-3.5 text-blue-500" />
                          <span>Water & Glasses: Sealed bottles placed</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Standard: {room.defaultChecklist[0] || 'Sanitize surfaces and align chairs'}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        {(() => {
                          const roomPhotos = roomEvidenceMap.get(room.id) || [];
                          return (
                            <>
                              {room.status !== 'AVAILABLE' && room.status !== 'READY_FOR_VISITOR' ? (
                                <button
                                  type="button"
                                  onClick={() => handleMarkRoomReady(room.id)}
                                  className="flex-1 py-1.5 px-3 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Mark Ready</span>
                                </button>
                              ) : (
                                <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Room Verified &amp; Ready
                                </div>
                              )}
                              {roomPhotos.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEvidenceViewerState({
                                      photos: roomPhotos,
                                      initialIndex: 0,
                                      title: `${room.name} — Room Evidence`,
                                      roomName: room.name,
                                    })
                                  }
                                  className="py-1.5 px-2.5 text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Camera className="w-3.5 h-3.5 text-sky-700" />
                                  <span>View Evidence ({roomPhotos.length})</span>
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </Card3D>
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
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Task Completion &amp; Evidence History</h2>
                  <p className="text-xs text-slate-500">
                    Audit logs and persisted camera evidence of submitted and completed maintenance tasks.
                  </p>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  {completedTasks.length} Verified · {historyWithEvidenceTasks.length} Total Records
                </span>
              </div>

              {historyWithEvidenceTasks.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
                  <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-900">No submitted or completed task records yet</div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Submitted live camera evidence and verified task completions will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyWithEvidenceTasks.map((task) => {
                    const taskPhotos = getTaskPhotoEvidences(task);
                    const latestTimestamp =
                      task.completedAt ||
                      task.submittedAt ||
                      taskPhotos[taskPhotos.length - 1]?.serverTimestamp;
                    return (
                      <div
                        key={task.id}
                        className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                            <span className="text-xs text-slate-400">· Priority {task.priority}</span>
                            {task.status === 'COMPLETED' ? (
                              <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                              </span>
                            ) : (
                              getStatusBadge(task.status)
                            )}
                          </div>
                          <h4 className="text-xs font-semibold text-slate-700">{task.title}</h4>
                          <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 flex-wrap">
                            <span>
                              {task.status === 'COMPLETED' ? 'Completed:' : 'Submitted:'}{' '}
                              {latestTimestamp ? formatISTFullDateTime(latestTimestamp) : 'Today'}
                            </span>
                            {taskPhotos.length > 0 && (
                              <>
                                <span>·</span>
                                <span>
                                  {taskPhotos.length} Photo{taskPhotos.length === 1 ? '' : 's'} Saved
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                          {taskPhotos.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => openTaskEvidence(task, 0)}
                                className="w-14 h-12 rounded-xl overflow-hidden border border-slate-200 hover:border-amber-400 bg-slate-900 shrink-0 cursor-pointer transition-colors"
                                title={`Preview photo evidence for ${task.title}`}
                              >
                                <AuthenticatedEvidenceImage
                                  photoUrl={taskPhotos[0].photoUrl}
                                  alt={`Evidence thumbnail for ${task.title}`}
                                  compact
                                  className="w-full h-full"
                                  imgClassName="w-full h-full object-cover"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => openTaskEvidence(task, 0)}
                                className="px-3.5 py-2 text-xs font-bold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5 text-sky-700" />
                                <span>View Evidence ({taskPhotos.length})</span>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedTask(task)}
                            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                          >
                            Task Details
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
                      {roleTitle}
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
                    <div className="text-slate-900 font-bold mt-0.5">{roleCodeLabel}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Department</div>
                    <div className="text-slate-900 font-bold mt-0.5">{currentUser?.department || 'Hospitality & Operations'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="text-slate-400 font-medium">Contact Phone</div>
                    <div className="text-slate-900 font-mono mt-0.5">{currentUser?.phone || 'Not provided'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 sm:col-span-2">
                    <div className="text-slate-400 font-medium flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Office Address</span>
                    </div>
                    <div className="text-slate-900 font-semibold mt-0.5 leading-relaxed">
                      6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India
                    </div>
                  </div>
                </div>

                {/* Attendance Summary */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-600" />
                      <span className="font-bold text-slate-900 text-xs">Today's Attendance Summary</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">Asia/Kolkata (IST)</span>
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
                      <span className="text-slate-400">Logout IST:</span>{' '}
                      <span className="font-mono font-bold text-slate-900">
                        {todayAttendance?.logoutTimeIST || 'Active'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 text-[10px] text-slate-500 flex items-center justify-between gap-1.5">
                    <span>Automatic IST login and logout timestamps recorded per session.</span>
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
                    Daily attendance login/logout is recorded automatically with IST timestamps. All 15 room morning routines (9:00 AM), water bottle distribution (10:00 AM), recheck (3:00 PM), and closing inspection (7:30 PM) require live photo verification.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Responsive Corporate Office Footer */}
        <footer className="mt-auto border-t border-slate-200/80 bg-white/80 px-4 sm:px-6 lg:px-8 py-3.5 shrink-0">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5 text-[11px] text-slate-500">
            <div className="font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
              <Building2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
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
                <span>Showing daily server IST attendance records</span>
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
                        {rec.elapsedMinutes !== undefined ? (
                          <span className="text-[11px] font-mono font-semibold text-slate-700">
                            Elapsed: {Math.floor(rec.elapsedMinutes / 60)}h {rec.elapsedMinutes % 60}m
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-emerald-700 font-semibold">
                            In Session
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
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(selectedTask.priority)}`}>
                    {selectedTask.priority}
                  </span>
                  <span className="text-xs font-bold text-slate-800">{selectedTask.roomAreaName}</span>
                  {(() => {
                    const matchedRoom = rooms.find((r) => r.id === selectedTask.roomAreaId);
                    return matchedRoom?.setupConfig?.summary ? (
                      <span className="text-[11px] font-mono font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Setup: {matchedRoom.setupConfig.summary}
                      </span>
                    ) : null;
                  })()}
                  <span className="text-xs font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    {formatISTScheduleBadge(selectedTask.scheduledFor, serverNowMs)}
                  </span>
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
                        disabled={!canEditTasks}
                        onChange={(e) => canEditTasks && handleToggleChecklist(selectedTask, item.id, e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer disabled:opacity-50"
                      />
                      <span className={`leading-snug ${item.completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                        {item.text}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Live Photo Evidence Section */}
              <div>
                {(() => {
                  const selectedTaskPhotos = getTaskPhotoEvidences(selectedTask);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          Live Photo Evidence {selectedTaskPhotos.length > 0 ? `(${selectedTaskPhotos.length})` : ''}
                        </h4>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selectedTaskPhotos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openTaskEvidence(selectedTask, 0)}
                              className="px-2.5 py-1 text-xs font-bold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5 text-sky-700" />
                              <span>View Evidence ({selectedTaskPhotos.length})</span>
                            </button>
                          )}
                          <span className="text-[11px] text-amber-700 font-semibold">
                            Strict Live Camera Only
                          </span>
                        </div>
                      </div>

                      {selectedTaskPhotos.length > 0 ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {selectedTaskPhotos.map((pe, idx) => (
                              <div
                                key={pe.id || `pe-${idx}`}
                                className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 flex flex-col group shadow-2xs"
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="relative h-36 bg-slate-900 overflow-hidden cursor-pointer"
                                  onClick={() => openTaskEvidence(selectedTask, idx)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openTaskEvidence(selectedTask, idx);
                                    }
                                  }}
                                >
                                  <AuthenticatedEvidenceImage
                                    photoUrl={pe.photoUrl}
                                    alt={`Evidence photo #${idx + 1}`}
                                    compact
                                    className="w-full h-full"
                                    imgClassName="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                  <span className="absolute top-2 left-2 bg-slate-900/80 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded backdrop-blur-xs">
                                    Photo #{idx + 1}
                                  </span>
                                  <span className="absolute bottom-2 right-2 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[9px] font-mono px-2 py-0.5 rounded backdrop-blur-xs flex items-center gap-1">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                                    {pe.status === 'VERIFIED' ? 'VERIFIED' : 'PERSISTED'}
                                  </span>
                                </div>
                                <div className="p-2.5 text-[11px] space-y-1 bg-white flex-1 flex flex-col justify-between">
                                  <div className="font-semibold text-slate-800 flex items-center justify-between gap-1">
                                    <span className="truncate">Captured IST:</span>
                                    <span className="font-mono text-slate-600 text-[10px]">
                                      {new Date(pe.capturedAt || pe.serverTimestamp).toLocaleTimeString('en-IN', {
                                        timeZone: 'Asia/Kolkata',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500 flex items-center justify-between font-mono pt-1 border-t border-slate-100">
                                    <span>Server Upload:</span>
                                    <span>
                                      {new Date(pe.serverTimestamp).toLocaleTimeString('en-IN', {
                                        timeZone: 'Asia/Kolkata',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openTaskEvidence(selectedTask, 0)}
                              className="px-3.5 py-1.5 text-xs font-bold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                              <Camera className="w-3.5 h-3.5 text-sky-700" />
                              <span>Open Full-Size Gallery ({selectedTaskPhotos.length})</span>
                            </button>

                            {selectedTask.status !== 'COMPLETED' && canEditTasks && (
                              <button
                                type="button"
                                onClick={() => setCameraModalTask(selectedTask)}
                                className="px-3.5 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                <span>Retake or Add Photos</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center bg-slate-50">
                          <Camera className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                          <p className="text-xs text-slate-600 mb-3 font-medium">
                            Capture clean room arrangement, chair alignment, and water bottles using live camera.
                          </p>
                          {canEditTasks && (
                            <button
                              type="button"
                              onClick={() => setCameraModalTask(selectedTask)}
                              className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                            >
                              <Camera className="w-4 h-4" />
                              <span>Capture Live Photos</span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between gap-3">
              {(selectedTask.status === 'AVAILABLE' ||
                selectedTask.status === 'SCHEDULED' ||
                selectedTask.status === 'OVERDUE' ||
                selectedTask.status === 'REJECTED') &&
                canEditTasks && (
                  <button
                    type="button"
                    onClick={() => handleStartTask(selectedTask)}
                    disabled={actionLoading}
                    className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start This Task
                  </button>
                )}

              {selectedTask.status === 'IN_PROGRESS' && canEditTasks && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBlockerModal(true)}
                    className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors cursor-pointer"
                  >
                    Report Blocked
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraModalTask(selectedTask)}
                    className="flex-1 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>
                      {selectedTask.photoEvidences && selectedTask.photoEvidences.length > 0
                        ? `Capture More Photos (${selectedTask.photoEvidences.length})`
                        : selectedTask.photoEvidence
                        ? 'Retake Live Photos'
                        : 'Capture Live Photos'}
                    </span>
                  </button>
                </>
              )}

              {selectedTask.status === 'BLOCKED' && canEditTasks && (
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

              {selectedTask.status === 'CANCELLED' && (
                <div className="w-full text-center py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl border border-slate-200">
                  Task Cancelled by {selectedTask.cancelledBy || 'Management'}
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
      {/* Full-Size Persisted Photo Evidence Gallery / Lightbox Modal             */}
      {/* ----------------------------------------------------------------------- */}
      <EvidenceLightboxModal
        isOpen={Boolean(evidenceViewerState)}
        onClose={() => setEvidenceViewerState(null)}
        photos={evidenceViewerState?.photos || []}
        initialIndex={evidenceViewerState?.initialIndex || 0}
        title={evidenceViewerState?.title}
        task={evidenceViewerState?.task || null}
        roomName={evidenceViewerState?.roomName}
        uploaderName={currentUser?.name}
        onRefreshEvidence={async () => {
          const targetTask = evidenceViewerState?.task;
          if (targetTask?.id) {
            try {
              const fresh = await api.getTaskEvidence(targetTask.id);
              setEvidenceViewerState((prev) =>
                prev
                  ? {
                      ...prev,
                      photos: fresh.photoEvidences || [],
                    }
                  : null
              );
            } catch {
              await loadData();
            }
          } else {
            await loadData();
          }
        }}
      />

      {/* ----------------------------------------------------------------------- */}
      {/* PANTRY-BOY-ONLY ALERT 1: 5-Minute Pre-Task Warning Popup                */}
      {/* ----------------------------------------------------------------------- */}
      <AnimatePresence>
        {isExclusivelyPantryBoy && warningAlerts.length > 0 && dueAlerts.length === 0 && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
            {(() => {
              const warnTask = warningAlerts[0];
              return (
                <motion.div
                  key={`warn-modal-${warnTask.id}`}
                  initial={{ opacity: 0, scale: 0.94, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 12 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                  className="w-full max-w-md bg-white rounded-2xl shadow-2xl border-2 border-amber-400 overflow-hidden"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="pantry-warn-5min-title"
                >
                  <div className="px-5 py-4 bg-amber-500 text-slate-950 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-slate-950 text-amber-400 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-900">
                          Upcoming Task · 5-Minute Warning
                        </div>
                        <div id="pantry-warn-5min-title" className="text-sm font-bold text-slate-950">
                          {formatCountdownLabel(warnTask.scheduledFor, serverNowMs)}
                        </div>
                      </div>
                    </div>
                    {warningAlerts.length > 1 && (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-950 text-amber-300">
                        1 of {warningAlerts.length}
                      </span>
                    )}
                  </div>

                  <div className="p-5 space-y-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Scheduled Task
                      </div>
                      <h4 className="text-base font-bold text-slate-900 leading-snug">{warnTask.title}</h4>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-amber-600" />
                          Location
                        </span>
                        <span className="font-bold text-slate-900 text-right">{warnTask.roomAreaName}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-amber-600" />
                          Scheduled Time
                        </span>
                        <span className="font-mono font-bold text-slate-900 text-right">
                          {formatISTFullDateTime(warnTask.scheduledFor)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Priority</span>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(warnTask.priority)}`}>
                          {warnTask.priority}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      Please wrap up current activity and prepare cleaning or hospitality supplies for{' '}
                      <strong className="text-slate-900">{warnTask.roomAreaName}</strong>.
                    </p>

                    <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => dismissWarningAlert(warnTask.id)}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTask(warnTask);
                          dismissWarningAlert(warnTask.id);
                        }}
                        className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>View Task Details</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })()}
          </div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------------- */}
      {/* PANTRY-BOY-ONLY ALERT 2: At-Task-Time Prominent Execution Popup         */}
      {/* ----------------------------------------------------------------------- */}
      <AnimatePresence>
        {isExclusivelyPantryBoy && dueAlerts.length > 0 && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
            {(() => {
              const dueTask = dueAlerts[0];
              return (
                <motion.div
                  key={`due-modal-${dueTask.id}`}
                  initial={{ opacity: 0, scale: 0.92, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: 16 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border-2 border-amber-500 overflow-hidden"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="pantry-due-now-title"
                >
                  {/* Prominent High-Contrast Header */}
                  <div className="px-5 py-4 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-xl bg-amber-400 opacity-50" />
                        <div className="relative w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0 shadow-md">
                          <Bell className="w-5 h-5" />
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
                          Scheduled Task Time Reached · Action Required
                        </div>
                        <div id="pantry-due-now-title" className="text-base font-bold text-white">
                          Execute Scheduled Task Now
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {dueAlerts.length > 1 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-400 text-slate-950">
                          1 of {dueAlerts.length}
                        </span>
                      )}
                      <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded border ${getPriorityStyle(dueTask.priority)}`}>
                        {dueTask.priority}
                      </span>
                    </div>
                  </div>

                  {/* Task Details & Required Actions */}
                  <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                    <div>
                      <h4 className="text-lg font-bold text-slate-900 leading-snug">{dueTask.title}</h4>
                      {dueTask.description && (
                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
                          {dueTask.description}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs">
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-500">Location / Room</div>
                        <div className="font-bold text-slate-900 mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{dueTask.roomAreaName}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-500">Scheduled Time (IST)</div>
                        <div className="font-mono font-bold text-slate-900 mt-0.5">
                          {formatISTFullDateTime(dueTask.scheduledFor)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-500">Completion Window</div>
                        <div className="font-mono font-semibold text-slate-800 mt-0.5">Due {dueTask.dueTime}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-500">Assigned By</div>
                        <div className="font-semibold text-slate-800 mt-0.5">{dueTask.createdByName}</div>
                      </div>
                    </div>

                    {/* Required Action Checklist Preview */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                        Required Action Checklist ({dueTask.checklist.length} steps + Live Photo)
                      </div>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {dueTask.checklist.map((item, idx) => (
                          <div
                            key={item.id}
                            className="flex items-start gap-2 text-xs text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/80"
                          >
                            <span className="font-mono font-bold text-amber-700 shrink-0">{idx + 1}.</span>
                            <span className="leading-snug">{item.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => dismissDueAlert(dueTask.id)}
                        className="px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTask(dueTask);
                          dismissDueAlert(dueTask.id);
                        }}
                        className="px-4 py-2.5 text-xs font-bold text-slate-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition-colors cursor-pointer"
                      >
                        Open Checklist
                      </button>
                      {canEditTasks && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={async () => {
                            dismissDueAlert(dueTask.id);
                            await handleStartTask(dueTask);
                          }}
                          className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Start Task Now</span>
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })()}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
