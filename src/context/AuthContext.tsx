import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { UserAccount, AppNotification, Role, UserPermissions, AttendanceRecord } from '../types/index.ts';
import { api, getSessionToken, clearSessionToken } from '../services/api.ts';

export function getDefaultPermissions(role: Role): UserPermissions {
  if (role === 'ADMIN') {
    return {
      dashboards: { pantry: true, management: true },
      sidebarItems: {
        dashboard: true,
        myTasks: true,
        roomSupport: true,
        pantryRequests: true,
        notifications: true,
        taskHistory: true,
        myProfile: true,
        overview: true,
        tasks: true,
        rooms: true,
        visitors: true,
        reports: true,
        users: true,
        audit: true,
        settings: true,
      },
      actions: {
        tasks: { view: true, create: true, edit: true, delete: true },
        rooms: { view: true, create: true, edit: true, delete: true },
        visitors: { view: true, create: true, edit: true, delete: true },
        users: { view: true, create: true, edit: true, delete: true },
        reports: { view: true, export: true },
      },
    };
  }
  if (role === 'KIMMY_MAM' || role === 'HR') {
    return {
      dashboards: { pantry: true, management: true },
      sidebarItems: {
        dashboard: true,
        myTasks: true,
        roomSupport: true,
        pantryRequests: true,
        notifications: true,
        taskHistory: true,
        myProfile: true,
        overview: true,
        tasks: true,
        rooms: true,
        visitors: true,
        reports: true,
        users: true,
        audit: true,
        settings: true,
      },
      actions: {
        tasks: { view: true, create: true, edit: true, delete: true },
        rooms: { view: true, create: true, edit: true, delete: false },
        visitors: { view: true, create: true, edit: true, delete: true },
        users: { view: true, create: true, edit: true, delete: false },
        reports: { view: true, export: true },
      },
    };
  }
  // Default PANTRY_BOY
  return {
    dashboards: { pantry: true, management: false },
    sidebarItems: {
      dashboard: true,
      myTasks: true,
      roomSupport: true,
      pantryRequests: true,
      notifications: true,
      taskHistory: true,
      myProfile: true,
      overview: false,
      tasks: false,
      rooms: false,
      visitors: false,
      reports: false,
      users: false,
      audit: false,
      settings: false,
    },
    actions: {
      tasks: { view: true, create: false, edit: true, delete: false },
      rooms: { view: true, create: false, edit: false, delete: false },
      visitors: { view: true, create: false, edit: false, delete: false },
      users: { view: false, create: false, edit: false, delete: false },
      reports: { view: false, export: false },
    },
  };
}

interface AuthContextType {
  currentUser: UserAccount | null;
  transitionUser: UserAccount | null;
  allUsers: UserAccount[];
  isLoading: boolean;
  isAuthTransitioning: boolean;
  isDeactivated: boolean;
  notifications: AppNotification[];
  unreadNotifCount: number;
  login: (
    email: string,
    password?: string,
    onSuccess?: (user: UserAccount) => Promise<void> | void
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  hasPermission: (
    module: 'tasks' | 'rooms' | 'visitors' | 'users' | 'reports',
    action: 'view' | 'create' | 'edit' | 'delete' | 'export'
  ) => boolean;
  hasSidebarAccess: (item: keyof UserPermissions['sidebarItems']) => boolean;
  hasDashboardAccess: (dashboard: 'pantry' | 'management') => boolean;
  todayAttendance: AttendanceRecord | null;
  refreshAttendance: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const nextPaint = () =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 16);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const waitMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [transitionUser, setTransitionUser] = useState<UserAccount | null>(null);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthTransitioning, setIsAuthTransitioning] = useState<boolean>(() => Boolean(getSessionToken()));
  const [isDeactivated, setIsDeactivated] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const authSeqRef = useRef(0);

  const refreshAttendance = useCallback(async () => {
    try {
      const data = await api.getTodayAttendance();
      setTodayAttendance(data.todayRecord);
    } catch (err) {
      console.warn('Error fetching attendance:', err);
    }
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const users = await api.getUsers();
      setAllUsers(users);
      if (currentUser) {
        const updated = users.find((u) => u.id === currentUser.id);
        if (updated) {
          if (updated.status === 'inactive') {
            setIsDeactivated(true);
            setCurrentUser(updated);
          } else {
            setIsDeactivated(false);
            setCurrentUser(updated);
          }
        } else {
          // User was removed
          setIsDeactivated(true);
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  }, [currentUser]);

  const refreshNotifications = useCallback(async () => {
    if (!currentUser) return;
    try {
      const notifs = await api.getNotifications();
      setNotifications(notifs);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  }, [currentUser]);

  // Initial load - strict token check; NEVER default to Raju Sharma if unauthenticated
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const token = getSessionToken();

        if (!token) {
          const users = await api.getUsers().catch(() => []);
          if (!mounted) return;
          setAllUsers(users);
          setCurrentUser(null);
          setIsDeactivated(false);
          setNotifications([]);
          setTodayAttendance(null);
          return;
        }

        const [user, users] = await Promise.all([
          api.getCurrentUser(),
          api.getUsers().catch(() => []),
        ]);

        if (!mounted) return;
        setAllUsers(users);

        if (user) {
          setTransitionUser(user);
          setCurrentUser(user);
          setIsDeactivated(user.status === 'inactive');
          const [attRes, notifs] = await Promise.all([
            api.getTodayAttendance().catch(() => null),
            api.getNotifications().catch(() => []),
            waitMs(380),
          ]);
          if (mounted) {
            setTodayAttendance(attRes?.todayRecord || null);
            setNotifications(notifs);
          }
        } else {
          clearSessionToken();
          setCurrentUser(null);
          setTransitionUser(null);
          setIsDeactivated(false);
          setNotifications([]);
          setTodayAttendance(null);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        clearSessionToken();
        if (mounted) {
          setCurrentUser(null);
          setTransitionUser(null);
          setIsDeactivated(false);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          setIsAuthTransitioning(false);
          setTransitionUser(null);
        }
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Real-time synchronization via SSE + polling fallback
  useEffect(() => {
    if (!currentUser) return;

    // SSE real-time listener
    const unsubscribe = api.subscribeRealtime((event, payload) => {
      if (event === 'notification:new' && payload?.notification) {
        const notif = payload.notification;
        // Strict RBAC: targetOnlyPantryBoy notifications are only shown to active PANTRY_BOY
        if (notif.targetOnlyPantryBoy) {
          if (currentUser.role !== 'PANTRY_BOY' || currentUser.status !== 'active') {
            return;
          }
          if (notif.recipientEmail && currentUser.email.toLowerCase() !== notif.recipientEmail.toLowerCase()) {
            return;
          }
        }

        const isRelevant =
          notif.targetOnlyPantryBoy
            ? currentUser.role === 'PANTRY_BOY' && currentUser.status === 'active'
            : !notif.recipientRole && !notif.recipientEmail
            ? true
            : notif.recipientRole === currentUser.role
            ? true
            : notif.recipientEmail === currentUser.email
            ? true
            : (currentUser.role === 'HR' || currentUser.role === 'KIMMY_MAM' || currentUser.role === 'ADMIN') &&
              (notif.recipientRole === 'HR' || notif.recipientRole === 'KIMMY_MAM' || notif.recipientRole === 'ADMIN');

        if (isRelevant) {
          setNotifications((prev) => {
            if (prev.some((n) => n.id === notif.id)) return prev;
            return [notif, ...prev];
          });
        }
      } else if (event === 'user:updated' && payload?.user) {
        const updated = payload.user as UserAccount;
        setAllUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        if (currentUser.id === updated.id) {
          if (updated.status === 'inactive') {
            setIsDeactivated(true);
            setCurrentUser(updated);
          } else {
            setIsDeactivated(false);
            setCurrentUser(updated);
          }
        }
      } else if (event === 'account:revoked' && payload?.userId) {
        if (currentUser.id === payload.userId) {
          setIsDeactivated(true);
          clearSessionToken();
        }
      } else if (event === 'task:deleted') {
        if (payload?.deletedTaskId) {
          setNotifications((prev) => prev.filter((n) => n.taskId !== payload.deletedTaskId));
        }
        refreshNotifications();
      } else if (
        event === 'room:updated' ||
        event === 'task:created' ||
        event === 'task:updated' ||
        event === 'pantry_request:created' ||
        event === 'pantry_request:updated'
      ) {
        refreshNotifications();
      } else if (event === 'attendance:updated' && payload?.attendance) {
        if (currentUser.role !== 'PANTRY_BOY' || payload.attendance.userId === currentUser.id) {
          setTodayAttendance(payload.attendance);
        }
      }
    });

    const timer = setInterval(() => {
      refreshUsers();
      refreshNotifications();
    }, 4000);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [currentUser, refreshUsers, refreshNotifications]);

  const login = async (
    email: string,
    password?: string,
    onSuccess?: (user: UserAccount) => Promise<void> | void
  ) => {
    const seq = ++authSeqRef.current;
    setIsLoading(true);
    try {
      const { user, attendance } = await api.login(email, password);
      if (authSeqRef.current !== seq) return;

      if (onSuccess) {
        await onSuccess(user);
      }
      if (authSeqRef.current !== seq) return;

      // Paint the lightweight GPU transition curtain first before mounting heavy dashboard views
      setTransitionUser(user);
      setIsAuthTransitioning(true);
      await nextPaint();
      if (authSeqRef.current !== seq) return;

      // Clear any previous session state and mount newly authenticated workspace underneath
      setNotifications([]);
      setTodayAttendance(null);
      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');

      const [users, notifs, attData] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getNotifications().catch(() => []),
        attendance ? Promise.resolve({ todayRecord: attendance }) : api.getTodayAttendance().catch(() => null),
        waitMs(580),
      ]);
      if (authSeqRef.current !== seq) return;

      setAllUsers(users);
      setNotifications(notifs);
      setTodayAttendance(attData?.todayRecord || null);
    } finally {
      if (authSeqRef.current === seq) {
        setIsAuthTransitioning(false);
        setTransitionUser(null);
        setIsLoading(false);
      }
    }
  };

  const logout = async () => {
    const seq = ++authSeqRef.current;
    setIsLoading(true);
    try {
      await api.logout();
    } catch (e) {
      console.warn('Logout error:', e);
      clearSessionToken();
    } finally {
      if (authSeqRef.current === seq) {
        setCurrentUser(null);
        setTransitionUser(null);
        setIsDeactivated(false);
        setNotifications([]);
        setTodayAttendance(null);
        setIsAuthTransitioning(false);
        setIsLoading(false);
      }
    }
  };

  const switchUser = async (userId: string) => {
    const seq = ++authSeqRef.current;
    const previewTarget = allUsers.find((u) => u.id === userId) || null;
    setIsLoading(true);
    setTransitionUser(previewTarget);
    setIsAuthTransitioning(true);
    try {
      await nextPaint();
      if (authSeqRef.current !== seq) return;

      // Clear previous user's state immediately so zero stale data carries over
      setNotifications([]);
      setTodayAttendance(null);

      const { user, attendance } = await api.switchUser(userId);
      if (authSeqRef.current !== seq) return;

      setTransitionUser(user);
      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');

      const [users, notifs, attData] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getNotifications().catch(() => []),
        attendance ? Promise.resolve({ todayRecord: attendance }) : api.getTodayAttendance().catch(() => null),
        waitMs(520),
      ]);
      if (authSeqRef.current !== seq) return;

      setAllUsers(users);
      setNotifications(notifs);
      setTodayAttendance(attData?.todayRecord || null);
    } finally {
      if (authSeqRef.current === seq) {
        setIsAuthTransitioning(false);
        setTransitionUser(null);
        setIsLoading(false);
      }
    }
  };

  const markNotificationRead = async (id: string) => {
    await api.markNotificationRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const hasPermission = useCallback(
    (
      module: 'tasks' | 'rooms' | 'visitors' | 'users' | 'reports',
      action: 'view' | 'create' | 'edit' | 'delete' | 'export'
    ): boolean => {
      if (!currentUser) return false;
      // Pantry Boy role must never show or allow task deletion
      if (currentUser.role === 'PANTRY_BOY' && module === 'tasks' && action === 'delete') {
        return false;
      }
      if (currentUser.role === 'ADMIN' || currentUser.isSuperAdmin) return true;
      const perms = currentUser.permissions || getDefaultPermissions(currentUser.role);
      if (action === 'export') {
        return Boolean((perms.actions as any)[module]?.export);
      }
      return Boolean((perms.actions as any)[module]?.[action]);
    },
    [currentUser]
  );

  const hasSidebarAccess = useCallback(
    (item: keyof UserPermissions['sidebarItems']): boolean => {
      if (!currentUser) return false;
      if (currentUser.role === 'ADMIN' || currentUser.isSuperAdmin) return true;
      const perms = currentUser.permissions || getDefaultPermissions(currentUser.role);
      return Boolean(perms.sidebarItems?.[item]);
    },
    [currentUser]
  );

  const hasDashboardAccess = useCallback(
    (dashboard: 'pantry' | 'management'): boolean => {
      if (!currentUser) return false;
      if (currentUser.role === 'ADMIN' || currentUser.isSuperAdmin) return true;
      const perms = currentUser.permissions || getDefaultPermissions(currentUser.role);
      return Boolean(perms.dashboards?.[dashboard]);
    },
    [currentUser]
  );

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        transitionUser,
        allUsers,
        isLoading,
        isAuthTransitioning,
        isDeactivated,
        notifications,
        unreadNotifCount,
        login,
        logout,
        switchUser,
        refreshUsers,
        refreshNotifications,
        markNotificationRead,
        hasPermission,
        hasSidebarAccess,
        hasDashboardAccess,
        todayAttendance,
        refreshAttendance,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
