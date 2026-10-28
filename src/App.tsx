import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { PantryBoyView } from './components/pantry/PantryBoyView.tsx';
import { ManagementView } from './components/management/ManagementView.tsx';
import { BubbleLoginPage } from './components/auth/BubbleLoginPage.tsx';
import { AuthTransitionScreen } from './components/common/AuthTransitionScreen.tsx';
import { ShieldAlert, LogOut } from 'lucide-react';

const SMOOTH_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const MainLayout: React.FC = () => {
  const {
    currentUser,
    transitionUser,
    transitionMode,
    isDeactivated,
    allUsers,
    login,
    logout,
    isLoading,
    isAuthTransitioning,
    hasDashboardAccess,
  } = useAuth();
  const canPantry = hasDashboardAccess('pantry');
  const canMgmt = hasDashboardAccess('management');
  const showPantryDashboard =
    (canPantry && !canMgmt) || (currentUser?.role === 'PANTRY_BOY' && canPantry);

  return (
    <div className="relative min-h-screen bg-slate-950 flex flex-col overflow-x-clip">
      {/* Authenticated Surface (Dashboard, Access Revoked, or No-Access Notice) */}
      {currentUser && (
        <motion.div
          key={`authenticated-surface-${currentUser.id}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.32, ease: SMOOTH_EASE }}
          className="min-h-screen flex flex-col flex-1"
        >
          {isDeactivated ? (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 flex-1">
              <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 border border-rose-500/30 shadow-2xl text-center">
                <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <div className="text-[11px] font-mono font-bold tracking-wider uppercase text-rose-400 mb-1">
                  White Collar Realty · Security Policy
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Account Access Revoked</h2>
                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  Employee account{' '}
                  <strong className="text-white font-mono">{currentUser.email}</strong> was
                  deactivated by <strong>{currentUser.deactivatedBy || 'Management'}</strong>.
                  Active session privileges and task submission permissions have been suspended
                  immediately.
                </p>
                <div className="p-3 bg-slate-950/60 rounded-xl text-xs text-slate-400 font-mono text-left mb-5 space-y-1">
                  <div>Status: INACTIVE / ACCESS_REVOKED</div>
                  <div>
                    Timestamp:{' '}
                    {currentUser.deactivatedAt
                      ? new Date(currentUser.deactivatedAt).toLocaleString()
                      : 'Recent'}
                  </div>
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
                    <div className="text-[11px] text-slate-400 mb-2">
                      Or switch to an authorized active account:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {allUsers
                        .filter((u) => u.status === 'active')
                        .map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={async () => {
                              await logout();
                              await login(u.email);
                            }}
                            className="p-2 text-xs font-semibold bg-slate-700 hover:bg-slate-600 rounded-lg text-white truncate cursor-pointer"
                          >
                            {u.name} (
                            {u.role === 'PANTRY_BOY'
                              ? 'Pantry'
                              : u.role === 'ADMIN'
                              ? 'Admin'
                              : u.role === 'KIMMY_MAM'
                              ? 'Co-Founder'
                              : 'HR'}
                            )
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : !canPantry && !canMgmt ? (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 flex-1">
              <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-2xl text-center">
                <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">
                  No Dashboard Access Authorized
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed mb-4">
                  Account <strong className="text-white font-mono">{currentUser.email}</strong> has
                  not been granted view access to the Pantry or Management dashboards by an
                  Administrator.
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
          ) : (
            <div className="min-h-screen bg-slate-50 flex flex-col flex-1">
              {showPantryDashboard ? (
                <main className="flex-1">
                  <PantryBoyView key={`pantry-${currentUser.id}`} />
                </main>
              ) : (
                <ManagementView key={`management-${currentUser.id}`} />
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Login Screen with GPU-Composited Cross-Dissolve */}
      <AnimatePresence>
        {!currentUser && !(isAuthTransitioning && !transitionUser) && (
          <motion.div
            key="login-view"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { duration: 0.3, ease: SMOOTH_EASE },
            }}
            exit={{
              opacity: 0,
              transition: { duration: 0.28, ease: SMOOTH_EASE },
            }}
            style={{ willChange: 'opacity' }}
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

      {/* Post-Login & Logout Auth Transition (Direct child of AnimatePresence so exit dissolve always executes) */}
      <AnimatePresence>
        {isAuthTransitioning && (
          <AuthTransitionScreen
            key="wcr-auth-transition"
            user={transitionUser || currentUser}
            mode={transitionMode}
            interactive={true}
          />
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
