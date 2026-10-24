import React, { useState, useEffect, useCallback } from 'react';
import type { Task, TaskStatus } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { CameraCaptureModal } from '../common/CameraCaptureModal.tsx';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Camera,
  Play,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Layers,
  MapPin,
  X,
  FileCheck,
  LogOut,
} from 'lucide-react';

export const PantryBoyView: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'ROOM_TASKS' | 'COMPLETED'>('ACTIVE');
  const [cameraModalTask, setCameraModalTask] = useState<Task | null>(null);

  // Blocker modal state
  const [showBlockerModal, setShowBlockerModal] = useState<boolean>(false);
  const [blockerReason, setBlockerReason] = useState<string>('Room occupied for client meeting / interview in progress');
  const [customReason, setCustomReason] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Current time state
  const [currentTime, setCurrentTime] = useState<string>(
    new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
      );
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const data = await api.getTasks({ assignedTo: currentUser?.email });
      setTasks(data);
      if (selectedTask) {
        const updated = data.find((t) => t.id === selectedTask.id);
        if (updated) setSelectedTask(updated);
      }
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.email, selectedTask?.id]);

  useEffect(() => {
    loadTasks();
    const unsubscribe = api.subscribeRealtime(() => {
      loadTasks();
    });

    // Deep-linking from notification click
    const handleOpenTask = (e: any) => {
      if (e.detail?.taskId) {
        const targetId = e.detail.taskId;
        const found = tasks.find((t) => t.id === targetId);
        if (found) {
          setSelectedTask(found);
          if (found.taskType === 'VISITOR_PREP' || found.taskType === 'VISITOR_RESET') {
            setActiveTab('ROOM_TASKS');
          } else {
            setActiveTab('ACTIVE');
          }
        } else {
          loadTasks().then(() => {
            const reFound = tasks.find((t) => t.id === targetId);
            if (reFound) setSelectedTask(reFound);
          });
        }
      }
    };

    window.addEventListener('wcr_open_task', handleOpenTask);

    const interval = setInterval(loadTasks, 4000);
    return () => {
      unsubscribe();
      window.removeEventListener('wcr_open_task', handleOpenTask);
      clearInterval(interval);
    };
  }, [loadTasks, tasks]);

  const activeTasks = tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');
  const roomTasks = activeTasks.filter(
    (t) =>
      t.taskType === 'VISITOR_PREP' ||
      t.taskType === 'VISITOR_RESET' ||
      t.title.includes('[ROOM') ||
      t.title.includes('[VISITOR') ||
      t.title.includes('[POST-MEETING') ||
      t.title.toLowerCase().includes('prep') ||
      t.title.toLowerCase().includes('reset')
  );

  // Next eligible task: highest priority available or in-progress task
  const nextEligibleTask = activeTasks.find((t) => t.status === 'IN_PROGRESS') || activeTasks[0];

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

  const getPriorityStyle = (priority: string) => {
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
        return <span className="text-amber-700 font-semibold text-xs">In Progress</span>;
      case 'BLOCKED':
        return <span className="text-rose-600 font-semibold text-xs">Blocked</span>;
      case 'PENDING_VERIFICATION':
        return <span className="text-sky-700 font-semibold text-xs">Pending Verification</span>;
      case 'COMPLETED':
        return <span className="text-emerald-700 font-semibold text-xs">Completed</span>;
      case 'REJECTED':
        return <span className="text-rose-700 font-semibold text-xs">Photo Rejected - Retake</span>;
      default:
        return <span className="text-slate-600 font-medium text-xs">Available</span>;
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 sm:py-6 pb-20">
      {/* Mobile Top Operational Bar */}
      <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 mb-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold tracking-wide uppercase text-slate-300">
              Active Shift · 9:00 AM – 8:00 PM
            </span>
          </div>
          <div className="text-sm font-mono font-bold text-amber-400 tabular-nums">{currentTime} IST</div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">{currentUser?.name}</h1>
            <div className="text-xs text-slate-400">Pantry & Hospitality Attendant</div>
            <button
              type="button"
              onClick={() => logout()}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/30 rounded-lg transition-colors"
            >
              <LogOut className="w-3 h-3" />
              <span>Log Out</span>
            </button>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Today's Remaining</div>
            <div className="text-base font-bold text-white font-mono tabular-nums">
              {activeTasks.length} <span className="text-xs font-normal text-slate-400">tasks</span>
            </div>
          </div>
        </div>
      </div>

      {/* Segmented Filter Control */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('ACTIVE')}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap px-2 ${
            activeTab === 'ACTIVE' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Tasks ({activeTasks.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ROOM_TASKS')}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap px-2 flex items-center justify-center gap-1 ${
            activeTab === 'ROOM_TASKS' ? 'bg-amber-400 text-slate-950 font-bold shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-amber-900" />
          <span>Room Tasks ({roomTasks.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('COMPLETED')}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors text-center whitespace-nowrap px-2 ${
            activeTab === 'COMPLETED' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Completed Today ({completedTasks.length})
        </button>
      </div>

      {/* ROOM TASKS VIEW */}
      {activeTab === 'ROOM_TASKS' && (
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Visitor & Candidate Room Prep Queue</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">Priority Order</span>
          </div>

          {roomTasks.length === 0 ? (
            <div className="p-8 text-center rounded-xl border border-slate-200 bg-white">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <div className="text-xs font-bold text-slate-900">No Pending Room Preparation Tasks</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                All assigned visitor and candidate rooms are currently prepared or completed.
              </p>
            </div>
          ) : (
            roomTasks.map((task) => (
              <div
                key={task.id}
                className="p-4 bg-white rounded-xl border border-amber-200 shadow-xs hover:border-amber-400 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded font-mono">
                    {task.dueTime}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-slate-900 mb-1">{task.title}</h4>
                <p className="text-xs text-slate-600 mb-3">{task.description}</p>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <span className="text-slate-500 font-medium">
                    Checklist: {task.checklist.filter((c) => c.completed).length} / {task.checklist.length} done
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
            ))
          )}
        </div>
      )}

      {activeTab === 'ACTIVE' && (
        <>
          {/* Prominent Next Eligible Task Card */}
          {nextEligibleTask && (
            <div className="mb-6 p-4 sm:p-5 rounded-xl border-2 border-amber-500/50 bg-gradient-to-br from-amber-50/60 via-white to-white shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                  {nextEligibleTask.status === 'IN_PROGRESS' ? 'Currently Working On' : 'Next Priority Task'}
                </span>
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(
                    nextEligibleTask.priority
                  )}`}
                >
                  {nextEligibleTask.priority}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 mb-1 leading-snug">{nextEligibleTask.title}</h2>

              <div className="flex items-center gap-2 text-xs text-slate-600 mb-3">
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {nextEligibleTask.roomAreaName}
                </span>
                <span aria-hidden="true">·</span>
                <span>Due {nextEligibleTask.dueTime}</span>
              </div>

              {nextEligibleTask.description && (
                <p className="text-xs text-slate-600 leading-relaxed mb-4">{nextEligibleTask.description}</p>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-amber-200/60">
                <div className="text-xs text-slate-500">
                  {nextEligibleTask.checklist.filter((c) => c.completed).length} of {nextEligibleTask.checklist.length}{' '}
                  done
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedTask(nextEligibleTask)}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  {nextEligibleTask.status === 'IN_PROGRESS' ? 'Continue Checklist' : 'Start Task'}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Active Tasks List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">All Scheduled Tasks</h3>
              <span className="text-xs text-slate-400 font-mono">Routine order (P1 to P5)</span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading scheduled tasks...</div>
            ) : activeTasks.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-slate-200 bg-white">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-900">All Tasks Completed!</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Outstanding job. All routine office cleaning and water distribution tasks are verified.
                </p>
              </div>
            ) : (
              activeTasks.map((task) => {
                const completedCount = task.checklist.filter((c) => c.completed).length;
                const totalCount = task.checklist.length;
                const isSelected = selectedTask?.id === task.id;

                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer bg-white ${
                      isSelected
                        ? 'border-slate-900 shadow-md ring-1 ring-slate-900/10'
                        : 'border-slate-200 hover:border-slate-300 shadow-sm'
                    } ${task.isUrgent ? 'border-l-4 border-l-rose-600' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(
                            task.priority
                          )}`}
                        >
                          {task.priority}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                      </div>
                      <div className="shrink-0">{getStatusBadge(task.status)}</div>
                    </div>

                    <h4 className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{task.title}</h4>

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Due {task.dueTime}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span>
                          {completedCount}/{totalCount} Checklist
                        </span>
                        {task.photoEvidence && (
                          <span className="text-emerald-600 font-semibold flex items-center gap-0.5">
                            <Camera className="w-3 h-3" /> Photo Attached
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Completed Tasks Tab */}
      {activeTab === 'COMPLETED' && (
        <div className="space-y-3">
          {completedTasks.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
              No tasks completed yet today.
            </div>
          ) : (
            completedTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{task.roomAreaName}</span>
                    <span className="text-xs text-slate-400">· {task.priority}</span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                  </span>
                </div>
                <h4 className="text-xs text-slate-700 font-medium">{task.title}</h4>
                <div className="text-[11px] text-slate-400 mt-2 font-mono">
                  Completed at {task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : 'Today'}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Selected Task Detail Sheet / Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs">
          <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Sheet Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between bg-slate-50 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getPriorityStyle(
                      selectedTask.priority
                    )}`}
                  >
                    {selectedTask.priority}
                  </span>
                  <span className="text-xs font-bold text-slate-800">{selectedTask.roomAreaName}</span>
                  <span className="text-xs text-slate-400">· Due {selectedTask.dueTime}</span>
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

            {/* Sheet Content */}
            <div className="p-5 overflow-y-auto space-y-5">
              {/* Status / Instructions */}
              {selectedTask.description && (
                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                  {selectedTask.description}
                </div>
              )}

              {/* Blocked or Rejection Notice */}
              {selectedTask.status === 'BLOCKED' && (
                <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Task Marked as Blocked</div>
                    <div className="mt-0.5">{selectedTask.blockedReason}</div>
                    <div className="text-[11px] text-rose-600 mt-1">
                      You may resume when the room is free, or proceed with other tasks.
                    </div>
                  </div>
                </div>
              )}

              {selectedTask.status === 'REJECTED' && (
                <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Photo Verification Rejected</div>
                    <div className="mt-0.5">{selectedTask.rejectionReason}</div>
                    <div className="text-[11px] text-rose-600 mt-1 font-semibold">
                      Please retake a clear live photo showing aligned chairs and clean surfaces.
                    </div>
                  </div>
                </div>
              )}

              {/* Mandatory Checklist Section */}
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
                      className={`flex items-start gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
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

              {/* Live Photo Evidence Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Photo Evidence</h4>
                  <span className="text-[11px] text-amber-700 font-semibold">Live Camera Required</span>
                </div>

                {selectedTask.photoEvidence ? (
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                    <img
                      src={selectedTask.photoEvidence.photoUrl}
                      alt="Submitted Evidence"
                      className="w-full h-48 object-cover"
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
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                        >
                          Retake
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center bg-slate-50">
                    <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs text-slate-600 mb-3">
                      Capture clean room arrangement, chair alignment, and water bottles using the live camera.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCameraModalTask(selectedTask)}
                      className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-sm"
                    >
                      <Camera className="w-4 h-4" />
                      Open Live Camera
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sheet Footer Actions */}
            <div className="p-4 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between gap-3">
              {selectedTask.status === 'AVAILABLE' && (
                <button
                  type="button"
                  onClick={() => handleStartTask(selectedTask)}
                  disabled={actionLoading}
                  className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
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
                    className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
                  >
                    Report Blocked
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraModalTask(selectedTask)}
                    className="flex-1 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {selectedTask.photoEvidence ? 'Change Photo' : 'Capture Live Photo'}
                  </button>
                </>
              )}

              {selectedTask.status === 'BLOCKED' && (
                <button
                  type="button"
                  onClick={() => handleStartTask(selectedTask)}
                  className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  Room is Now Free · Resume Task
                </button>
              )}

              {selectedTask.status === 'PENDING_VERIFICATION' && (
                <div className="w-full text-center py-2 text-xs font-semibold text-sky-700 bg-sky-50 rounded-lg border border-sky-200">
                  Evidence Submitted · Awaiting Verification from HR / Kimmy Mam
                </div>
              )}

              {selectedTask.status === 'COMPLETED' && (
                <div className="w-full text-center py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Task Completed & Photo Verified
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Blocker Modal */}
      {showBlockerModal && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-5 border border-slate-200">
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
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer ${
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
                placeholder="Describe the specific roadblock..."
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg mb-4 focus:ring-1 focus:ring-slate-900"
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
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
              >
                Submit Blocked Notice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Camera Capture Modal */}
      {cameraModalTask && (
        <CameraCaptureModal
          taskId={cameraModalTask.id}
          taskTitle={cameraModalTask.title}
          roomName={cameraModalTask.roomAreaName}
          userEmail={currentUser?.email || 'pantry@whitecollarrealty.com'}
          isOpen={Boolean(cameraModalTask)}
          onClose={() => setCameraModalTask(null)}
          onPhotoUploaded={handlePhotoUploaded}
        />
      )}
    </div>
  );
};
