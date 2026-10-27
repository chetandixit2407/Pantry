import React, { useState, useMemo, useCallback } from 'react';
import type {
  RoomArea,
  UserAccount,
  RoomStatus,
  Role,
} from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { Card3D } from '../common/Card3D.tsx';
import {
  Building,
  Users,
  UserCheck,
  UserX,
  CheckCircle2,
  DoorOpen,
  AlertTriangle,
  RefreshCw,
  Search,
  Clock,
  ChevronRight,
  X,
  Check,
  History,
  ArrowRightLeft,
} from 'lucide-react';

export interface RealtimeRoomDashboardProps {
  rooms: RoomArea[];
  allUsers: UserAccount[];
  currentUser: UserAccount | null;
  onRefresh: () => Promise<void>;
  onOpenVisitorModal?: (roomId?: string) => void;
  onViewHistory?: (room: RoomArea) => void;
  canManageAssignments: boolean;
  canManageRooms: boolean;
  isCompactView?: boolean;
  onNavigateToRoomsTab?: () => void;
}

export const RealtimeRoomDashboard: React.FC<RealtimeRoomDashboardProps> = ({
  rooms,
  allUsers,
  currentUser,
  onRefresh,
  onOpenVisitorModal,
  onViewHistory,
  canManageAssignments,
  canManageRooms,
  isCompactView = false,
  onNavigateToRoomsTab,
}) => {
  // Filters & Search
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Inline Employee Assignment State (per room)
  const [assigningRoomId, setAssigningRoomId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [assignmentNotes, setAssignmentNotes] = useState<string>('');
  const [assignmentInitialStatus, setAssignmentInitialStatus] = useState<'ASSIGNED' | 'OCCUPIED'>('ASSIGNED');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState<boolean>(false);
  const [unassigningRoomId, setUnassigningRoomId] = useState<string | null>(null);
  const [togglingOccupancyRoomId, setTogglingOccupancyRoomId] = useState<string | null>(null);

  // Reassignment Conflict Modal State
  const [conflictModalData, setConflictModalData] = useState<{
    roomId: string;
    roomName: string;
    employeeId: string;
    employeeName: string;
    conflictingRoomName?: string;
    conflictingRoomId?: string;
    currentAssignedEmployeeName?: string;
    notes?: string;
    status?: RoomStatus;
    errorMessage: string;
  } | null>(null);

  // Action Success / Error Feedback Banner
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showFeedback = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((current) => (current?.message === message ? null : current));
    }, 4500);
  }, []);

  // Active employees eligible for assignment
  const activeEmployees = useMemo(() => {
    return allUsers.filter((u) => u.status === 'active');
  }, [allUsers]);

  // Find which room each employee is currently assigned to (for collision hint)
  const employeeRoomMap = useMemo(() => {
    const map = new Map<string, { roomId: string; roomName: string }>();
    rooms.forEach((r) => {
      if (r.assignedEmployeeId) {
        map.set(r.assignedEmployeeId, { roomId: r.id, roomName: r.name });
      }
    });
    return map;
  }, [rooms]);

  // Status Metrics
  const metrics = useMemo(() => {
    const total = rooms.length;
    const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length;
    const vacant = rooms.filter(
      (r) => r.status === 'AVAILABLE' || r.status === 'VACANT' || r.status === 'READY_FOR_VISITOR'
    ).length;
    const assigned = rooms.filter((r) => Boolean(r.assignedEmployeeId) || r.status === 'ASSIGNED').length;
    const needsPrep = rooms.filter(
      (r) => r.status === 'PREPARATION_REQUIRED' || r.status === 'CLEANING_REQUIRED'
    ).length;
    return { total, occupied, vacant, assigned, needsPrep };
  }, [rooms]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (!room.enabled && filterStatus !== 'ALL') return false;

      // Filter by status
      if (filterStatus === 'OCCUPIED' && room.status !== 'OCCUPIED') return false;
      if (filterStatus === 'VACANT') {
        const isVacant =
          room.status === 'AVAILABLE' || room.status === 'VACANT' || room.status === 'READY_FOR_VISITOR';
        if (!isVacant) return false;
      }
      if (filterStatus === 'ASSIGNED') {
        const isAssigned = Boolean(room.assignedEmployeeId) || room.status === 'ASSIGNED';
        if (!isAssigned) return false;
      }
      if (filterStatus === 'NEEDS_PREP') {
        const needsPrep =
          room.status === 'PREPARATION_REQUIRED' || room.status === 'CLEANING_REQUIRED';
        if (!needsPrep) return false;
      }

      // Filter by category
      if (filterCategory !== 'ALL' && room.category !== filterCategory) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = room.name.toLowerCase().includes(q);
        const matchesCategory = room.category.toLowerCase().includes(q);
        const matchesEmployee = (room.assignedEmployeeName || '').toLowerCase().includes(q);
        const matchesVisitor = (room.currentAssignment?.visitorName || '').toLowerCase().includes(q);
        const matchesRef = (room.currentAssignment?.reference || '').toLowerCase().includes(q);
        return matchesName || matchesCategory || matchesEmployee || matchesVisitor || matchesRef;
      }

      return true;
    });
  }, [rooms, filterStatus, filterCategory, searchQuery]);

  // Display subset for compact dashboard view if requested
  const displayedRooms = isCompactView ? filteredRooms.slice(0, 6) : filteredRooms;

  // Execute One-Click Unassign
  const handleOneClickUnassign = async (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Only Admin, HR, and Kimmi Mam can unassign rooms.', 'error');
      return;
    }

    const prevEmpName = room.assignedEmployeeName || room.currentAssignment?.visitorName || 'Employee';
    setUnassigningRoomId(room.id);

    try {
      await api.unassignRoomEmployee(room.id);
      showFeedback(`Successfully unassigned "${room.name}" from ${prevEmpName}. Room is now Vacant.`);
      await onRefresh();
    } catch (err: any) {
      showFeedback(err.message || `Failed to unassign "${room.name}".`, 'error');
    } finally {
      setUnassigningRoomId(null);
    }
  };

  // Open inline employee assignment panel
  const handleOpenAssignPanel = (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Only Admin, HR, and Kimmi Mam can assign rooms.', 'error');
      return;
    }
    setAssigningRoomId(room.id);
    setSelectedEmployeeId(activeEmployees[0]?.id || '');
    setAssignmentNotes('');
    setAssignmentInitialStatus(room.status === 'OCCUPIED' ? 'OCCUPIED' : 'ASSIGNED');
  };

  // Close inline assignment panel
  const handleCloseAssignPanel = () => {
    setAssigningRoomId(null);
    setSelectedEmployeeId('');
    setAssignmentNotes('');
    setIsSubmittingAssign(false);
  };

  // Submit Employee Assignment
  const handleExecuteAssign = async (room: RoomArea, forceOverride = false) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Only Admin, HR, and Kimmi Mam can assign rooms.', 'error');
      return;
    }
    if (!selectedEmployeeId) {
      showFeedback('Please select an employee to assign.', 'error');
      return;
    }

    const targetEmp = activeEmployees.find((u) => u.id === selectedEmployeeId);
    if (!targetEmp) {
      showFeedback('Selected employee not found.', 'error');
      return;
    }

    setIsSubmittingAssign(true);

    try {
      await api.assignRoomEmployee(room.id, {
        employeeId: selectedEmployeeId,
        notes: assignmentNotes.trim() || undefined,
        forceOverride,
        status: assignmentInitialStatus,
      });

      showFeedback(`Successfully assigned "${room.name}" to ${targetEmp.name} (${targetEmp.department || targetEmp.role}).`);
      handleCloseAssignPanel();
      setConflictModalData(null);
      await onRefresh();
    } catch (err: any) {
      if (err.code === 'EMPLOYEE_ALREADY_ASSIGNED' || err.code === 'ROOM_ALREADY_ASSIGNED') {
        setConflictModalData({
          roomId: room.id,
          roomName: room.name,
          employeeId: selectedEmployeeId,
          employeeName: targetEmp.name,
          conflictingRoomName: err.conflictingRoom?.name,
          conflictingRoomId: err.conflictingRoom?.id,
          currentAssignedEmployeeName: err.currentAssignedEmployee?.name,
          notes: assignmentNotes.trim() || undefined,
          status: assignmentInitialStatus,
          errorMessage: err.message || 'Conflicting assignment detected.',
        });
      } else {
        showFeedback(err.message || 'Failed to assign room to employee.', 'error');
      }
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // Confirm Forced Reassignment after collision
  const handleConfirmConflictOverride = async () => {
    if (!conflictModalData) return;
    const room = rooms.find((r) => r.id === conflictModalData.roomId);
    if (!room) return;

    setIsSubmittingAssign(true);
    try {
      await api.assignRoomEmployee(conflictModalData.roomId, {
        employeeId: conflictModalData.employeeId,
        notes: conflictModalData.notes,
        forceOverride: true,
        status: conflictModalData.status,
      });

      showFeedback(
        `Reassignment confirmed: "${room.name}" assigned to ${conflictModalData.employeeName}. Conflicting room unassigned.`
      );
      setConflictModalData(null);
      handleCloseAssignPanel();
      await onRefresh();
    } catch (err: any) {
      showFeedback(err.message || 'Failed to force reassignment.', 'error');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // Toggle Occupied / Vacant status directly on room card
  const handleToggleOccupancy = async (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: You are not authorized to change room occupancy status.', 'error');
      return;
    }

    setTogglingOccupancyRoomId(room.id);
    const isCurrentlyOccupied = room.status === 'OCCUPIED';
    const targetAction = isCurrentlyOccupied ? 'RELEASE_VACANT' : 'MARK_OCCUPIED';

    try {
      await api.roomStatusAction(room.id, targetAction as any);
      showFeedback(
        `Room "${room.name}" is now ${isCurrentlyOccupied ? 'marked Vacant' : 'marked Occupied'}.`
      );
      await onRefresh();
    } catch (err: any) {
      showFeedback(err.message || `Failed to update occupancy status for "${room.name}".`, 'error');
    } finally {
      setTogglingOccupancyRoomId(null);
    }
  };

  const getRoleBadgeColor = (role?: Role) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'KIMMY_MAM':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      case 'HR':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'PANTRY_BOY':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const formatRoleLabel = (role?: Role) => {
    switch (role) {
      case 'ADMIN':
        return 'Admin';
      case 'KIMMY_MAM':
        return 'Co-Founder';
      case 'HR':
        return 'HR';
      case 'PANTRY_BOY':
        return 'Pantry Attendant';
      default:
        return role || 'Staff';
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 shadow-sm transition-all duration-300 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Section Header Card */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Building className="w-5 h-5 text-amber-600" />
              <span>Real-Time Room Status & Employee Assignments</span>
            </h3>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-mono font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live SSE Sync Active
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authoritative room occupancy, employee allocations, one-click assign/unassign actions, and instant multi-role synchronization for Admin, HR, and Kimmi Mam.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => onRefresh()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Refresh room status now"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
            <span>Sync</span>
          </button>
          {isCompactView && onNavigateToRoomsTab && (
            <button
              type="button"
              onClick={onNavigateToRoomsTab}
              className="px-3.5 py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span>View All {rooms.length} Areas</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Metrics & Status Filter Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
        <button
          type="button"
          onClick={() => setFilterStatus('ALL')}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
            filterStatus === 'ALL'
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <div className="text-[10px] opacity-75 font-semibold uppercase tracking-wider">All Rooms</div>
          <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">{metrics.total}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus('OCCUPIED')}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
            filterStatus === 'OCCUPIED'
              ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
              : 'bg-purple-50/70 text-purple-900 border-purple-200 hover:bg-purple-100/70'
          }`}
        >
          <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            Occupied
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">{metrics.occupied}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus('VACANT')}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
            filterStatus === 'VACANT'
              ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
              : 'bg-emerald-50/70 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
          }`}
        >
          <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Vacant (Ready)
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">{metrics.vacant}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus('ASSIGNED')}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
            filterStatus === 'ASSIGNED'
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'bg-amber-50/80 text-amber-900 border-amber-200 hover:bg-amber-100/80'
          }`}
        >
          <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-amber-600" />
            Staff Assigned
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">{metrics.assigned}</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterStatus('NEEDS_PREP')}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer col-span-2 sm:col-span-1 ${
            filterStatus === 'NEEDS_PREP'
              ? 'bg-rose-700 text-white border-rose-700 shadow-xs'
              : 'bg-rose-50/70 text-rose-900 border-rose-200 hover:bg-rose-100/70'
          }`}
        >
          <div className="text-[10px] opacity-80 font-semibold uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3 text-rose-600" />
            Needs Cleaning/Prep
          </div>
          <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">{metrics.needsPrep}</div>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search room name, assigned employee, visitor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto text-xs">
          <span className="text-[11px] font-semibold text-slate-400 shrink-0">Category:</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            aria-label="Filter rooms by category"
            className="py-1 px-2.5 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <option value="ALL">All Categories</option>
            <option value="MEETING_SUITE">Meeting Suites</option>
            <option value="EXECUTIVE_CABIN">Executive Cabins</option>
            <option value="WORKSTATION">Workstations</option>
            <option value="RECEPTION">Reception & Lounges</option>
            <option value="COMMON_AREA">Common Areas</option>
            <option value="FACILITIES">Facilities</option>
          </select>
          <span className="text-xs text-slate-400 font-mono shrink-0">
            Showing {displayedRooms.length} of {rooms.length}
          </span>
        </div>
      </div>

      {/* Room Cards Grid */}
      {displayedRooms.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-200 bg-white text-center">
          <Building className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-slate-700">No rooms match your filter</h4>
          <p className="text-xs text-slate-400 mt-1">Try resetting the status filter or search query.</p>
          <button
            type="button"
            onClick={() => {
              setFilterStatus('ALL');
              setFilterCategory('ALL');
              setSearchQuery('');
            }}
            className="mt-3 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedRooms.map((room) => {
            const isAssigned = Boolean(room.assignedEmployeeId);
            const isOccupied = room.status === 'OCCUPIED';
            const isVacant =
              room.status === 'AVAILABLE' || room.status === 'VACANT' || room.status === 'READY_FOR_VISITOR';
            const isUnassigning = unassigningRoomId === room.id;
            const isTogglingOccupancy = togglingOccupancyRoomId === room.id;
            const isPanelOpen = assigningRoomId === room.id;

            return (
              <Card3D
                key={room.id}
                maxTilt={2.2}
                liftPx={3}
                disabled={!room.enabled}
                className={`rounded-2xl border p-4.5 flex flex-col justify-between transition-shadow duration-200 ${
                  !room.enabled
                    ? 'opacity-60 bg-slate-50 border-slate-200'
                    : isOccupied
                    ? 'border-purple-200/90 bg-gradient-to-br from-white via-white to-purple-50/20'
                    : isAssigned
                    ? 'border-amber-200/90 bg-gradient-to-br from-white via-white to-amber-50/20'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="space-y-3">
                  {/* Top Bar: Category, Priority, and Occupied / Vacant Badge */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {room.defaultPriority}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                        {room.category.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Prominent Occupied / Vacant Status Indicator */}
                    <div className="flex items-center gap-1.5">
                      {isOccupied ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-100 text-purple-900 border border-purple-200 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse"></span>
                          OCCUPIED
                        </span>
                      ) : isVacant ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          VACANT
                        </span>
                      ) : room.status === 'ASSIGNED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-200 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          ASSIGNED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-100 text-rose-900 border border-rose-200 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                          {room.status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Room Name */}
                  <div>
                    <h4 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5 leading-snug">
                      <Building className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{room.name}</span>
                    </h4>
                    {room.setupConfig?.summary && (
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        Setup: {room.setupConfig.summary}
                      </div>
                    )}
                  </div>

                  {/* Assigned Employee Box */}
                  <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/70 text-xs space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Assigned Employee</span>
                      {isAssigned && (
                        <span className="text-[10px] font-mono text-amber-700 font-bold">Active Standing</span>
                      )}
                    </div>

                    {isAssigned ? (
                      <div className="flex items-center gap-2 pt-0.5">
                        <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center justify-center font-bold text-xs shrink-0">
                          {room.assignedEmployeeName ? room.assignedEmployeeName.slice(0, 2).toUpperCase() : 'EM'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 truncate">
                              {room.assignedEmployeeName}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full border ${getRoleBadgeColor(
                                room.assignedEmployeeRole as Role
                              )}`}
                            >
                              {formatRoleLabel(room.assignedEmployeeRole as Role)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate font-mono">
                            {room.assignedEmployeeEmail || 'No email on record'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 pt-0.5">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span className="italic">No employee assigned (Unassigned)</span>
                      </div>
                    )}
                  </div>

                  {/* Current Assignment / Visitor Booking Box */}
                  <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/50 text-xs space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Current Assignment
                    </div>
                    {room.currentAssignment ? (
                      <div className="space-y-1 pt-0.5">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span className="truncate">{room.currentAssignment.visitorName}</span>
                          <span className="text-[10px] font-mono bg-slate-200/80 px-1.5 py-0.2 rounded shrink-0">
                            {room.currentAssignment.expectedArrival}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          <strong>Reference:</strong> {room.currentAssignment.reference}
                        </div>
                        {room.currentAssignment.instructions && (
                          <div className="text-[10px] text-slate-500 italic truncate">
                            "{room.currentAssignment.instructions}"
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400">
                          Assigned by {room.currentAssignment.assignedBy || 'Management'}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic pt-0.5">
                        No active visitor booking or meeting assignment
                      </div>
                    )}
                  </div>

                  {/* Inline Employee Selection Panel (expands on Assign/Reassign click) */}
                  {isPanelOpen && (
                    <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/80 text-xs space-y-2.5 animate-in fade-in duration-200 shadow-sm">
                      <div className="flex items-center justify-between text-amber-950 font-bold border-b border-amber-200/80 pb-1.5">
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-amber-700" />
                          <span>Select Employee for {room.name}</span>
                        </span>
                        <button
                          type="button"
                          onClick={handleCloseAssignPanel}
                          className="text-amber-800 hover:text-amber-950 p-0.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Employee Dropdown Selector */}
                      <div>
                        <label className="block text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1">
                          Select Employee *
                        </label>
                        <select
                          value={selectedEmployeeId}
                          onChange={(e) => setSelectedEmployeeId(e.target.value)}
                          className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                        >
                          {activeEmployees.map((emp) => {
                            const currentRoom = employeeRoomMap.get(emp.id);
                            const isAssignedHere = room.assignedEmployeeId === emp.id;
                            const isAssignedElsewhere = currentRoom && currentRoom.roomId !== room.id;

                            let statusSuffix = '';
                            if (isAssignedHere) {
                              statusSuffix = ' (Currently in this room)';
                            } else if (isAssignedElsewhere) {
                              statusSuffix = ` (Assigned to: ${currentRoom.roomName})`;
                            }

                            return (
                              <option key={emp.id} value={emp.id}>
                                {emp.name} — {formatRoleLabel(emp.role)}
                                {emp.department ? ` (${emp.department})` : ''}
                                {statusSuffix}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Optional Notes */}
                      <div>
                        <label className="block text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1">
                          Assignment Notes (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Lead project discussions, executive office..."
                          value={assignmentNotes}
                          onChange={(e) => setAssignmentNotes(e.target.value)}
                          className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                        />
                      </div>

                      {/* Initial Status Toggle */}
                      <div className="flex items-center gap-3 text-[11px] font-medium text-amber-950">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`occ-${room.id}`}
                            checked={assignmentInitialStatus === 'ASSIGNED'}
                            onChange={() => setAssignmentInitialStatus('ASSIGNED')}
                            className="text-amber-600 focus:ring-amber-500"
                          />
                          <span>Keep As Assigned (Vacant)</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`occ-${room.id}`}
                            checked={assignmentInitialStatus === 'OCCUPIED'}
                            onChange={() => setAssignmentInitialStatus('OCCUPIED')}
                            className="text-amber-600 focus:ring-amber-500"
                          />
                          <span className="font-bold text-purple-900">Mark Occupied Immediately</span>
                        </label>
                      </div>

                      {/* Submit Actions */}
                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-200/80">
                        <button
                          type="button"
                          onClick={handleCloseAssignPanel}
                          disabled={isSubmittingAssign}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExecuteAssign(room, false)}
                          disabled={isSubmittingAssign}
                          className="px-3 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                        >
                          {isSubmittingAssign ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>Assigning...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Confirm Assignment</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Direct One-Click Actions on Room Card */}
                <div className="pt-3 border-t border-slate-100 space-y-2 mt-3">
                  {canManageAssignments && (
                    <div className="space-y-1.5">
                      {/* One-Click Assign / Unassign Row */}
                      <div className="flex items-center gap-2">
                        {isAssigned ? (
                          <>
                            {/* ONE-CLICK UNASSIGN BUTTON */}
                            <button
                              type="button"
                              onClick={() => handleOneClickUnassign(room)}
                              disabled={isUnassigning}
                              className="flex-1 py-1.5 px-2.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] disabled:opacity-50 shadow-2xs"
                              title={`One-click unassign ${room.name} from ${room.assignedEmployeeName}`}
                            >
                              {isUnassigning ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Unassigning...</span>
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3.5 h-3.5 text-rose-600" />
                                  <span>Unassign</span>
                                </>
                              )}
                            </button>

                            {/* REASSIGN BUTTON */}
                            <button
                              type="button"
                              onClick={() =>
                                isPanelOpen ? handleCloseAssignPanel() : handleOpenAssignPanel(room)
                              }
                              className="py-1.5 px-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer shrink-0"
                              title="Reassign to another employee"
                            >
                              <ArrowRightLeft className="w-3 h-3 text-amber-700" />
                              <span>Reassign</span>
                            </button>
                          </>
                        ) : (
                          /* ONE-CLICK ASSIGN EMPLOYEE BUTTON */
                          <button
                            type="button"
                            onClick={() =>
                              isPanelOpen ? handleCloseAssignPanel() : handleOpenAssignPanel(room)
                            }
                            className="w-full py-1.5 px-3 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-950" />
                            <span>{isPanelOpen ? 'Close Employee Selector' : 'Assign Employee'}</span>
                          </button>
                        )}
                      </div>

                      {/* Quick Occupied / Vacant Status Toggle Button */}
                      <div className="flex items-center gap-2">
                        {isOccupied ? (
                          <button
                            type="button"
                            onClick={() => handleToggleOccupancy(room)}
                            disabled={isTogglingOccupancy}
                            className="w-full py-1.5 px-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Mark room as Vacant / Available"
                          >
                            {isTogglingOccupancy ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            <span>Mark Vacant</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleOccupancy(room)}
                            disabled={isTogglingOccupancy}
                            className="w-full py-1.5 px-2 text-[11px] font-bold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Mark room as Occupied"
                          >
                            {isTogglingOccupancy ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <DoorOpen className="w-3.5 h-3.5 text-purple-600" />
                            )}
                            <span>Mark Occupied</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Secondary Room Controls: Visitor Booking & History */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
                    {onViewHistory && (
                      <button
                        type="button"
                        onClick={() => onViewHistory(room)}
                        className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                      >
                        <History className="w-3 h-3" />
                        <span>Audit History</span>
                      </button>
                    )}

                    {onOpenVisitorModal && (
                      <button
                        type="button"
                        onClick={() => onOpenVisitorModal(room.id)}
                        className="hover:text-amber-800 font-bold transition-colors flex items-center gap-1 cursor-pointer text-amber-700"
                      >
                        <Users className="w-3 h-3" />
                        <span>Book Guest</span>
                      </button>
                    )}
                  </div>
                </div>
              </Card3D>
            );
          })}
        </div>
      )}

      {/* Collision & Conflict Resolution Modal */}
      {conflictModalData && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-amber-300 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Assignment Conflict Detected</h3>
                <p className="text-xs text-slate-500">Duplicate assignment prevention guard</p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-950 space-y-2">
              <p className="leading-relaxed font-medium">
                {conflictModalData.conflictingRoomName ? (
                  <>
                    <strong>{conflictModalData.employeeName}</strong> is already assigned to{' '}
                    <strong className="underline">{conflictModalData.conflictingRoomName}</strong>.
                  </>
                ) : (
                  <>
                    <strong>{conflictModalData.roomName}</strong> is currently assigned to{' '}
                    <strong className="underline">
                      {conflictModalData.currentAssignedEmployeeName || 'another employee'}
                    </strong>
                    .
                  </>
                )}
              </p>
              <p className="text-[11px] text-amber-800 leading-normal">
                White Collar Realty policy prevents overlapping room assignments. Do you want to unassign them from the previous room and assign them to{' '}
                <strong>"{conflictModalData.roomName}"</strong>?
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConflictModalData(null)}
                disabled={isSubmittingAssign}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmConflictOverride}
                disabled={isSubmittingAssign}
                className="px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isSubmittingAssign ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reassigning...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm & Force Reassign</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
