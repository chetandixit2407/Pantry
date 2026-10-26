import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { UserAccount, AppNotification, Role, UserPermissions, AttendanceRecord, OfficeLocationConfig } from '../types/index.ts';
import { api, getSessionToken, clearSessionToken } from '../services/api.ts';

// -----------------------------------------------------------------------------
// Privacy-Protected High-Accuracy Location Capturer (Pantry Boy Role Only)
// -----------------------------------------------------------------------------
export async function capturePantryLocation(): Promise<{
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  source: 'GPS' | 'DENIED' | 'TIMEOUT' | 'UNAVAILABLE' | 'NOT_SUPPORTED';
  error?: string;
}> {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    return {
      source: 'NOT_SUPPORTED',
      error: 'Geolocation is not supported by this browser/device environment',
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ? Math.round(position.coords.accuracy) : undefined,
          source: 'GPS',
        });
      },
      (err) => {
        let source: 'DENIED' | 'TIMEOUT' | 'UNAVAILABLE' = 'UNAVAILABLE';
        let error = 'Unable to acquire GPS fix';
        if (err.code === 1 /* PERMISSION_DENIED */) {
          source = 'DENIED';
          error = 'Location permission was denied by device/browser';
        } else if (err.code === 3 /* TIMEOUT */) {
          source = 'TIMEOUT';
          error = 'GPS location request timed out';
        } else if (err.code === 2 /* POSITION_UNAVAILABLE */) {
          source = 'UNAVAILABLE';
          error = 'Location coordinates unavailable from GPS provider';
        }
        resolve({ source, error });
      },
      {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 0,
      }
    );
  });
}

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
      confidentialAccess: {
        hrNotes: true,
        resumes: true,
        governmentIds: true,
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
      confidentialAccess: {
        hrNotes: true,
        resumes: true,
        governmentIds: true,
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
    confidentialAccess: {
      hrNotes: false,
      resumes: false,
      governmentIds: false,
    },
  };
}

interface AuthContextType {
  currentUser: UserAccount | null;
  allUsers: UserAccount[];
  isLoading: boolean;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDeactivated, setIsDeactivated] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);

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

        // Always fetch initial attendance status
        api.getTodayAttendance().then((res) => {
          if (mounted && res?.todayRecord) {
            setTodayAttendance(res.todayRecord);
          }
        }).catch(() => {});

        if (!token) {
          const users = await api.getUsers().catch(() => []);
          if (!mounted) return;
          setAllUsers(users);
          setCurrentUser(null);
          setIsDeactivated(false);
          return;
        }

        const [user, users] = await Promise.all([
          api.getCurrentUser(),
          api.getUsers().catch(() => []),
        ]);

        if (!mounted) return;
        setAllUsers(users);

        if (user) {
          setCurrentUser(user);
          setIsDeactivated(user.status === 'inactive');
        } else {
          clearSessionToken();
          setCurrentUser(null);
          setIsDeactivated(false);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        clearSessionToken();
        if (mounted) {
          setCurrentUser(null);
          setIsDeactivated(false);
        }
      } finally {
        if (mounted) setIsLoading(false);
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
        const isRelevant =
          !notif.recipientRole && !notif.recipientEmail
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
      } else if (event === 'room:updated' || event === 'task:updated' || event === 'pantry_request:created' || event === 'pantry_request:updated') {
        refreshNotifications();
      } else if (event === 'attendance:updated' && payload?.attendance) {
        setTodayAttendance(payload.attendance);
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
    setIsLoading(true);
    try {
      // Privacy Guard: High-accuracy GPS verification is ONLY requested for Pantry Attendants
      let locationPayload: any = undefined;
      const cleanEmail = email.toLowerCase().trim();
      const targetUser = allUsers.find((u) => u.email.toLowerCase() === cleanEmail);
      if (cleanEmail.includes('pantry') || targetUser?.role === 'PANTRY_BOY') {
        locationPayload = await capturePantryLocation();
      }

      const { user, attendance } = await api.login(email, password, locationPayload);

      // Allow UI components to display smooth transition / success micro-interactions
      if (onSuccess) {
        await onSuccess(user);
      }

      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');
      if (attendance) {
        setTodayAttendance(attendance);
      } else {
        refreshAttendance();
      }
      const users = await api.getUsers().catch(() => []);
      setAllUsers(users);
      const notifs = await api.getNotifications().catch(() => []);
      setNotifications(notifs);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      let locationPayload: any = undefined;
      // Privacy Guard: High-accuracy GPS verification is ONLY requested for Pantry Attendants on login & logout
      if (currentUser?.role === 'PANTRY_BOY') {
        try {
          locationPayload = await capturePantryLocation();
        } catch (err) {
          console.warn('Location capture during logout failed:', err);
        }
      }
      await api.logout(locationPayload);
    } catch (e) {
      console.warn('Logout error:', e);
      clearSessionToken();
    } finally {
      setCurrentUser(null);
      setIsDeactivated(false);
      setNotifications([]);
      setTodayAttendance(null);
      setIsLoading(false);
    }
  };

  const switchUser = async (userId: string) => {
    setIsLoading(true);
    try {
      // Privacy Guard: High-accuracy GPS verification is ONLY requested for Pantry Attendants
      let locationPayload: any = undefined;
      const targetUser = allUsers.find((u) => u.id === userId);
      if (targetUser?.role === 'PANTRY_BOY') {
        locationPayload = await capturePantryLocation();
      }

      const { user, attendance } = await api.switchUser(userId, locationPayload);
      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');
      if (attendance) {
        setTodayAttendance(attendance);
      } else {
        refreshAttendance();
      }
      const users = await api.getUsers().catch(() => []);
      setAllUsers(users);
      const notifs = await api.getNotifications().catch(() => []);
      setNotifications(notifs);
    } finally {
      setIsLoading(false);
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
        allUsers,
        isLoading,
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
