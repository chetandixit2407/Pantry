import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { UserAccount, AppNotification } from '../types/index.ts';
import { api, getSessionToken, clearSessionToken } from '../services/api.ts';

interface AuthContextType {
  currentUser: UserAccount | null;
  allUsers: UserAccount[];
  isLoading: boolean;
  isDeactivated: boolean;
  notifications: AppNotification[];
  unreadNotifCount: number;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDeactivated, setIsDeactivated] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

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
          // Unauthenticated state: fetch user list for switcher options, leave currentUser as null
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
          // Invalid or expired token
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
        // Check relevance
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
      } else if (event === 'room:updated' || event === 'task:updated') {
        refreshNotifications();
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

  const login = async (email: string, password?: string) => {
    setIsLoading(true);
    try {
      const { user } = await api.login(email, password);
      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');
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
      await api.logout();
    } catch (e) {
      console.warn('Logout error:', e);
      clearSessionToken();
    } finally {
      setCurrentUser(null);
      setIsDeactivated(false);
      setNotifications([]);
      setIsLoading(false);
    }
  };

  const switchUser = async (userId: string) => {
    setIsLoading(true);
    try {
      const { user } = await api.switchUser(userId);
      setCurrentUser(user);
      setIsDeactivated(user.status === 'inactive');
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
