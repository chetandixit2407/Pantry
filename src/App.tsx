import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Navbar } from './components/common/Navbar.tsx';
import { PantryBoyView } from './components/pantry/PantryBoyView.tsx';
import { ManagementView } from './components/management/ManagementView.tsx';
import { BubbleLoginPage } from './components/auth/BubbleLoginPage.tsx';
import { ShieldAlert, LogOut, Loader2 } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { currentUser, isDeactivated, switchUser, allUsers, login, logout, isLoading, hasDashboardAccess } = useAuth();
  const [activeView, setActiveView] = useState<'PANTRY' | 'MANAGEMENT'>('PANTRY');

  // Sync default view on account change or permission update
  useEffect(() => {
    if (currentUser) {
      const canPantry = hasDashboardAccess('pantry');
      const canMgmt = hasDashboardAccess('management');
      if (canPantry && !canMgmt) {
        setActiveView('PANTRY');
      } else if (canMgmt && !canPantry) {
        setActiveView('MANAGEMENT');
      } else if (currentUser.role === 'PANTRY_BOY') {
        setActiveView('PANTRY');
      } else {
        setActiveView('MANAGEMENT');
      }
    }
  }, [currentUser?.id, currentUser?.role, currentUser?.permissions]);

  // Loading spinner during initial auth check
  if (isLoading && !currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-20 h-20 rounded-2xl bg-white border border-slate-800 p-2 flex items-center justify-center mb-4 shadow-xl overflow-hidden">
          <img
            src="/assets/wcr_logo.png"
            alt="White Collar Realty Official Logo"
            className="w-full h-full object-contain"
          />
        </div>
        <Loader2 className="w-6 h-6 animate-spin text-amber-400 mb-2" />
        <div className="text-xs text-slate-400 font-mono">Authenticating session...</div>
      </div>
    );
  }

  // If deactivated, render mandatory access revocation screen
  if (isDeactivated && currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 border border-rose-500/30 shadow-2xl text-center">
          <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="text-[11px] font-mono font-bold tracking-wider uppercase text-rose-400 mb-1">
            White Collar Realty · Security Policy
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Account Access Revoked</h2>
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            Employee account <strong className="text-white font-mono">{currentUser.email}</strong> was deactivated by{' '}
            <strong>{currentUser.deactivatedBy || 'Management'}</strong>. Active session privileges and task
            submission permissions have been suspended immediately.
          </p>
          <div className="p-3 bg-slate-950/60 rounded-xl text-xs text-slate-400 font-mono text-left mb-5 space-y-1">
            <div>Status: INACTIVE / ACCESS_REVOKED</div>
            <div>Timestamp: {currentUser.deactivatedAt ? new Date(currentUser.deactivatedAt).toLocaleString() : 'Recent'}</div>
            <div>Audit: Recorded in permanent company database</div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => logout()}
              className="w-full py-2.5 px-4 text-xs font-bold text-rose-300 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out & Return to Login Screen</span>
            </button>

            <div className="pt-2 border-t border-slate-700/60">
              <div className="text-[11px] text-slate-400 mb-2">Or switch to an authorized active account:</div>
              <div className="grid grid-cols-2 gap-2">
                {allUsers
                  .filter((u) => u.status === 'active')
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => switchUser(u.id)}
                      className="p-2 text-xs font-semibold bg-slate-700 hover:bg-slate-600 rounded-lg text-white truncate cursor-pointer"
                    >
                      {u.role === 'KIMMY_MAM' ? 'Kimmi' : u.name} ({u.role === 'PANTRY_BOY' ? 'Pantry' : u.role === 'ADMIN' ? 'Admin' : u.role === 'KIMMY_MAM' ? 'Co-Founder' : 'HR'})
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canPantry = hasDashboardAccess('pantry');
  const canMgmt = hasDashboardAccess('management');
  const effectiveView = activeView === 'PANTRY' && canPantry ? 'PANTRY' : (canMgmt ? 'MANAGEMENT' : 'PANTRY');

  if (currentUser && !canPantry && !canMgmt) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-2xl text-center">
          <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No Dashboard Access Authorized</h2>
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            Account <strong className="text-white font-mono">{currentUser.email}</strong> has not been granted view access to the Pantry or Management dashboards by an Administrator.
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full py-2.5 px-4 text-xs font-bold text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col overflow-x-hidden">
      {/* Authenticated Dashboard View with Smooth Reveal */}
      {currentUser && (
        <motion.div
          key="dashboard-view"
          initial={{ opacity: 0, scale: 0.992 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="min-h-screen bg-slate-50 flex flex-col flex-1"
        >
          {effectiveView === 'PANTRY' ? (
            currentUser.role === 'PANTRY_BOY' ? (
              <main className="flex-1">
                <PantryBoyView />
              </main>
            ) : (
              <>
                <Navbar activeView={effectiveView} setActiveView={setActiveView} />
                <main className="flex-1">
                  <div className="bg-amber-100 border-b border-amber-200 py-1.5 px-4 text-center text-xs text-amber-900 font-semibold flex items-center justify-center gap-2">
                    <span>Management View: Previewing Attendant Dashboard ·</span>
                    <button
                      type="button"
                      onClick={() => setActiveView('MANAGEMENT')}
                      className="underline hover:text-black font-bold cursor-pointer"
                    >
                      Return to Operations Command
                    </button>
                  </div>
                  <PantryBoyView />
                </main>
              </>
            )
          ) : (
            <ManagementView activeView={effectiveView} setActiveView={setActiveView} />
          )}
        </motion.div>
      )}

      {/* Login Screen with Fluid Dissolve Exit */}
      <AnimatePresence>
        {!currentUser && (
          <motion.div
            key="login-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{
              opacity: 0,
              scale: 1.015,
              filter: 'blur(8px)',
              transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
            }}
            className="fixed inset-0 z-30 flex flex-col bg-slate-950 overflow-y-auto"
          >
            <BubbleLoginPage
              allUsers={allUsers}
              onLogin={login}
              isLoading={isLoading}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}
