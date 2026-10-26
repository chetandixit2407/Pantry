import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Navbar } from './components/common/Navbar.tsx';
import { PantryBoyView } from './components/pantry/PantryBoyView.tsx';
import { ManagementView } from './components/management/ManagementView.tsx';
import { ShieldAlert, LogIn, Lock, Users, LogOut, Loader2 } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { currentUser, isDeactivated, switchUser, allUsers, login, logout, isLoading } = useAuth();
  const [activeView, setActiveView] = useState<'PANTRY' | 'MANAGEMENT'>('PANTRY');
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Sync default view on account change
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'PANTRY_BOY') {
        setActiveView('PANTRY');
      } else {
        setActiveView('MANAGEMENT');
      }
    }
  }, [currentUser?.id, currentUser?.role]);

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
              className="w-full py-2.5 px-4 text-xs font-bold text-rose-300 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 rounded-xl transition-colors flex items-center justify-center gap-2"
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
                      className="p-2 text-xs font-semibold bg-slate-700 hover:bg-slate-600 rounded-lg text-white truncate"
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

  // If no user logged in, render corporate login
  if (!currentUser) {
    const handleLoginSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError(null);
      setSubmitting(true);
      try {
        await login(loginEmail, loginPassword);
      } catch (err: any) {
        setLoginError(err.message || 'Login failed');
      } finally {
        setSubmitting(false);
      }
    };

    const handleQuickLogin = async (userEmail: string) => {
      setLoginError(null);
      setSubmitting(true);
      try {
        await login(userEmail);
      } catch (err: any) {
        setLoginError(err.message || 'Login failed');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-24 h-24 rounded-2xl bg-white border border-slate-200/90 p-2 shadow-xs flex items-center justify-center mx-auto mb-3 overflow-hidden">
              <img
                src="/assets/wcr_logo.png"
                alt="White Collar Realty Official Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <h1 className="text-lg font-bold text-slate-900">White Collar Realty</h1>
            <p className="text-xs text-slate-500 mt-1">Smart Pantry Operations & Hospitality Portal</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Company Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="raju.sharma@whitecollarrealty.com"
                className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Enter your company-provided email address.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Optional for pre-approved company staff"
                className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 font-mono"
              />
            </div>

            {loginError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Log In to White Collar Realty</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Pre-Approved Account Switcher for Evaluators */}
          <div className="pt-4 border-t border-slate-100">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center">
              Quick Role Sign-In (Pre-Approved Staff)
            </div>
            <div className="space-y-1.5">
              {allUsers.map((u) => {
                const isUserInactive = u.status === 'inactive';
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleQuickLogin(u.email)}
                    className="w-full p-2 text-left rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={u.avatarUrl}
                        alt={u.name}
                        className="w-6 h-6 rounded-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{u.role === 'KIMMY_MAM' ? 'Kimmi' : u.name}</span>
                          {isUserInactive && (
                            <span className="text-[9px] font-mono text-rose-600 bg-rose-50 px-1 rounded">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">{u.email}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-bold">
                      {u.role === 'PANTRY_BOY'
                        ? 'Pantry Boy'
                        : u.role === 'KIMMY_MAM'
                        ? 'Co-Founder'
                        : u.role === 'ADMIN'
                        ? 'Admin'
                        : 'HR'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {currentUser.role === 'PANTRY_BOY' ? (
        <>
          <Navbar activeView={activeView} setActiveView={setActiveView} />
          <main className="flex-1">
            <PantryBoyView />
          </main>
        </>
      ) : activeView === 'PANTRY' ? (
        <>
          <Navbar activeView={activeView} setActiveView={setActiveView} />
          <main className="flex-1">
            <div className="bg-amber-100 border-b border-amber-200 py-1.5 px-4 text-center text-xs text-amber-900 font-semibold">
              Management Simulation: Previewing Raju Sharma's Mobile Pantry Interface ·{' '}
              <button
                type="button"
                onClick={() => setActiveView('MANAGEMENT')}
                className="underline hover:text-black font-bold ml-1"
              >
                Return to Operations Command
              </button>
            </div>
            <PantryBoyView />
          </main>
        </>
      ) : (
        <ManagementView activeView={activeView} setActiveView={setActiveView} />
      )}
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
