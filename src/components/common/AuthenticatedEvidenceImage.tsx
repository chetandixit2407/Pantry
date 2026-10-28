import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, FileWarning, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import { api, type EvidenceLoadError } from '../../services/api.ts';

export interface AuthenticatedEvidenceImageProps {
  photoUrl: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  compact?: boolean;
  retryKey?: number;
  onStatusChange?: (state: {
    loading: boolean;
    error: string | null;
    statusCode?: number;
  }) => void;
}

export const AuthenticatedEvidenceImage: React.FC<AuthenticatedEvidenceImageProps> = ({
  photoUrl,
  alt,
  className = '',
  imgClassName = 'w-full h-full object-cover',
  compact = false,
  retryKey = 0,
  onStatusChange,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [localRetryCount, setLocalRetryCount] = useState<number>(0);

  const effectiveRetry = retryKey + localRetryCount;

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalRetryCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let currentObjUrl: string | null = null;
    const controller = new AbortController();

    if (!photoUrl || !photoUrl.trim()) {
      setObjectUrl(null);
      setLoading(false);
      const msg = 'No persisted photo reference available.';
      setErrorMessage(msg);
      setErrorStatus(404);
      onStatusChange?.({ loading: false, error: msg, statusCode: 404 });
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setErrorMessage(null);
    setErrorStatus(undefined);
    onStatusChange?.({ loading: true, error: null });

    api
      .fetchEvidenceImageBlob(photoUrl, {
        signal: controller.signal,
        cacheBust: effectiveRetry > 0 ? Date.now() : undefined,
      })
      .then((blob) => {
        if (!active) return;
        currentObjUrl = URL.createObjectURL(blob);
        setObjectUrl(currentObjUrl);
        setLoading(false);
        setErrorMessage(null);
        setErrorStatus(undefined);
        onStatusChange?.({ loading: false, error: null, statusCode: 200 });
      })
      .catch((err: EvidenceLoadError) => {
        if (!active || controller.signal.aborted) return;
        setObjectUrl(null);
        setLoading(false);
        const status = err?.status;
        const msg = err?.message || 'Unable to load persisted evidence photo from server.';
        setErrorStatus(status);
        setErrorMessage(msg);
        onStatusChange?.({ loading: false, error: msg, statusCode: status });
      });

    return () => {
      active = false;
      controller.abort();
      if (currentObjUrl) {
        URL.revokeObjectURL(currentObjUrl);
      }
    };
  }, [photoUrl, effectiveRetry, onStatusChange]);

  const handleDecodeError = useCallback(() => {
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    const msg = 'Failed to decode uploaded image file. Click Retry to reload from storage.';
    setErrorMessage(msg);
    setErrorStatus(502);
    onStatusChange?.({ loading: false, error: msg, statusCode: 502 });
  }, [onStatusChange]);

  if (loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-900/95 text-slate-300 select-none ${className}`}
      >
        <RefreshCw className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} animate-spin text-amber-400`} />
        {!compact && (
          <span className="mt-2 text-xs font-mono text-slate-400">
            Loading persisted evidence from server...
          </span>
        )}
      </div>
    );
  }

  if (errorMessage || !objectUrl) {
    const isSessionExpired = errorStatus === 401;
    const isForbidden = errorStatus === 403;
    const isMissing = errorStatus === 404;

    if (compact) {
      return (
        <div
          className={`flex flex-col items-center justify-center gap-1 p-2 bg-slate-900 text-center select-none ${className}`}
          title={errorMessage || 'Unable to load evidence image'}
        >
          {isSessionExpired ? (
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
          ) : isForbidden ? (
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          ) : isMissing ? (
            <FileWarning className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span className="text-[10px] font-semibold text-slate-200 leading-tight line-clamp-2">
            {isSessionExpired
              ? 'Session Expired'
              : isForbidden
              ? 'Access Denied'
              : isMissing
              ? 'File Missing'
              : 'Load Failed'}
          </span>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9px] font-bold text-amber-300 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            <span>Retry</span>
          </button>
        </div>
      );
    }

    return (
      <div
        className={`flex flex-col items-center justify-center p-6 bg-slate-950 text-center ${className}`}
      >
        <div className="w-11 h-11 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
          {isSessionExpired ? (
            <Lock className="w-5 h-5 text-amber-400" />
          ) : isForbidden ? (
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          ) : isMissing ? (
            <FileWarning className="w-5 h-5 text-rose-400" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          )}
        </div>
        <div className="text-xs sm:text-sm font-bold text-white mb-1">
          {isSessionExpired
            ? 'Session Expired or Unauthenticated'
            : isForbidden
            ? 'Unauthorized Evidence Access'
            : isMissing
            ? 'Evidence File Missing in Storage'
            : 'Unable to Load Evidence Photo'}
        </div>
        <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-4">
          {errorMessage || 'The image could not be loaded from server storage. Please retry.'}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold transition-colors cursor-pointer shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Loading Photo</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <img src={objectUrl} alt={alt} onError={handleDecodeError} className={imgClassName} />
    </div>
  );
};
