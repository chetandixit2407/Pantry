import React, { useEffect, useState, useCallback } from 'react';
import {
  Camera,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImageOff,
  MapPin,
  RefreshCw,
  ShieldCheck,
  User,
  X,
  AlertCircle,
} from 'lucide-react';
import type { PhotoEvidence, Task } from '../../types/index.ts';
import { AuthenticatedEvidenceImage } from './AuthenticatedEvidenceImage.tsx';

export interface EvidenceLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: PhotoEvidence[];
  initialIndex?: number;
  title?: string;
  task?: Task | null;
  roomName?: string;
  uploaderName?: string;
  canVerify?: boolean;
  isVerifying?: boolean;
  onVerifyDecision?: (
    taskId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string
  ) => Promise<void> | void;
  onRefreshEvidence?: () => Promise<void> | void;
}

function formatISTDateTime(iso?: string): string {
  if (!iso) return 'Not recorded';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return `${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })} IST`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'Verified Camera Frame';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const EvidenceLightboxModal: React.FC<EvidenceLightboxModalProps> = ({
  isOpen,
  onClose,
  photos,
  initialIndex = 0,
  title,
  task,
  roomName,
  uploaderName,
  canVerify = false,
  isVerifying = false,
  onVerifyDecision,
  onRefreshEvidence,
}) => {
  const [activeIndex, setActiveIndex] = useState<number>(initialIndex);
  const [retryCounter, setRetryCounter] = useState<number>(0);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [showRejectInput, setShowRejectInput] = useState<boolean>(false);
  const [refreshingList, setRefreshingList] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      const clamped =
        photos.length > 0 ? Math.min(Math.max(0, initialIndex), photos.length - 1) : 0;
      setActiveIndex(clamped);
      setShowRejectInput(false);
      setRejectReason('');
    }
  }, [isOpen, initialIndex, photos.length]);

  const handlePrev = useCallback(() => {
    if (photos.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const handleNext = useCallback(() => {
    if (photos.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && photos.length > 1) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' && photos.length > 1) {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, photos.length, handlePrev, handleNext]);

  const handleRefresh = async () => {
    setRetryCounter((prev) => prev + 1);
    if (onRefreshEvidence) {
      setRefreshingList(true);
      try {
        await onRefreshEvidence();
      } finally {
        setRefreshingList(false);
      }
    }
  };

  if (!isOpen) return null;

  const safeIndex =
    photos.length > 0 ? Math.min(Math.max(0, activeIndex), photos.length - 1) : 0;
  const activePhoto: PhotoEvidence | undefined = photos[safeIndex];

  const resolvedTitle =
    title ||
    activePhoto?.taskTitle ||
    task?.title ||
    (roomName || activePhoto?.roomName ? `${roomName || activePhoto?.roomName} — Photo Evidence` : 'Submitted Photo Evidence');

  const resolvedRoom =
    activePhoto?.roomName || roomName || task?.roomAreaName || 'Assigned Area';

  const resolvedUploaderName =
    activePhoto?.userName || uploaderName || task?.assignedToName || '';
  const resolvedUploaderEmail =
    activePhoto?.userEmail || task?.assignedToEmail || 'Authorized Staff';

  const statusBadgeStyle =
    activePhoto?.status === 'VERIFIED'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : activePhoto?.status === 'REJECTED'
      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
      : 'bg-sky-500/20 text-sky-300 border-sky-500/40';

  const showManagementVerifyBar =
    Boolean(canVerify && task && onVerifyDecision) &&
    (task?.status === 'PENDING_VERIFICATION' ||
      task?.status === 'SUBMITTED' ||
      activePhoto?.status === 'UPLOADED');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Uploaded Photo Evidence Viewer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh] my-auto"
      >
        {/* Top Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 text-white border-b border-slate-800 flex items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-amber-400 text-slate-950">
                <Camera className="w-3.5 h-3.5" />
                <span>
                  {photos.length > 0
                    ? `Photo ${safeIndex + 1} of ${photos.length}`
                    : '0 Photos'}
                </span>
              </span>

              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                {photos.length} {photos.length === 1 ? 'Photo' : 'Photos'} Submitted
              </span>

              {activePhoto && (
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${statusBadgeStyle}`}
                >
                  {activePhoto.status === 'VERIFIED'
                    ? 'VERIFIED'
                    : activePhoto.status === 'REJECTED'
                    ? 'REJECTED'
                    : 'UPLOADED · PERSISTED'}
                </span>
              )}
            </div>

            <h3 className="text-sm sm:text-base font-bold text-white mt-1.5 leading-snug truncate">
              {resolvedTitle}
            </h3>

            <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>{resolvedRoom}</span>
              </span>
              <span className="text-slate-600">•</span>
              <span className="inline-flex items-center gap-1 text-slate-300 truncate">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  {resolvedUploaderName
                    ? `${resolvedUploaderName} (${resolvedUploaderEmail})`
                    : resolvedUploaderEmail}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshingList}
              title="Reload photo from server storage"
              aria-label="Reload photo from server storage"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshingList ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close evidence viewer"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 bg-slate-50">
          {photos.length === 0 || !activePhoto ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto">
                <ImageOff className="w-6 h-6 text-slate-400" />
              </div>
              <div className="text-sm font-bold text-slate-900">
                No Uploaded Photo Evidence Available
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                No persisted camera evidence photos were found for this record. Once photos are submitted via Live Camera Capture, they will appear here automatically.
              </p>
              {onRefreshEvidence && (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshingList}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingList ? 'animate-spin' : ''}`} />
                  <span>Check Again</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Full-Size Persisted Photo Stage */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center min-h-[260px] sm:min-h-[380px]">
                <AuthenticatedEvidenceImage
                  key={`${activePhoto.id || activePhoto.photoUrl}-${safeIndex}`}
                  photoUrl={activePhoto.photoUrl}
                  alt={`Uploaded evidence ${safeIndex + 1} of ${photos.length} for ${resolvedTitle}`}
                  retryKey={retryCounter}
                  className="w-full min-h-[260px] sm:min-h-[380px] max-h-[56vh] flex items-center justify-center"
                  imgClassName="w-full max-h-[56vh] object-contain select-none"
                />

                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      aria-label="Previous evidence photo"
                      className="absolute left-2.5 sm:left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-white border border-slate-700 shadow-lg transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      aria-label="Next evidence photo"
                      className="absolute right-2.5 sm:right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-white border border-slate-700 shadow-lg transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>

              {/* Multi-Photo Filmstrip Navigation */}
              {photos.length > 1 && (
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                    <span className="font-semibold text-slate-700">
                      Captured Evidence Gallery ({photos.length} Photos)
                    </span>
                    <span className="font-mono">Use ← / → arrow keys or click thumbnail</span>
                  </div>
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                    {photos.map((ev, idx) => {
                      const isCurrent = idx === safeIndex;
                      return (
                        <button
                          key={ev.id || `${ev.photoUrl}-${idx}`}
                          type="button"
                          onClick={() => setActiveIndex(idx)}
                          aria-label={`Select photo ${idx + 1} of ${photos.length}`}
                          className={`relative shrink-0 w-24 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                            isCurrent
                              ? 'border-amber-500 ring-2 ring-amber-400/40 shadow-sm'
                              : 'border-slate-200 hover:border-slate-400 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <AuthenticatedEvidenceImage
                            photoUrl={ev.photoUrl}
                            alt={`Thumbnail ${idx + 1}`}
                            compact
                            retryKey={retryCounter}
                            className="w-full h-full"
                            imgClassName="w-full h-full object-cover"
                          />
                          <span className="absolute top-1 left-1 bg-slate-950/80 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">
                            #{idx + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Evidence Metadata Grid */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 flex-wrap">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Persisted Evidence Metadata</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    Session:{' '}
                    <strong className="text-slate-800">
                      {activePhoto.metadata?.sessionId
                        ? activePhoto.metadata.sessionId
                        : 'LIVE_CAMERA'}
                    </strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-amber-600" />
                      <span>Captured Date & Time</span>
                    </div>
                    <div className="font-mono font-semibold text-slate-900 mt-1 text-[11px]">
                      {formatISTDateTime(activePhoto.capturedAt || activePhoto.serverTimestamp)}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-indigo-600" />
                      <span>Server Persisted Time</span>
                    </div>
                    <div className="font-mono font-semibold text-slate-900 mt-1 text-[11px]">
                      {formatISTDateTime(activePhoto.serverTimestamp)}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                      <span>Task & Room</span>
                    </div>
                    <div className="font-semibold text-slate-900 mt-1 truncate" title={resolvedRoom}>
                      {resolvedRoom}
                    </div>
                    {(activePhoto.taskTitle || task?.title) && (
                      <div
                        className="text-[11px] text-slate-500 truncate"
                        title={activePhoto.taskTitle || task?.title}
                      >
                        {activePhoto.taskTitle || task?.title}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center gap-1">
                      <User className="w-3 h-3 text-sky-600" />
                      <span>Uploaded By</span>
                    </div>
                    <div className="font-semibold text-slate-900 mt-1 truncate">
                      {resolvedUploaderName || resolvedUploaderEmail}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 truncate">
                      {resolvedUploaderEmail}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-mono">
                  <span>
                    Photo {safeIndex + 1} of {photos.length} ·{' '}
                    {activePhoto.metadata?.resolution || '1280x720'} ·{' '}
                    {formatFileSize(activePhoto.metadata?.fileSizeBytes)}
                  </span>
                  {activePhoto.verifiedBy && (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        Verified by {activePhoto.verifiedBy}
                        {activePhoto.verifiedAt ? ` (${formatISTDateTime(activePhoto.verifiedAt)})` : ''}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer / Optional Management Verification Controls */}
        <div className="px-4 sm:px-6 py-3.5 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          {showManagementVerifyBar && task && onVerifyDecision ? (
            <div className="w-full space-y-2.5">
              {showRejectInput && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 hidden sm:block" />
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for retake request (e.g. Align chairs against table edge)..."
                    className="flex-1 text-xs px-3 py-1.5 bg-white border border-rose-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => setShowRejectInput(false)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isVerifying}
                      onClick={() =>
                        onVerifyDecision(
                          task.id,
                          'REJECT',
                          rejectReason.trim() || 'Chairs or surfaces require closer alignment & retake'
                        )
                      }
                      className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Confirm Reject
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Close Viewer
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  {!showRejectInput && (
                    <button
                      type="button"
                      disabled={isVerifying}
                      onClick={() => setShowRejectInput(true)}
                      className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Reject & Request Retake
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isVerifying}
                    onClick={() => onVerifyDecision(task.id, 'APPROVE')}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Evidence & Mark Completed</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[11px] font-mono text-slate-500">
                {photos.length > 1
                  ? `Showing photo ${safeIndex + 1} of ${photos.length} · Persisted server storage`
                  : 'Persisted server storage · Authenticated access'}
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
