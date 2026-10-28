import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../../context/AuthContext.tsx';
import { Bell, Check, LogOut, ChevronDown, Building2, Coffee, Shield } from 'lucide-react';

interface NavbarProps {
  activeView: 'PANTRY' | 'MANAGEMENT';
  setActiveView: (view: 'PANTRY' | 'MANAGEMENT') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, setActiveView }) => {
  const { currentUser, allUsers, switchUser, logout, isLoggingOut: isGlobalLoggingOut, isAuthTransitioning, notifications, unreadNotifCount, markNotificationRead, hasDashboardAccess, todayAttendance } = useAuth();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [localLoggingOut, setLocalLoggingOut] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const isLoggingOut = localLoggingOut || isGlobalLoggingOut || isAuthTransitioning;

  const isManagement =
    currentUser?.role === 'HR' ||
    currentUser?.role === 'KIMMY_MAM' ||
    currentUser?.role === 'ADMIN';

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setLocalLoggingOut(true);
    setShowRoleMenu(false);
    setShowNotifMenu(false);
    try {
      await logout();
    } finally {
      setLocalLoggingOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4 h-16">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            className="w-10 h-10 rounded-xl bg-white border border-slate-200/90 shadow-xs p-1 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer"
          >
            <img
              src="/assets/wcr_logo.png"
              alt="White Collar Realty Official Logo"
              className="w-full h-full object-contain"
            />
          </motion.div>
          <div>
            <div className="font-bold text-slate-900 tracking-tight text-base leading-tight whitespace-nowrap">
              White Collar Realty
            </div>
            <div className="text-[11px] text-slate-500 font-medium">SmartPantry & Hospitality OS</div>
          </div>
        </div>

        {/* Zone 2: Navigation Links for Management / Admin (Apple-Style Floating Pill Navbar) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {hasDashboardAccess('management') && hasDashboardAccess('pantry') && (
            <div
              className="relative flex items-center p-1 bg-slate-900/90 border border-slate-800 shadow-md backdrop-blur-xl rounded-full"
              onMouseLeave={() => setHoveredTab(null)}
            >
              {[
                { id: 'PANTRY' as const, label: 'Pantry Attendant View', icon: Coffee },
                { id: 'MANAGEMENT' as const, label: 'Operations Command', icon: Shield },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeView === tab.id;
                const isHovered = hoveredTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveView(tab.id)}
                    onMouseEnter={() => setHoveredTab(tab.id)}
                    className={`relative z-10 px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center gap-1.5 select-none ${
                      isActive
                        ? 'text-slate-950 font-bold'
                        : isHovered
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {/* Active Golden Capsule (Apple Style) */}
                    {isActive && (
                      <motion.div
                        layoutId="navbarActiveTabPill"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        className="absolute inset-0 bg-gradient-to-r from-amber-400 via-amber-400 to-amber-500 rounded-full shadow-md shadow-amber-500/25 z-0"
                        style={{
                          boxShadow: '0 2px 10px rgba(245, 158, 11, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
                        }}
                      />
                    )}

                    {/* Gliding Hover Pill (Apple Style) */}
                    {!isActive && isHovered && (
                      <motion.div
                        layoutId="navbarHoverTabPill"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        className="absolute inset-0 bg-white/10 border border-white/15 rounded-full backdrop-blur-md z-0"
                      />
                    )}

                    <motion.div
                      className="relative z-10 flex items-center gap-1.5"
                      whileHover={{ y: -1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    >
                      <Icon className={`w-3.5 h-3.5 transition-colors duration-200 ${
                        isActive ? 'text-slate-950' : isHovered ? 'text-amber-300' : 'text-slate-400'
                      }`} />
                      <span>{tab.label}</span>
                    </motion.div>
                  </button>
                );
              })}
            </div>
          )}

          <div
            className="text-xs text-slate-500 flex items-center gap-1.5 px-3 py-1.5 bg-slate-100/80 rounded-full border border-slate-200/60 max-w-xs xl:max-w-md"
            title="6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India"
          >
            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">
              White Collar Realty HQ ·{' '}
              {todayAttendance?.loginTimeIST
                ? `Attendant In: ${todayAttendance.loginTimeIST}`
                : 'M3M Urbana Business Park, Sector 67, Gurugram'}
            </span>
          </div>
        </nav>

        {/* Zone 3: Notification Bell, Role Switcher & Direct Logout */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Notifications Dropdown */}
          <div className="relative">
            <motion.button
              whileHover={{ y: -1, scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => {
                setShowNotifMenu(!showNotifMenu);
                setShowRoleMenu(false);
              }}
              className="relative p-2 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-amber-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums shadow-xs">
                  {unreadNotifCount}
                </span>
              )}
            </motion.button>

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
            <motion.button
              whileHover={{ y: -1, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => {
                setShowRoleMenu(!showRoleMenu);
                setShowNotifMenu(false);
              }}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
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
                    ? 'Co-Founder'
                    : currentUser?.role === 'ADMIN'
                    ? 'System Admin'
                    : 'HR Facilities'}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </motion.button>

            {showRoleMenu && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Current Account
                  </div>
                  <div className="text-xs font-bold text-slate-900 mt-1">
                    {currentUser?.name} ({currentUser?.role === 'KIMMY_MAM' ? 'Co-Founder' : currentUser?.role})
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
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
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
                              {user.role === 'KIMMY_MAM' ? 'Co-Founder' : user.role} · {user.email}
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
          <motion.button
            whileHover={{ y: -1, scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title="Log Out of White Collar Realty"
            className="p-2 sm:px-3 sm:py-1.5 rounded-full text-slate-500 hover:text-rose-600 hover:bg-rose-50/80 border border-slate-200 transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-2xs"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-600 group-hover:text-rose-600" />
            <span className="hidden lg:inline">Sign Out</span>
          </motion.button>
        </div>
      </div>
    </header>
  );
};
