import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  ShieldAlert,
  HelpCircle,
  X,
  Check,
  UserCheck,
  ArrowRight,
  Clock,
  Building2,
} from 'lucide-react';
import type { UserAccount } from '../../types/index.ts';

interface BubbleLoginPageProps {
  allUsers: UserAccount[];
  onLogin: (
    email: string,
    password?: string,
    onSuccess?: (user: UserAccount) => Promise<void> | void
  ) => Promise<void>;
  isLoading: boolean;
}

export const BubbleLoginPage: React.FC<BubbleLoginPageProps> = ({
  allUsers,
  onLogin,
  isLoading,
}) => {
  const [activeTab, setActiveTab] = useState<'CREDENTIALS' | 'QUICK_ACCESS'>('CREDENTIALS');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [authSuccess, setAuthSuccess] = useState<boolean>(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<UserAccount | null>(null);
  const [isExiting, setIsExiting] = useState<boolean>(false);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState<boolean>(false);

  // Form submit handler with fluid button micro-interaction
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!email.trim()) {
      setLoginError('Please enter your corporate email address.');
      return;
    }
    setSubmitting(true);
    setAuthSuccess(false);
    setIsExiting(false);
    try {
      await onLogin(email.trim(), password || undefined, async (user) => {
        setAuthenticatedUser(user);
        setAuthSuccess(true);
        // Delightful verified pause so the user perceives the success state
        await new Promise((resolve) => setTimeout(resolve, 520));
        setIsExiting(true);
        // Smooth card lift-and-dissolve into the dashboard
        await new Promise((resolve) => setTimeout(resolve, 240));
      });
    } catch (err: any) {
      setAuthSuccess(false);
      setIsExiting(false);
      setLoginError(err?.message || 'Invalid credentials or inactive account.');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick sign-in handler for pre-approved staff
  const handleQuickLogin = async (userEmail: string) => {
    setLoginError(null);
    setSelectedUserEmail(userEmail);
    setSubmitting(true);
    setAuthSuccess(false);
    setIsExiting(false);
    try {
      await onLogin(userEmail, undefined, async (user) => {
        setAuthenticatedUser(user);
        setAuthSuccess(true);
        await new Promise((resolve) => setTimeout(resolve, 520));
        setIsExiting(true);
        await new Promise((resolve) => setTimeout(resolve, 240));
      });
    } catch (err: any) {
      setAuthSuccess(false);
      setIsExiting(false);
      setLoginError(err?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
      setSelectedUserEmail(null);
    }
  };

  // Pre-fill email when selecting from quick role
  const handleSelectRole = (targetEmail: string) => {
    setEmail(targetEmail);
    setPassword('wcr2026');
    setActiveTab('CREDENTIALS');
  };

  return (
    <div
      className="relative min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #0d1527 0%, #060b14 65%, #02050a 100%)',
      }}
    >
      {/* Ambient background light gradients (no floating bubble objects) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Soft amber glow center-left */}
        <div
          className="absolute -top-32 -left-32 w-80 sm:w-[480px] h-80 sm:h-[480px] rounded-full blur-[120px] opacity-25"
          style={{
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(217, 119, 6, 0.15) 50%, transparent 80%)',
          }}
        />

        {/* Deep sapphire / cyan glow center-right */}
        <div
          className="absolute -bottom-32 -right-32 w-80 sm:w-[520px] h-80 sm:h-[520px] rounded-full blur-[130px] opacity-20"
          style={{
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.5) 0%, rgba(30, 64, 175, 0.2) 50%, transparent 80%)',
          }}
        />

        {/* Warm center highlight */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[380px] rounded-full blur-[140px] opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, #1e293b 60%, transparent 90%)' }}
        />
      </div>

      {/* Main Compact Glassmorphic Login Card (Optimized viewport fit) */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={
          isExiting
            ? { opacity: 0, y: -12, scale: 0.98, filter: 'blur(6px)' }
            : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
        }
        transition={{ duration: isExiting ? 0.32 : 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="interactive-card relative z-30 w-full max-w-[430px] my-auto"
      >
        {/* Ambient Card Backing Blur & Specular Ring */}
        <div
          className="relative rounded-2xl sm:rounded-3xl p-4 sm:p-5 sm:py-5 backdrop-blur-2xl transition-all duration-300"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0.04) 100%)',
            boxShadow: `
              0 25px 70px -15px rgba(0, 0, 0, 0.65),
              0 0 0 1px rgba(255, 255, 255, 0.16),
              inset 0 1px 1px 0 rgba(255, 255, 255, 0.4),
              inset 0 -1px 1px 0 rgba(0, 0, 0, 0.25)
            `,
          }}
        >
          {/* Header Brand Lockup */}
          <div className="flex flex-col items-center text-center mb-3">
            {/* Logo Emblem */}
            <div
              className="relative w-12 h-12 sm:w-13 sm:h-13 rounded-xl p-1.5 mb-2 flex items-center justify-center overflow-hidden shadow-md"
              style={{
                background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 60%, rgba(245,158,11,0.2) 100%)',
                boxShadow: `
                  0 8px 20px -3px rgba(0, 0, 0, 0.4),
                  0 0 16px rgba(245, 158, 11, 0.25),
                  inset 0 1px 1px rgba(255, 255, 255, 1),
                  0 0 0 1px rgba(255, 255, 255, 0.5)
                `,
              }}
            >
              <img
                src="/assets/wcr_logo.png"
                alt="White Collar Realty Official Logo"
                className="w-full h-full object-contain drop-shadow-xs"
              />
            </div>

            {/* Typography */}
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-tight">
              White Collar Realty
            </h1>
            <p className="text-[11px] text-slate-300/80 mt-0.5 font-medium">
              Smart Pantry Operations & Hospitality Portal
            </p>
          </div>

          {/* Mode Segmented Tabs */}
          <div className="flex items-center p-0.5 mb-3 rounded-lg bg-slate-950/40 border border-white/10 backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setActiveTab('CREDENTIALS');
                setLoginError(null);
              }}
              className={`flex-1 py-1.5 px-2.5 text-xs font-semibold rounded-md transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'CREDENTIALS'
                  ? 'bg-white/15 text-white shadow-xs border border-white/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Direct Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('QUICK_ACCESS');
                setLoginError(null);
              }}
              className={`flex-1 py-1.5 px-2.5 text-xs font-semibold rounded-md transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'QUICK_ACCESS'
                  ? 'bg-amber-500/20 text-amber-300 shadow-xs border border-amber-400/30'
                  : 'text-slate-400 hover:text-amber-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Staff Quick-Access</span>
            </button>
          </div>

          {/* Error Banner */}
          <AnimatePresence>
            {loginError && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -4 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -4 }}
                className="mb-2.5 overflow-hidden"
              >
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs rounded-lg flex items-center gap-2 backdrop-blur-md">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                  <span className="leading-snug">{loginError}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tab 1: Direct Corporate Credentials Form */}
          {activeTab === 'CREDENTIALS' ? (
            <form onSubmit={handleSubmit} className="space-y-2.5">
              {/* Email Input */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-200 mb-1">
                  Corporate Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@whitecollarrealty.com"
                    autoComplete="email"
                    className="w-full text-xs font-mono pl-9 pr-3 py-2 rounded-lg bg-slate-900/60 border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1.5 focus:ring-amber-400/50 focus:border-amber-400/60 transition-all backdrop-blur-md"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-slate-200">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSupportModal(true)}
                    className="text-[10px] text-amber-300 hover:text-amber-200 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle className="w-2.5 h-2.5" />
                    <span>Need access?</span>
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password (optional for staff)"
                    autoComplete="current-password"
                    className="w-full text-xs font-mono pl-9 pr-9 py-2 rounded-lg bg-slate-900/60 border border-white/15 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1.5 focus:ring-amber-400/50 focus:border-amber-400/60 transition-all backdrop-blur-md"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Remember Me Toggle */}
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                      rememberMe
                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                        : 'border-white/30 bg-slate-900/60'
                    }`}
                  >
                    {rememberMe && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span>Remember session</span>
                </label>

                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-amber-400" />
                  <span>9:00 AM – 8:00 PM</span>
                </div>
              </div>

              {/* Submit Button with Ultra-Smooth Animation & Subtle Loading Effect */}
              <motion.button
                type="submit"
                disabled={submitting || isLoading || authSuccess}
                whileHover={!submitting && !authSuccess ? { scale: 1.01 } : {}}
                whileTap={!submitting && !authSuccess ? { scale: 0.985 } : {}}
                animate={
                  loginError
                    ? { x: [-4, 4, -3, 3, -1, 1, 0] }
                    : authSuccess
                    ? { scale: [1, 1.02, 1] }
                    : {}
                }
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="relative group w-full h-11 rounded-xl font-bold text-xs overflow-hidden transition-all duration-300 disabled:opacity-95 cursor-pointer shadow-md mt-1 flex items-center justify-center select-none"
                style={{
                  background: authSuccess
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : submitting
                    ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                    : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
                  color: authSuccess ? '#ffffff' : '#0f172a',
                  boxShadow: authSuccess
                    ? '0 6px 22px -2px rgba(16, 185, 129, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.4)'
                    : submitting
                    ? '0 6px 20px -2px rgba(245, 158, 11, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.4)'
                    : '0 4px 14px -2px rgba(245, 158, 11, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.4)',
                }}
              >
                {/* Subtle glass shimmer sweep on hover */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                  }}
                />

                {/* Subtle luminous bottom progress sweep while authenticating */}
                {submitting && !authSuccess && (
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ duration: 1.15, repeat: Infinity, ease: [0.4, 0, 0.2, 1] }}
                    className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-slate-950/40 pointer-events-none"
                  />
                )}

                <AnimatePresence mode="popLayout" initial={false}>
                  {authSuccess ? (
                    <motion.div
                      key="btn-success"
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="relative flex items-center justify-center gap-2 text-white font-bold tracking-wide"
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -25 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                      >
                        <Check className="w-4 h-4 stroke-[3] text-white" />
                      </motion.div>
                      <span>
                        Verified · Welcome
                        {authenticatedUser?.name
                          ? `, ${authenticatedUser.name.split(' ')[0]}`
                          : ''}
                        !
                      </span>
                    </motion.div>
                  ) : submitting ? (
                    <motion.div
                      key="btn-loading"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="relative flex items-center justify-center gap-2.5 text-slate-950 font-bold"
                    >
                      <div className="relative w-4 h-4 flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full border-2 border-slate-950/20" />
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                          className="absolute inset-0 w-4 h-4 rounded-full border-2 border-transparent border-t-slate-950"
                        />
                      </div>
                      <span className="tracking-wide">Authenticating Session...</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="btn-idle"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="relative flex items-center justify-center gap-2 text-slate-950 font-bold"
                    >
                      <LogIn className="w-3.5 h-3.5 text-slate-950" />
                      <span>Log In to White Collar Realty</span>
                      <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </form>
          ) : (
            /* Tab 2: Pre-Approved Staff 1-Click Access */
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-300 leading-normal mb-1.5">
                Select an authorized company profile for immediate 1-click login:
              </p>

              <div className="space-y-1.5">
                {allUsers.map((u) => {
                  const isDeactivated = u.status === 'inactive';
                  const isBeingLoggedIn = submitting && selectedUserEmail === u.email;

                  return (
                    <motion.div
                      key={u.id}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className={`group relative flex items-center justify-between p-2 rounded-lg border transition-all duration-300 cursor-pointer backdrop-blur-md ${
                        isBeingLoggedIn
                          ? authSuccess
                            ? 'bg-emerald-500/20 border-emerald-400/50 shadow-md shadow-emerald-500/20 text-emerald-200'
                            : 'bg-amber-500/20 border-amber-400/50 shadow-xs'
                          : 'border-white/10 bg-slate-900/50 hover:bg-white/[0.08] hover:border-amber-400/40'
                      }`}
                      onClick={() => handleQuickLogin(u.email)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Avatar */}
                        <div className="relative w-7 h-7 rounded-full overflow-hidden border border-white/20 bg-slate-800 shrink-0 flex items-center justify-center">
                          <img
                            src={u.avatarUrl}
                            alt={u.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>

                        {/* Name & Role */}
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-white flex items-center gap-1 truncate">
                            <span>{u.role === 'KIMMY_MAM' ? 'Kimmi' : u.name}</span>
                            {isDeactivated && (
                              <span className="text-[8px] font-mono text-rose-400 bg-rose-500/20 px-1 py-0.2 rounded">
                                Revoked
                              </span>
                            )}
                          </div>
                          <div className="text-[9.5px] text-slate-400 font-mono truncate">
                            {u.email}
                          </div>
                        </div>
                      </div>

                      {/* Right Role Tag & Action */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                            u.role === 'PANTRY_BOY'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : u.role === 'ADMIN'
                              ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                              : u.role === 'KIMMY_MAM'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          }`}
                        >
                          {u.role === 'PANTRY_BOY'
                            ? 'Pantry'
                            : u.role === 'KIMMY_MAM'
                            ? 'Co-Founder'
                            : u.role === 'ADMIN'
                            ? 'Admin'
                            : 'HR'}
                        </span>

                        <button
                          type="button"
                          disabled={submitting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickLogin(u.email);
                          }}
                          className={`p-1.5 text-xs rounded transition-all duration-300 cursor-pointer ${
                            isBeingLoggedIn && authSuccess
                              ? 'text-emerald-300 bg-emerald-500/30 border border-emerald-400/40 shadow-xs'
                              : 'text-amber-300 hover:text-white bg-amber-500/15 hover:bg-amber-500/30'
                          }`}
                          title={`Log in as ${u.name}`}
                        >
                          {isBeingLoggedIn ? (
                            authSuccess ? (
                              <motion.div
                                initial={{ scale: 0, rotate: -20 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                              >
                                <Check className="w-3.5 h-3.5 text-emerald-300 stroke-[3]" />
                              </motion.div>
                            ) : (
                              <div className="w-3.5 h-3.5 relative flex items-center justify-center">
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                                  className="w-3.5 h-3.5 rounded-full border-1.5 border-amber-300/30 border-t-amber-300"
                                />
                              </div>
                            )
                          ) : (
                            <ArrowRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => handleSelectRole('raju.sharma@whitecollarrealty.com')}
                  className="text-[10px] text-slate-400 hover:text-amber-300 transition-colors underline cursor-pointer"
                >
                  Or pre-fill form with default credentials
                </button>
              </div>
            </div>
          )}

          {/* Quick Staff Pill Bar (Compact 2x2 Grid) */}
          {activeTab === 'CREDENTIALS' && (
            <div className="mt-3 pt-2.5 border-t border-white/10">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 flex items-center justify-between">
                <span>Quick Role Sign-In</span>
                <span className="text-[9px] text-amber-400/90 font-mono">1-Click</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {allUsers.slice(0, 4).map((u) => {
                  const isBeingLoggedIn = submitting && selectedUserEmail === u.email;
                  return (
                    <button
                      key={`quick-pill-${u.id}`}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleQuickLogin(u.email)}
                      className={`p-1.5 rounded-lg border text-left transition-all duration-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-85 ${
                        isBeingLoggedIn
                          ? authSuccess
                            ? 'bg-emerald-500/25 border-emerald-400/50 shadow-xs text-emerald-200'
                            : 'bg-amber-500/20 border-amber-400/50 shadow-xs'
                          : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/10'
                      }`}
                    >
                      <div className="w-4 h-4 rounded-full overflow-hidden bg-slate-800 shrink-0 flex items-center justify-center">
                        {isBeingLoggedIn ? (
                          authSuccess ? (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                            >
                              <Check className="w-2.5 h-2.5 text-emerald-300 stroke-[3]" />
                            </motion.div>
                          ) : (
                            <div className="w-2.5 h-2.5 relative flex items-center justify-center">
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                                className="w-2.5 h-2.5 rounded-full border border-amber-300/30 border-t-amber-300"
                              />
                            </div>
                          )
                        ) : (
                          <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="truncate">
                        <div className="text-[10px] font-medium text-white truncate leading-tight">
                          {u.role === 'KIMMY_MAM' ? 'Kimmi' : u.name}
                        </div>
                        <div className="text-[8.5px] text-slate-400 font-mono truncate">
                          {u.role === 'PANTRY_BOY'
                            ? 'Pantry'
                            : u.role === 'KIMMY_MAM'
                            ? 'Co-Founder'
                            : u.role === 'ADMIN'
                            ? 'Admin'
                            : 'HR'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom Trust & Corporate Footer */}
          <div className="mt-2.5 text-center flex items-center justify-center gap-2 text-[10px] text-slate-400 font-medium">
            <span className="flex items-center gap-1">
              <Building2 className="w-2.5 h-2.5 text-slate-400" />
              <span>Iris Broadway, Gurugram</span>
            </span>
            <span>·</span>
            <span className="text-slate-400">Ver 2.4</span>
          </div>
        </div>
      </motion.div>

      {/* Corporate Support / Credentials Modal */}
      <AnimatePresence>
        {showSupportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md rounded-2xl p-5 bg-slate-900 border border-white/20 shadow-2xl text-white"
            >
              <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Building2 className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white">White Collar Realty Support</h3>
                    <p className="text-[9.5px] text-slate-400">Operations & Credentials Information</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs text-slate-300">
                <p className="text-[11px]">
                  Authorized company staff have pre-provisioned system accounts:
                </p>

                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/10 space-y-1.5 font-mono text-[10px]">
                  <div className="flex justify-between items-center text-amber-300">
                    <span>Raju Sharma (Pantry)</span>
                    <span className="bg-amber-400/10 px-1 py-0.5 rounded">raju.sharma@...</span>
                  </div>
                  <div className="flex justify-between items-center text-blue-300">
                    <span>Priya Sen (HR)</span>
                    <span className="bg-blue-400/10 px-1 py-0.5 rounded">priya.sen@...</span>
                  </div>
                  <div className="flex justify-between items-center text-rose-300">
                    <span>Kimmi (Co-Founder)</span>
                    <span className="bg-rose-400/10 px-1 py-0.5 rounded">kimmy.mam@...</span>
                  </div>
                  <div className="flex justify-between items-center text-purple-300">
                    <span>Operations Admin</span>
                    <span className="bg-purple-400/10 px-1 py-0.5 rounded">admin.director@...</span>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 leading-relaxed">
                  * Note: Passwords are pre-verified. You can use the{' '}
                  <strong className="text-amber-300">Staff Quick-Access</strong> tab to switch personas seamlessly.
                </div>
              </div>

              <div className="mt-4 pt-2.5 border-t border-white/10 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors cursor-pointer"
                >
                  Understood
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
