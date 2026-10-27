import React, { useRef, useCallback, useEffect } from 'react';

export type Card3DVariant = 'light' | 'amber' | 'dark';

type Card3DCommonProps = {
  children: React.ReactNode;
  className?: string;
  variant?: Card3DVariant;
  maxTilt?: number;
  liftPx?: number;
};

type Card3DDivProps = Card3DCommonProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, keyof Card3DCommonProps> & {
    as?: 'div';
    disabled?: boolean;
  };

type Card3DButtonProps = Card3DCommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof Card3DCommonProps> & {
    as: 'button';
  };

export type Card3DProps = Card3DDivProps | Card3DButtonProps;

export const Card3D: React.FC<Card3DProps> = (props) => {
  const {
    as = 'div',
    children,
    className = '',
    variant = 'light',
    maxTilt = 3.2,
    liftPx = 3.5,
    disabled,
    ...rest
  } = props as Card3DCommonProps & { disabled?: boolean } & Record<string, unknown>;

  const nodeRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const isDisabled = Boolean(disabled);

  const canUseFinePointerTilt = useCallback((pointerType?: string) => {
    if (isDisabled) return false;
    if (pointerType && pointerType !== 'mouse') return false;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }, [isDisabled]);

  const resetCardTransform = useCallback(() => {
    isPointerDownRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const el = nodeRef.current;
    if (!el) return;
    el.setAttribute('data-tilting', 'false');
    el.style.setProperty('--card-rx', '0deg');
    el.style.setProperty('--card-ry', '0deg');
    el.style.setProperty('--card-lift', '0px');
  }, []);

  const handlePointerDown = useCallback(() => {
    isPointerDownRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    isPointerDownRef.current = false;
  }, []);

  useEffect(() => {
    if (isDisabled) {
      resetCardTransform();
    }
  }, [isDisabled, resetCardTransform]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!canUseFinePointerTilt(e.pointerType)) return;
      // Keep transform stable while pointer button is pressed so inner clickable children never shift mid-click
      if (isPointerDownRef.current || e.buttons > 0) return;
      const el = nodeRef.current;
      if (!el) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const target = nodeRef.current;
        if (!target || isPointerDownRef.current) return;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const relX = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
        const relY = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);

        // Subtle perspective tilt toward pointer with smooth lift
        const rotateY = (relX - 0.5) * 2 * maxTilt;
        const rotateX = (0.5 - relY) * 2 * maxTilt;

        // Scale specular sheen & golden edge glow proportionally for wide/tall container cards
        const maxDim = Math.max(rect.width, rect.height);
        const glowRadius = Math.max(360, Math.round(maxDim * 0.85));
        const edgeRadius = Math.max(300, Math.round(maxDim * 0.78));

        target.setAttribute('data-tilting', 'true');
        target.style.setProperty('--card-rx', `${rotateX.toFixed(2)}deg`);
        target.style.setProperty('--card-ry', `${rotateY.toFixed(2)}deg`);
        target.style.setProperty('--card-lift', `-${liftPx}px`);
        target.style.setProperty('--card-gx', `${(relX * 100).toFixed(1)}%`);
        target.style.setProperty('--card-gy', `${(relY * 100).toFixed(1)}%`);
        target.style.setProperty('--card-glow-r', `${glowRadius}px`);
        target.style.setProperty('--card-edge-r', `${edgeRadius}px`);
        rafRef.current = null;
      });
    },
    [canUseFinePointerTilt, maxTilt, liftPx]
  );

  const variantClass =
    variant === 'amber'
      ? 'wcr-card-3d wcr-card-3d--amber'
      : variant === 'dark'
      ? 'wcr-card-3d wcr-card-3d--dark'
      : 'wcr-card-3d';

  const combinedClassName = `${variantClass} ${className}`.trim();

  if (as === 'button') {
    const {
      onPointerDown: userPointerDown,
      onPointerUp: userPointerUp,
      onPointerMove: userPointerMove,
      onPointerLeave: userPointerLeave,
      onPointerCancel: userPointerCancel,
      onBlur: userBlur,
      type = 'button',
      ...buttonRest
    } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;

    return (
      <button
        ref={(el) => {
          nodeRef.current = el;
        }}
        type={type}
        disabled={isDisabled}
        data-disabled={isDisabled ? 'true' : undefined}
        className={combinedClassName}
        onPointerDown={(e) => {
          handlePointerDown();
          userPointerDown?.(e);
        }}
        onPointerUp={(e) => {
          handlePointerUp();
          userPointerUp?.(e);
        }}
        onPointerMove={(e) => {
          handlePointerMove(e);
          userPointerMove?.(e);
        }}
        onPointerLeave={(e) => {
          resetCardTransform();
          userPointerLeave?.(e);
        }}
        onPointerCancel={(e) => {
          resetCardTransform();
          userPointerCancel?.(e);
        }}
        onBlur={(e) => {
          resetCardTransform();
          userBlur?.(e);
        }}
        {...buttonRest}
      >
        {children}
      </button>
    );
  }

  const {
    onPointerDown: userPointerDown,
    onPointerUp: userPointerUp,
    onPointerMove: userPointerMove,
    onPointerLeave: userPointerLeave,
    onPointerCancel: userPointerCancel,
    ...divRest
  } = rest as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div
      ref={(el) => {
        nodeRef.current = el;
      }}
      data-disabled={isDisabled ? 'true' : undefined}
      className={combinedClassName}
      onPointerDown={(e) => {
        handlePointerDown();
        userPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        handlePointerUp();
        userPointerUp?.(e);
      }}
      onPointerMove={(e) => {
        handlePointerMove(e);
        userPointerMove?.(e);
      }}
      onPointerLeave={(e) => {
        resetCardTransform();
        userPointerLeave?.(e);
      }}
      onPointerCancel={(e) => {
        resetCardTransform();
        userPointerCancel?.(e);
      }}
      {...divRest}
    >
      {children}
    </div>
  );
};
