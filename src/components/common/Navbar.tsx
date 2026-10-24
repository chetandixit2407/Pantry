import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { Bell, Check, LogOut, ChevronDown, Building2 } from 'lucide-react';

interface NavbarProps {
  activeView: 'PANTRY' | 'MANAGEMENT';
  setActiveView: (view: 'PANTRY' | 'MANAGEMENT') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, setActiveView }) => {
  const { currentUser, allUsers, switchUser, logout, notifications, unreadNotifCount, markNotificationRead } = useAuth();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isManagement =
    currentUser?.role === 'HR' ||
    currentUser?.role === 'KIMMY_MAM' ||
    currentUser?.role === 'ADMIN';

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setShowRoleMenu(false);
    setShowNotifMenu(false);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4 h-16">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-sm tracking-tighter shadow-sm">
            WCR
          </div>
          <div>
            <div className="font-bold text-slate-900 tracking-tight text-base leading-tight whitespace-nowrap">
              White Collar Realty
            </div>
            <div className="text-[11px] text-slate-500 font-medium">SmartPantry & Hospitality OS</div>
          </div>
        </div>

        {/* Zone 2: Navigation Links for Management / Admin */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {isManagement && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveView('PANTRY')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  activeView === 'PANTRY' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pantry Boy Mobile View
              </button>
              <button
                type="button"
                onClick={() => setActiveView('MANAGEMENT')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  activeView === 'MANAGEMENT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Operations Dashboard
              </button>
            </div>
          )}

          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Shift: 9:00 AM – 8:00 PM (Asia/Kolkata)</span>
          </div>
        </nav>

        {/* Zone 3: Notification Bell, Role Switcher & Direct Logout */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNotifMenu(!showNotifMenu);
                setShowRoleMenu(false);
              }}
              className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-amber-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {showNotifMenu && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-900">Activity Notifications</span>
                  <span className="text-[11px] text-slate-500 tabular-nums">{notifications.length} logged</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">No recent notifications</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          markNotificationRead(n.id);
                          if (n.taskId) {
                            if (currentUser?.role === 'PANTRY_BOY') {
                              setActiveView('PANTRY');
                            }
                            window.dispatchEvent(new CustomEvent('wcr_open_task', { detail: { taskId: n.taskId } }));
                          }
                          setShowNotifMenu(false);
                        }}
                        className={`p-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors ${
                          !n.read ? 'bg-amber-50/50 font-semibold' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-900">{n.title}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px] leading-relaxed">{n.message}</p>
                        {n.taskId && (
                          <div className="mt-1 text-[10px] font-bold text-amber-800 flex items-center gap-1">
                            <span>Tap to view task details & camera evidence →</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Role Switcher Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowRoleMenu(!showRoleMenu);
                setShowNotifMenu(false);
              }}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <img
                src={currentUser?.avatarUrl}
                alt={currentUser?.name}
                className="w-7 h-7 rounded-full object-cover border border-slate-200"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="text-left hidden sm:block">
                <div className="text-xs font-semibold text-slate-900 leading-none">{currentUser?.name}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  {currentUser?.role === 'PANTRY_BOY'
                    ? 'Pantry Attendant'
                    : currentUser?.role === 'KIMMY_MAM'
                    ? 'Kimmy Mam (Exec)'
                    : currentUser?.role === 'ADMIN'
                    ? 'System Admin'
                    : 'HR Facilities'}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {showRoleMenu && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Current Account
                  </div>
                  <div className="text-xs font-bold text-slate-900 mt-1">
                    {currentUser?.name} ({currentUser?.role})
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">{currentUser?.email}</div>
                </div>

                <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Switch Active Account
                </div>

                <div className="py-1 max-h-56 overflow-y-auto">
                  {allUsers.map((user) => {
                    const isSelected = currentUser?.id === user.id;
                    const isUserDeactivated = user.status === 'inactive';

                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={async () => {
                          if (!isUserDeactivated && !isSelected) {
                            await switchUser(user.id);
                            setShowRoleMenu(false);
                            if (user.role === 'PANTRY_BOY') {
                              setActiveView('PANTRY');
                            } else {
                              setActiveView('MANAGEMENT');
                            }
                          }
                        }}
                        disabled={isUserDeactivated || isSelected}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between text-xs hover:bg-slate-50 transition-colors ${
                          isSelected ? 'bg-amber-50/50 cursor-default' : ''
                        } ${isUserDeactivated ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="w-7 h-7 rounded-full object-cover border border-slate-200"
                          />
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{user.name}</span>
                              {isUserDeactivated && (
                                <span className="text-[9px] font-mono text-rose-600 bg-rose-50 px-1 rounded">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {user.role} · {user.email}
                            </div>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-amber-600" />}
                      </button>
                    );
                  })}
                </div>

                <div className="p-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="w-full px-3 py-2 text-left flex items-center gap-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{isLoggingOut ? 'Logging out...' : 'Sign Out of Account'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Dedicated Fast Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title="Log Out of White Collar Realty"
            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors flex items-center gap-1 text-xs font-medium"
          >
            <LogOut className="w-4 h-4 text-slate-600 group-hover:text-rose-600" />
            <span className="hidden lg:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
