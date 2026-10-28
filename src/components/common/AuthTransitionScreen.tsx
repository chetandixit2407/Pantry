import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { UserAccount } from '../../types/index.ts';

interface AuthTransitionScreenProps {
  user?: UserAccount | null;
  interactive?: boolean;
  mode?: 'login' | 'logout';
  message?: string;
}

const SMOOTH_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const GOLDEN_PARTICLES = [
  { id: 0, x: '18%', y: '70%', size: 3, duration: 2.8, delay: 0.04 },
  { id: 1, x: '25%', y: '34%', size: 2, duration: 3.1, delay: 0.16 },
  { id: 2, x: '32%', y: '66%', size: 3, duration: 2.7, delay: 0.28 },
  { id: 3, x: '40%', y: '26%', size: 2.5, duration: 3.0, delay: 0.08 },
  { id: 4, x: '47%', y: '76%', size: 2, duration: 2.9, delay: 0.36 },
  { id: 5, x: '54%', y: '24%', size: 3, duration: 2.8, delay: 0.12 },
  { id: 6, x: '61%', y: '72%', size: 3, duration: 3.2, delay: 0.22 },
  { id: 7, x: '68%', y: '30%', size: 2.5, duration: 2.6, delay: 0.32 },
  { id: 8, x: '75%', y: '66%', size: 2.5, duration: 3.0, delay: 0.1 },
  { id: 9, x: '81%', y: '40%', size: 2, duration: 2.9, delay: 0.24 },
];

function getRoleDisplayLabel(user?: UserAccount | null): string {
  if (!user) return 'Corporate Hospitality Portal';
  if (user.role === 'KIMMY_MAM') return user.department || 'Co-Founder';
  if (user.role === 'ADMIN') return user.department || 'System Administrator';
  if (user.role === 'HR') return user.department || 'Human Resources & Facilities';
  if (user.role === 'PANTRY_BOY') return user.department || 'Pantry & Hospitality Attendant';
  return user.department || 'Authorized Staff';
}

export const AuthTransitionScreen: React.FC<AuthTransitionScreenProps> = ({
  user,
  interactive = false,
  mode = 'login',
  message,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: {
          duration: prefersReducedMotion ? 0.16 : 0.3,
          ease: SMOOTH_EASE,
        },
      }}
      exit={{
        opacity: 0,
        scale: prefersReducedMotion ? 1 : 1.02,
        transition: {
          duration: prefersReducedMotion ? 0.18 : 0.44,
          ease: SMOOTH_EASE,
        },
      }}
      style={{
        willChange: 'opacity, transform',
        background: 'radial-gradient(ellipse at 50% 32%, #0d1527 0%, #060b14 64%, #02050a 100%)',
      }}
      className={`fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-hidden select-none text-white ${
        interactive ? '' : 'pointer-events-none'
      }`}
      aria-live="polite"
      aria-busy="true"
    >
      {/* GPU-Composited Warm Golden Radial Blooms (No expensive Gaussian blur filters) */}
      <motion.div
        animate={
          prefersReducedMotion
            ? { opacity: 0.65 }
            : { opacity: [0.55, 0.85, 0.55], scale: [0.95, 1.05, 0.95] }
        }
        transition={{ type: 'tween', duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          willChange: 'transform, opacity',
          background:
            'radial-gradient(circle, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.08) 42%, transparent 72%)',
        }}
        className="absolute w-[380px] sm:w-[560px] h-[380px] sm:h-[560px] rounded-full pointer-events-none"
      />
      <div
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(251, 191, 36, 0.12) 0%, transparent 70%)',
        }}
        className="absolute -top-20 left-1/2 -translate-x-1/2 w-[620px] h-[260px] rounded-full pointer-events-none"
      />

      {/* Subtle Floating Golden Motes (Pure GPU transform & opacity) */}
      {!prefersReducedMotion && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {GOLDEN_PARTICLES.map((p) => (
            <motion.span
              key={p.id}
              style={{
                left: p.x,
                top: p.y,
                width: p.size,
                height: p.size,
                willChange: 'transform, opacity',
              }}
              initial={{ opacity: 0, y: 8, scale: 0.75 }}
              animate={{
                opacity: [0, 0.7, 0],
                y: [8, -26],
                scale: [0.75, 1.1, 0.85],
              }}
              transition={{
                type: 'tween',
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="absolute rounded-full bg-amber-300/90"
            />
          ))}
        </div>
      )}

      {/* Frosted Glassmorphism Centerpiece Card */}
      <motion.div
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: 0.38, ease: SMOOTH_EASE },
        }}
        exit={
          prefersReducedMotion
            ? { opacity: 0 }
            : {
                opacity: 0,
                y: -6,
                scale: 0.985,
                transition: { duration: 0.32, ease: SMOOTH_EASE },
              }
        }
        style={{
          willChange: 'transform, opacity',
          background:
            'linear-gradient(145deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.03) 100%)',
          boxShadow:
            '0 28px 80px -16px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.28)',
        }}
        className="relative z-10 w-full max-w-sm rounded-3xl px-7 py-8 sm:px-9 sm:py-9 text-center backdrop-blur-xl overflow-hidden"
      >
        {/* Top Specular Glass Highlight Line */}
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/65 to-transparent pointer-events-none" />

        {/* Subtle One-Shot Diagonal Specular Sheen */}
        {!prefersReducedMotion && (
          <motion.div
            initial={{ x: '-130%' }}
            animate={{ x: '130%' }}
            transition={{ duration: 0.95, delay: 0.06, ease: SMOOTH_EASE }}
            style={{
              willChange: 'transform',
              background:
                'linear-gradient(105deg, transparent 20%, rgba(255, 255, 255, 0.07) 50%, transparent 80%)',
            }}
            className="absolute inset-0 pointer-events-none"
          />
        )}

        {/* Animated WCR Logo with True Circular Golden Orbital Halo */}
        <div className="relative mx-auto mb-5 w-24 h-24 flex items-center justify-center">
          {/* Static Hairline Orbital Track */}
          <div className="absolute inset-0 rounded-full border border-amber-400/20 pointer-events-none" />

          {/* Smooth Circular Conic Golden Comet Ring */}
          {!prefersReducedMotion && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              style={{
                willChange: 'transform',
                background:
                  'conic-gradient(from 0deg, transparent 0deg, rgba(245, 158, 11, 0.12) 190deg, rgba(251, 191, 36, 0.85) 315deg, rgba(254, 243, 199, 0.95) 348deg, transparent 360deg)',
                WebkitMask:
                  'radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))',
                mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px))',
              }}
              className="absolute inset-0 rounded-full pointer-events-none"
            />
          )}

          {/* Soft Golden Inner Aura (Radial Gradient, Zero Blur Filter) */}
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.55 }
                : { opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.08, 0.92] }
            }
            transition={{ type: 'tween', duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              willChange: 'transform, opacity',
              background:
                'radial-gradient(circle, rgba(251, 191, 36, 0.38) 0%, rgba(245, 158, 11, 0.12) 55%, transparent 75%)',
            }}
            className="absolute inset-1 rounded-full pointer-events-none"
          />

          {/* Official WCR Emblem Pedestal */}
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.42, ease: SMOOTH_EASE }}
            style={{ willChange: 'transform, opacity' }}
            className="relative w-16 h-16 rounded-2xl bg-white p-2.5 flex items-center justify-center shadow-[0_10px_28px_rgba(0,0,0,0.48),0_0_22px_rgba(245,158,11,0.3)] ring-1 ring-amber-300/65 overflow-hidden"
          >
            <img
              src="/assets/wcr_logo.png"
              alt="White Collar Realty Official Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </motion.div>
        </div>

        {/* Brand & Authenticated User Identity */}
        <motion.div
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.05, ease: SMOOTH_EASE }}
        >
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
            {mode === 'logout'
              ? user
                ? `See you again, ${user.name.split(' ')[0]}`
                : 'Signing Out…'
              : user
              ? `Welcome, ${user.name}`
              : 'White Collar Realty'}
          </h2>

          <div className="mt-1 flex items-center justify-center gap-2 text-xs text-amber-300/95 font-medium">
            <span>{getRoleDisplayLabel(user)}</span>
            {user && (
              <>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span className="text-slate-300">
                  {mode === 'logout' ? 'Session Ending' : 'White Collar Realty'}
                </span>
              </>
            )}
          </div>
        </motion.div>

        {/* Continuous Silky Golden Progress Sweep */}
        <div className="mt-6 mx-auto w-44 h-[2.5px] rounded-full bg-white/10 overflow-hidden relative">
          <motion.div
            initial={{ scaleX: mode === 'logout' ? 0.15 : 0.12 }}
            animate={{ scaleX: 1 }}
            transition={{
              duration: prefersReducedMotion ? 0.25 : 0.68,
              ease: SMOOTH_EASE,
            }}
            style={{ willChange: 'transform', transformOrigin: 'left center' }}
            className={`w-full h-full rounded-full ${
              mode === 'logout'
                ? 'bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500'
                : 'bg-gradient-to-r from-amber-500/80 via-amber-300 to-amber-400'
            }`}
          />
          {!prefersReducedMotion && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{
                duration: 0.95,
                repeat: Infinity,
                ease: [0.4, 0, 0.2, 1],
              }}
              style={{ willChange: 'transform' }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent"
            />
          )}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.08, ease: SMOOTH_EASE }}
          className="mt-3 text-[11px] text-slate-400 font-medium tracking-wide"
        >
          {message ||
            (mode === 'logout'
              ? 'Securing workspace & returning to sign in…'
              : user
              ? 'Opening your workspace…'
              : 'Verifying corporate session…')}
        </motion.p>
      </motion.div>
    </motion.div>
  );
};
