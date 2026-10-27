import React, { useState, useMemo, useCallback } from 'react';
import type { RoomArea, UserAccount } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  X,
  Check,
  UserCheck,
  ArrowRight,
  LayoutGrid,
  List,
} from 'lucide-react';

export interface RealtimeRoomDashboardProps {
  rooms: RoomArea[];
  allUsers: UserAccount[];
  currentUser: UserAccount | null;
  onRefresh: () => Promise<void>;
  onOpenVisitorModal?: (roomId?: string) => void;
  onViewHistory?: (room: RoomArea) => void;
  canManageAssignments: boolean;
  canManageRooms?: boolean;
  isCompactView?: boolean;
  onNavigateToRoomsTab?: () => void;
}

export const RealtimeRoomDashboard: React.FC<RealtimeRoomDashboardProps> = ({
  rooms,
  allUsers,
  currentUser: _currentUser,
  onRefresh,
  onOpenVisitorModal: _onOpenVisitorModal,
  onViewHistory: _onViewHistory,
  canManageAssignments,
  canManageRooms: _canManageRooms,
  isCompactView = false,
  onNavigateToRoomsTab,
}) => {
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'VACANT' | 'OCCUPIED'>('ALL');
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');

  // Assignment Modal & Loading States
  const [assigningRoom, setAssigningRoom] = useState<RoomArea | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState<boolean>(false);
  const [unassigningRoomId, setUnassigningRoomId] = useState<string | null>(null);
  const [togglingOccupancyRoomId, setTogglingOccupancyRoomId] = useState<string | null>(null);

  // Collision Conflict State
  const [conflictData, setConflictData] = useState<{
    roomId: string;
    roomName: string;
    employeeId: string;
    employeeName: string;
    conflictingRoomName?: string;
    currentAssignedEmployeeName?: string;
    errorMessage: string;
  } | null>(null);

  // Feedback Notification Banner
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showFeedback = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((current) => (current?.message === message ? null : current));
    }, 4000);
  }, []);

  // Active employees eligible for assignment
  const activeEmployees = useMemo(() => {
    return allUsers.filter((u) => u.status === 'active');
  }, [allUsers]);

  // Map each employee to their current assigned room (for collision preview)
  const employeeRoomMap = useMemo(() => {
    const map = new Map<string, { roomId: string; roomName: string }>();
    rooms.forEach((r) => {
      if (r.assignedEmployeeId) {
        map.set(r.assignedEmployeeId, { roomId: r.id, roomName: r.name });
      }
    });
    return map;
  }, [rooms]);

  // Helper to determine if a room is Occupied vs Vacant based on live status and active bookings
  const isRoomOccupied = useCallback((room: RoomArea): boolean => {
    if (room.status === 'OCCUPIED') return true;
    if (room.currentAssignment && room.currentAssignment.status === 'ACTIVE') return true;
    return false;
  }, []);

  // Summary Metrics: Total, Vacant, Occupied
  const totalRooms = rooms.length;
  const occupiedRooms = useMemo(() => {
    return rooms.filter((r) => isRoomOccupied(r)).length;
  }, [rooms, isRoomOccupied]);
  const vacantRooms = totalRooms - occupiedRooms;

  // Filtered rooms list
  const filteredRooms = useMemo(() => {
    const list = rooms.filter((room) => {
      if (!room.enabled) return false;
      const occupied = isRoomOccupied(room);
      if (statusFilter === 'VACANT' && occupied) return false;
      if (statusFilter === 'OCCUPIED' && !occupied) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = room.name.toLowerCase().includes(q);
        const matchesSetup = room.setupConfig?.summary?.toLowerCase().includes(q) || false;
        return matchesName || matchesSetup;
      }
      return true;
    });
    return isCompactView ? list.slice(0, 10) : list;
  }, [rooms, statusFilter, searchQuery, isCompactView, isRoomOccupied]);

  // Execute Unassign on a room
  const handleUnassign = async (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Only Admin, HR, and Kimmi Mam can unassign rooms.', 'error');
      return;
    }

    setUnassigningRoomId(room.id);
    try {
      await api.unassignRoomEmployee(room.id);
      showFeedback(`Successfully unassigned "${room.name}".`);
      await onRefresh();
    } catch (err: any) {
      showFeedback(err.message || `Failed to unassign "${room.name}".`, 'error');
    } finally {
      setUnassigningRoomId(null);
    }
  };

  // Open the Assign modal for a room
  const handleOpenAssignModal = (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Only Admin, HR, and Kimmi Mam can assign rooms.', 'error');
      return;
    }
    setAssigningRoom(room);
    setSelectedEmployeeId(room.assignedEmployeeId || activeEmployees[0]?.id || '');
    setConflictData(null);
  };

  // Execute Assign on a room
  const handleExecuteAssign = async (forceOverride = false) => {
    if (!assigningRoom) return;
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
      await api.assignRoomEmployee(assigningRoom.id, {
        employeeId: selectedEmployeeId,
        forceOverride,
      });

      showFeedback(`Successfully assigned "${assigningRoom.name}" to ${targetEmp.name}.`);
      setAssigningRoom(null);
      setConflictData(null);
      await onRefresh();
    } catch (err: any) {
      if (err.code === 'EMPLOYEE_ALREADY_ASSIGNED' || err.code === 'ROOM_ALREADY_ASSIGNED') {
        setConflictData({
          roomId: assigningRoom.id,
          roomName: assigningRoom.name,
          employeeId: selectedEmployeeId,
          employeeName: targetEmp.name,
          conflictingRoomName: err.conflictingRoom?.name,
          currentAssignedEmployeeName: err.currentAssignedEmployee?.name,
          errorMessage: err.message || 'Conflicting assignment detected.',
        });
      } else {
        showFeedback(err.message || 'Failed to assign room to employee.', 'error');
      }
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // Toggle Occupied / Vacant status directly on room
  const handleToggleOccupancy = async (room: RoomArea) => {
    if (!canManageAssignments) {
      showFeedback('Permission denied: Authorized management only.', 'error');
      return;
    }

    setTogglingOccupancyRoomId(room.id);
    const currentlyOccupied = isRoomOccupied(room);
    const action = currentlyOccupied ? 'RELEASE_VACANT' : 'MARK_OCCUPIED';

    try {
      await api.roomStatusAction(room.id, action as any);
      showFeedback(
        `"${room.name}" is now marked ${currentlyOccupied ? 'Vacant' : 'Occupied'}.`
      );
      await onRefresh();
    } catch (err: any) {
      showFeedback(err.message || `Failed to update status for "${room.name}".`, 'error');
    } finally {
      setTogglingOccupancyRoomId(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3.5">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 shadow-2xs transition-all duration-300 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="truncate">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Container Card — Matches exact dimensions, rounded corners and padding from reference image */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-4 sm:p-5 space-y-4">
        {/* Header Lockup matching reference image */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight leading-tight">
              Office Room Status Glance
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live readiness across all {totalRooms} configured spaces
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isCompactView && onNavigateToRoomsTab ? (
              <button
                type="button"
                onClick={onNavigateToRoomsTab}
                className="text-xs sm:text-sm font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>View All Rooms</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-slate-600">
                <button
                  type="button"
                  onClick={() => setViewMode('CARDS')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewMode === 'CARDS'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'hover:text-slate-900'
                  }`}
                  title="Card view (Reference style)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('TABLE')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewMode === 'TABLE'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'hover:text-slate-900'
                  }`}
                  title="Table view"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRefresh()}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Sync status"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Compact Summary Cards for Total, Vacant, and Occupied Rooms */}
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
          <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 text-center">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Total Rooms
            </div>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-slate-900 mt-0.5 tabular-nums">
              {totalRooms}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'VACANT' ? 'ALL' : 'VACANT')}
            className={`border rounded-2xl p-2.5 sm:p-3 text-center transition-all cursor-pointer ${
              statusFilter === 'VACANT'
                ? 'bg-emerald-100/80 border-emerald-300 ring-2 ring-emerald-500/20'
                : 'bg-emerald-50/70 border-emerald-200/80 hover:bg-emerald-100/60'
            }`}
          >
            <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Vacant
            </div>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-emerald-950 mt-0.5 tabular-nums">
              {vacantRooms}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'OCCUPIED' ? 'ALL' : 'OCCUPIED')}
            className={`border rounded-2xl p-2.5 sm:p-3 text-center transition-all cursor-pointer ${
              statusFilter === 'OCCUPIED'
                ? 'bg-rose-100/80 border-rose-300 ring-2 ring-rose-500/20'
                : 'bg-rose-50/70 border-rose-200/80 hover:bg-rose-100/60'
            }`}
          >
            <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider flex items-center justify-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              Occupied
            </div>
            <div className="text-lg sm:text-xl font-extrabold font-mono text-rose-950 mt-0.5 tabular-nums">
              {occupiedRooms}
            </div>
          </button>
        </div>

        {/* Compact Search and Status Filters Toolbar */}
        <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-slate-100">
          <div className="relative flex-1 w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search rooms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 w-full sm:w-auto bg-slate-100 p-0.5 rounded-xl text-xs shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('VACANT')}
              className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                statusFilter === 'VACANT'
                  ? 'bg-white text-emerald-800 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-emerald-700'
              }`}
            >
              <span>🟢</span>
              <span>Vacant</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('OCCUPIED')}
              className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                statusFilter === 'OCCUPIED'
                  ? 'bg-white text-rose-800 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-rose-700'
              }`}
            >
              <span>🔴</span>
              <span>Occupied</span>
            </button>
          </div>
        </div>

        {/* Content: Cards View (Exact match to reference image) or Compact Table View */}
        {filteredRooms.length === 0 ? (
          <div className="p-6 rounded-2xl border border-dashed border-slate-200 text-center">
            <p className="text-xs font-semibold text-slate-500">No rooms match your filter</p>
            {(searchQuery || statusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                }}
                className="mt-2 text-xs font-bold text-amber-700 hover:underline cursor-pointer"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : viewMode === 'CARDS' ? (
          /* Exact 2-Column Clean Card Layout matching the Reference Image */
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {filteredRooms.map((room) => {
              const isOccupied = isRoomOccupied(room);
              const isAssigned = Boolean(room.assignedEmployeeId);
              const isUnassigning = unassigningRoomId === room.id;
              const isTogglingOccupancy = togglingOccupancyRoomId === room.id;

              return (
                <div
                  key={room.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all p-3 sm:p-3.5 flex flex-col justify-between min-h-[96px]"
                >
                  <div>
                    {/* Room Name */}
                    <h4
                      className="text-xs sm:text-sm font-bold text-slate-900 truncate leading-snug"
                      title={room.name}
                    >
                      {room.name}
                    </h4>

                    {/* Live Status indicator matching reference screenshot */}
                    <div className="text-[10px] font-bold tracking-wider uppercase mt-1 flex items-center gap-1">
                      {isOccupied ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                          <span className="text-rose-700">Occupied</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                          <span className="text-slate-400">
                            {room.status === 'VACANT' ? 'VACANT' : 'AVAILABLE'}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Setup Details (1 table + 4 chairs) matching reference screenshot */}
                    {room.setupConfig?.summary && (
                      <div className="text-[11px] font-medium text-amber-800 mt-1 truncate">
                        {room.setupConfig.summary}
                      </div>
                    )}
                  </div>

                  {/* Compact Assign / Unassign & Occupancy Action Row */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-1.5">
                    {isAssigned ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleUnassign(room)}
                          disabled={isUnassigning || !canManageAssignments}
                          className="flex-1 py-1 px-1.5 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors text-center cursor-pointer disabled:opacity-50 truncate"
                          title={`Unassign ${room.name}`}
                        >
                          {isUnassigning ? '...' : 'Unassign'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAssignModal(room)}
                          disabled={!canManageAssignments}
                          className="py-1 px-1 text-[10px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Reassign employee"
                        >
                          Reassign
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenAssignModal(room)}
                        disabled={!canManageAssignments}
                        className="flex-1 py-1 px-2 text-[10px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors text-center cursor-pointer shadow-2xs disabled:opacity-50"
                        title={`Assign employee to ${room.name}`}
                      >
                        Assign
                      </button>
                    )}

                    {/* Quick Occupancy Toggle button */}
                    <button
                      type="button"
                      onClick={() => handleToggleOccupancy(room)}
                      disabled={isTogglingOccupancy}
                      className={`py-1 px-1.5 rounded-lg border text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                        isOccupied
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                      title={isOccupied ? 'Release (Mark Vacant)' : 'Check-In (Mark Occupied)'}
                    >
                      {isTogglingOccupancy ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : isOccupied ? (
                        'Release'
                      ) : (
                        'Occupy'
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Compact Table View */
          <div className="overflow-x-auto border border-slate-200/90 rounded-2xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-2 px-3">Room Name</th>
                  <th className="py-2 px-3">Live Status</th>
                  <th className="py-2 px-3">Setup</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRooms.map((room) => {
                  const isOccupied = isRoomOccupied(room);
                  const isAssigned = Boolean(room.assignedEmployeeId);
                  const isUnassigning = unassigningRoomId === room.id;

                  return (
                    <tr key={room.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2 px-3 font-bold text-slate-900">
                        {room.name}
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isOccupied ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                          ></span>
                          <span className={isOccupied ? 'text-rose-700 font-bold' : 'text-slate-600'}>
                            {isOccupied ? 'Occupied' : 'Vacant'}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-amber-800 font-medium text-[11px]">
                        {room.setupConfig?.summary || '—'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isAssigned ? (
                            <button
                              type="button"
                              onClick={() => handleUnassign(room)}
                              disabled={isUnassigning || !canManageAssignments}
                              className="py-1 px-2 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isUnassigning ? '...' : 'Unassign'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenAssignModal(room)}
                              disabled={!canManageAssignments}
                              className="py-1 px-2.5 text-[10px] font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                            >
                              Assign
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleToggleOccupancy(room)}
                            className="py-1 px-2 text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                          >
                            {isOccupied ? 'Release' : 'Occupy'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Functional Assign Employee Modal */}
      {assigningRoom && !conflictData && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  Assign Room
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAssigningRoom(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-2.5">
                Assign an employee to <strong className="text-slate-900 font-bold">{assigningRoom.name}</strong>.
              </p>

              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                Select Employee
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full py-2 px-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
              >
                {activeEmployees.map((emp) => {
                  const currentRoom = employeeRoomMap.get(emp.id);
                  const isAssignedHere = assigningRoom.assignedEmployeeId === emp.id;
                  const isAssignedElsewhere = currentRoom && currentRoom.roomId !== assigningRoom.id;

                  let suffix = '';
                  if (isAssignedHere) {
                    suffix = ' (Currently assigned)';
                  } else if (isAssignedElsewhere) {
                    suffix = ` (${currentRoom.roomName})`;
                  }

                  return (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} {emp.department ? `· ${emp.department}` : ''}{suffix}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAssigningRoom(null)}
                disabled={isSubmittingAssign}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExecuteAssign(false)}
                disabled={isSubmittingAssign || !selectedEmployeeId}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAssign ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Assigning...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm Assign</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Conflict Override Modal */}
      {conflictData && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-amber-300 shadow-2xl max-w-sm w-full p-5 space-y-3.5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Assignment Conflict</h3>
                <p className="text-[11px] text-slate-500">Employee already allocated</p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-950 space-y-1.5">
              <p className="leading-snug">
                <strong>{conflictData.employeeName}</strong> is already assigned to{' '}
                <strong className="underline">{conflictData.conflictingRoomName || 'another room'}</strong>.
              </p>
              <p className="text-[11px] text-amber-800 leading-normal">
                Reassign them to <strong>"{conflictData.roomName}"</strong> and unassign from previous room?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => setConflictData(null)}
                disabled={isSubmittingAssign}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExecuteAssign(true)}
                disabled={isSubmittingAssign}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAssign ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reassigning...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm & Reassign</span>
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
