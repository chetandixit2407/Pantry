import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Camera,
  RefreshCw,
  Upload,
  X,
  CheckCircle,
  Video,
  AlertCircle,
  FlipHorizontal,
  Trash2,
  ShieldCheck,
  Clock,
  Layers,
  Plus,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '../../services/api.ts';
import type { Task, PhotoEvidence, CaptureSessionResponse } from '../../types/index.ts';
import {
  type CapturedPhotoItem,
  DEFAULT_MAX_PHOTOS_PER_SESSION,
  formatPhotoBytes,
  validateCapturedPhotoDataUrl,
  validatePhotoBatchForSubmission,
  computeBatchSubmissionKey,
  loadCaptureSessionDraft,
  saveCaptureSessionDraft,
  clearCaptureSessionDraft,
} from '../../utils/photoValidation.ts';

interface CameraCaptureModalProps {
  taskId: string;
  taskTitle: string;
  roomName: string;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
  onPhotoUploaded: (task: Task, photoEvidence: PhotoEvidence, photoEvidences?: PhotoEvidence[]) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  taskId,
  taskTitle,
  roomName,
  userEmail,
  isOpen,
  onClose,
  onPhotoUploaded,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const submittingRef = useRef<boolean>(false);

  // Authoritative capture session state from server
  const [session, setSession] = useState<CaptureSessionResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(false);

  // Live stream state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Multi-photo session state
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhotoItem[]>([]);
  const [previewingPhotoIndex, setPreviewingPhotoIndex] = useState<number | null>(null);
  const [retakingPhotoIndex, setRetakingPhotoIndex] = useState<number | null>(null);
  const [maxPhotos, setMaxPhotos] = useState<number>(DEFAULT_MAX_PHOTOS_PER_SESSION);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  // Inline notices & accidental-loss confirmation states (zero window.alert / window.confirm)
  const [captureNotice, setCaptureNotice] = useState<{ type: 'info' | 'warning' | 'error'; message: string } | null>(
    null
  );
  const [confirmCloseOpen, setConfirmCloseOpen] = useState<boolean>(false);
  const [confirmDiscardAll, setConfirmDiscardAll] = useState<boolean>(false);

  // Upload progress & retry state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{
    loadedBytes: number;
    totalBytes: number;
    percent: number;
  }>({
    loadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedPhotoIndex, setFailedPhotoIndex] = useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);

  // Continuous batch validation summary
  const batchValidation = useMemo(
    () => validatePhotoBatchForSubmission(capturedPhotos, maxPhotos),
    [capturedPhotos, maxPhotos]
  );

  // Stop all camera media tracks cleanly
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setVideoReady(false);
  }, []);

  // Request or refresh authoritative server capture session
  const acquireServerSession = useCallback(
    async (existingSession?: CaptureSessionResponse | null): Promise<CaptureSessionResponse | null> => {
      if (existingSession?.sessionId && !existingSession.sessionId.endsWith('_local')) {
        return existingSession;
      }
      setSessionLoading(true);
      try {
        const sess = await api.initCaptureSession(taskId);
        setSession(sess);
        if (sess.maxPhotos) {
          setMaxPhotos(sess.maxPhotos);
        }
        return sess;
      } catch (err: any) {
        console.warn('Capture session initialization deferred until submission:', err);
        return null;
      } finally {
        setSessionLoading(false);
      }
    },
    [taskId]
  );

  // Start real WebRTC camera stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setVideoReady(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Your device browser does not support live camera access (getUserMedia). Please open this application in Chrome, Edge, or Safari over HTTPS or localhost.'
      );
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (firstErr: any) {
        if (firstErr.name === 'OverconstrainedError' || firstErr.name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.autoplay = true;
        videoRef.current.playsInline = true;
        videoRef.current.muted = true;

        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('Video play() call notice:', playErr);
        }

        setIsStreaming(true);

        if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          setVideoReady(true);
        }
      }
    } catch (err: any) {
      console.error('Camera access failed:', err);
      let errorMsg = 'Could not access device camera. Please check camera permissions in your browser.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg =
          'Camera access was denied. Please allow camera permissions in your browser address bar and click "Restart Camera". Note: File and gallery uploads are strictly disabled for verification integrity.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg =
          'No camera hardware detected on this device. Please connect a webcam or access this app on a mobile device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg =
          'Your camera is currently in use by another tab or app. Please close other camera applications and click "Restart Camera".';
      } else if (err.name === 'SecurityError') {
        errorMsg = 'Camera access blocked due to security restrictions. Ensure site runs over HTTPS.';
      } else if (err.message) {
        errorMsg = err.message;
      }

      setCameraError(errorMsg);
      setIsStreaming(false);
      setVideoReady(false);
    }
  }, [facingMode, stopCamera]);

  const handleVideoMetadataLoaded = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoReady(true);
    }
  };

  // Session & draft lifecycle — isolated from camera facingMode flips so photos are NEVER wiped
  useEffect(() => {
    if (!isOpen) {
      submittingRef.current = false;
      setConfirmCloseOpen(false);
      setConfirmDiscardAll(false);
      return;
    }

    setPreviewingPhotoIndex(null);
    setRetakingPhotoIndex(null);
    setUploadSuccess(false);
    setUploadError(null);
    setFailedPhotoIndex(null);
    setConfirmCloseOpen(false);
    setConfirmDiscardAll(false);
    setCaptureNotice(null);

    const savedDraft = loadCaptureSessionDraft(userEmail, taskId);
    if (savedDraft && savedDraft.photos.length > 0) {
      setCapturedPhotos(savedDraft.photos);
      if (savedDraft.session && !savedDraft.session.sessionId.endsWith('_local')) {
        setSession(savedDraft.session);
        if (savedDraft.session.maxPhotos) {
          setMaxPhotos(savedDraft.session.maxPhotos);
        }
      } else {
        setSession(null);
        void acquireServerSession(null);
      }
      setCaptureNotice({
        type: 'info',
        message: `Restored ${savedDraft.photos.length} unsubmitted photo${
          savedDraft.photos.length === 1 ? '' : 's'
        } from your active session. Review, add more, or submit whenever ready.`,
      });
    } else {
      setCapturedPhotos([]);
      setSession(null);
      void acquireServerSession(null);
    }
  }, [isOpen, taskId, userEmail, acquireServerSession]);

  // Camera stream lifecycle — starts/flips camera without clearing capturedPhotos
  useEffect(() => {
    if (isOpen) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // Persist unsubmitted photos in sessionStorage until submitted or explicitly discarded
  useEffect(() => {
    if (!isOpen || uploadSuccess) return;
    saveCaptureSessionDraft(userEmail, taskId, session, capturedPhotos);
  }, [isOpen, uploadSuccess, userEmail, taskId, session, capturedPhotos]);

  // Prevent accidental browser tab close/reload during upload or while unsubmitted photos exist
  useEffect(() => {
    const hasUnsubmittedWork = isOpen && (isUploading || (capturedPhotos.length > 0 && !uploadSuccess));
    if (!hasUnsubmittedWork) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, isUploading, capturedPhotos.length, uploadSuccess]);

  // Capture a live video frame (appends new photo OR replaces retakingPhotoIndex in-place)
  const handleCaptureFrame = async (): Promise<boolean> => {
    if (isCapturing || isUploading) return false;

    const isRetake = retakingPhotoIndex !== null && retakingPhotoIndex >= 0 && retakingPhotoIndex < capturedPhotos.length;

    if (!isRetake && capturedPhotos.length >= maxPhotos) {
      setCaptureNotice({
        type: 'warning',
        message: `Maximum of ${maxPhotos} photos reached for this session. Submit your photos or remove/retake any shot below.`,
      });
      return false;
    }

    const video = videoRef.current;
    if (!video || !isStreaming) {
      setCaptureNotice({
        type: 'warning',
        message: 'Live camera stream is not connected yet. Connecting camera...',
      });
      await startCamera();
      return false;
    }

    if (video.paused || video.ended || video.readyState < 2) {
      setCaptureNotice({
        type: 'warning',
        message: 'Camera feed is initializing. Please wait a moment and tap Add Photo again.',
      });
      return false;
    }

    setIsCapturing(true);
    setCaptureNotice(null);

    try {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      // Fresh canvas per shot to avoid stale frame buffers
      const freshCanvas = document.createElement('canvas');
      freshCanvas.width = width;
      freshCanvas.height = height;

      const ctx = freshCanvas.getContext('2d');
      if (!ctx) {
        setCaptureNotice({
          type: 'error',
          message: 'Failed to initialize 2D canvas context for live camera capture.',
        });
        return false;
      }

      ctx.drawImage(video, 0, 0, width, height);

      // Corporate security watermark with IST time, room, task, and session reference
      const now = new Date();
      const nowIso = now.toISOString();
      const formattedIST = now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      const targetSlotNumber = isRetake ? retakingPhotoIndex! + 1 : capturedPhotos.length + 1;

      const boxHeight = Math.max(54, Math.round(height * 0.088));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(16, height - boxHeight - 16, width - 32, boxHeight);

      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(16, height - boxHeight - 16, width - 32, 3);

      const titleFontSize = Math.max(13, Math.round(height * 0.024));
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${titleFontSize}px "JetBrains Mono", monospace`;
      ctx.fillText(
        `WHITE COLLAR REALTY · ${roomName} · ${formattedIST} IST`,
        32,
        height - boxHeight + Math.round(boxHeight * 0.44) - 16
      );

      const metaFontSize = Math.max(10, Math.round(height * 0.017));
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${metaFontSize}px "JetBrains Mono", monospace`;
      const sessShort = session?.sessionId ? session.sessionId.slice(-10) : 'LIVE';
      ctx.fillText(
        `PHOTO #${targetSlotNumber} · TASK: ${taskId} · SESS: ${sessShort} · ATTR: ${userEmail}`,
        32,
        height - boxHeight + Math.round(boxHeight * 0.84) - 16
      );

      const dataUrl = freshCanvas.toDataURL('image/jpeg', 0.92);

      // Validate format, magic bytes, and size immediately upon capture
      const validation = validateCapturedPhotoDataUrl(dataUrl);
      if (!validation.valid) {
        setCaptureNotice({
          type: 'error',
          message: validation.error || 'Captured frame failed format/size validation. Please retake.',
        });
        return false;
      }

      const uniqueShotId = `shot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${targetSlotNumber}`;
      const newPhoto: CapturedPhotoItem = {
        id: uniqueShotId,
        dataUrl,
        capturedAt: nowIso,
        capturedAtIST: formattedIST,
        resolution: `${width}x${height}`,
        width,
        height,
        mimeType: validation.mimeType,
        sizeBytes: validation.sizeBytes,
        sizeLabel: validation.sizeLabel,
        valid: true,
      };

      if (isRetake) {
        const replacedIdx = retakingPhotoIndex!;
        setCapturedPhotos((prev) => prev.map((item, idx) => (idx === replacedIdx ? newPhoto : item)));
        setRetakingPhotoIndex(null);
        setCaptureNotice({
          type: 'info',
          message: `Photo #${replacedIdx + 1} retaken and updated (${validation.sizeLabel}).`,
        });
      } else {
        setCapturedPhotos((prev) => [...prev, newPhoto]);
      }

      setUploadError(null);
      setFailedPhotoIndex(null);
      setConfirmCloseOpen(false);
      setConfirmDiscardAll(false);
      return true;
    } catch (err: any) {
      console.error('Error during photo capture:', err);
      setCaptureNotice({
        type: 'error',
        message: 'Failed to capture frame from live camera. Please try again.',
      });
      return false;
    } finally {
      setIsCapturing(false);
    }
  };

  // Primary "Add Photo" handler: if enlarged preview is open, return to live viewfinder first so user can frame the shot
  const handleAddPhotoAction = async () => {
    if (isUploading || isCapturing) return;

    if (previewingPhotoIndex !== null) {
      setPreviewingPhotoIndex(null);
      if (!isStreaming) {
        await startCamera();
      }
      setCaptureNotice({
        type: 'info',
        message: 'Live camera active — align the room and tap Add Photo to capture.',
      });
      return;
    }

    await handleCaptureFrame();
  };

  // Remove a single photo from the gallery without losing remaining session photos
  const handleRemovePhoto = (index: number) => {
    if (isUploading || isCapturing) return;

    const remainingCount = capturedPhotos.length - 1;
    setCapturedPhotos((prev) => prev.filter((_, i) => i !== index));
    if (remainingCount === 0) {
      clearCaptureSessionDraft(userEmail, taskId);
    }

    if (retakingPhotoIndex !== null) {
      if (retakingPhotoIndex === index) {
        setRetakingPhotoIndex(null);
      } else if (retakingPhotoIndex > index) {
        setRetakingPhotoIndex(retakingPhotoIndex - 1);
      }
    }

    if (previewingPhotoIndex !== null) {
      if (remainingCount <= 0) {
        setPreviewingPhotoIndex(null);
      } else if (previewingPhotoIndex === index) {
        setPreviewingPhotoIndex(Math.min(index, remainingCount - 1));
      } else if (previewingPhotoIndex > index) {
        setPreviewingPhotoIndex(previewingPhotoIndex - 1);
      }
    }

    setUploadError(null);
    setFailedPhotoIndex(null);
  };

  // Start in-place retake for a specific photo (keeps original photo safe until replacement shot is snapped!)
  const handleStartRetakePhoto = (index: number) => {
    if (isUploading || isCapturing) return;
    setPreviewingPhotoIndex(null);
    setRetakingPhotoIndex(index);
    setCaptureNotice({
      type: 'info',
      message: `Retaking Photo #${index + 1}: frame your replacement shot and tap "Replace Photo #${
        index + 1
      }", or cancel to keep the existing shot.`,
    });
    if (!isStreaming) {
      void startCamera();
    }
  };

  const handleCancelRetake = () => {
    setRetakingPhotoIndex(null);
    setCaptureNotice(null);
  };

  // Explicitly discard all captured photos in the current session
  const handleExplicitDiscardAll = (closeAfterDiscard: boolean) => {
    if (isUploading) return;
    setCapturedPhotos([]);
    setPreviewingPhotoIndex(null);
    setRetakingPhotoIndex(null);
    setUploadError(null);
    setFailedPhotoIndex(null);
    setConfirmDiscardAll(false);
    setConfirmCloseOpen(false);
    clearCaptureSessionDraft(userEmail, taskId);

    if (closeAfterDiscard) {
      stopCamera();
      onClose();
    } else {
      setCaptureNotice({
        type: 'info',
        message: 'Discarded unsubmitted session photos. Ready to capture new photos.',
      });
    }
  };

  // Submit all captured photos together in one atomic, idempotent batch
  const handleSubmitPhotos = async () => {
    if (submittingRef.current || isUploading || isCapturing || uploadSuccess) return;
    if (capturedPhotos.length === 0) return;

    // Client-side per-photo format & batch size validation before network upload
    const check = validatePhotoBatchForSubmission(capturedPhotos, maxPhotos);
    if (!check.valid) {
      setUploadError(check.error || 'One or more photos failed format or size validation.');
      setFailedPhotoIndex(check.invalidIndices.length > 0 ? check.invalidIndices[0] + 1 : null);
      return;
    }

    submittingRef.current = true;
    setIsUploading(true);
    setUploadError(null);
    setFailedPhotoIndex(null);
    setCaptureNotice(null);
    setConfirmCloseOpen(false);
    setConfirmDiscardAll(false);
    setUploadProgress({
      loadedBytes: 0,
      totalBytes: check.totalBytes,
      percent: 5,
    });

    try {
      // Ensure we hold an active authoritative server capture session
      let activeSession = session;
      if (!activeSession?.sessionId || activeSession.sessionId.endsWith('_local')) {
        activeSession = await acquireServerSession(null);
      }

      if (!activeSession?.sessionId) {
        throw new Error(
          'Unable to initialize secure capture session with server. Your captured photos are preserved — please tap Retry Upload.'
        );
      }

      const submissionId = computeBatchSubmissionKey(taskId, activeSession.sessionId, capturedPhotos);

      const payloadPhotos = capturedPhotos.map((p, idx) => ({
        photoData: p.dataUrl,
        capturedAt: p.capturedAt,
        metadata: {
          device: 'Browser WebRTC Live Camera',
          resolution: p.resolution,
          mode: 'LIVE_CAMERA',
          photoIndex: idx + 1,
          totalInBatch: capturedPhotos.length,
          sessionId: activeSession!.sessionId,
        },
      }));

      const result = await api.uploadMultiPhotoEvidence(taskId, payloadPhotos, activeSession.sessionId, {
        submissionId,
        onProgress: ({ loadedBytes, totalBytes, percent }) => {
          setUploadProgress({
            loadedBytes,
            totalBytes,
            percent: Math.max(8, Math.min(99, percent)),
          });
        },
      });

      setUploadProgress({
        loadedBytes: check.totalBytes,
        totalBytes: check.totalBytes,
        percent: 100,
      });
      setUploadSuccess(true);
      clearCaptureSessionDraft(userEmail, taskId);

      setTimeout(() => {
        submittingRef.current = false;
        stopCamera();
        onPhotoUploaded(result.task, result.photoEvidence, result.photoEvidences);
        onClose();
      }, 650);
    } catch (err: any) {
      console.error('Multi-photo batch submission error:', err);
      // If capture session expired or became invalid on server, clear session ref so Retry acquires a fresh session automatically
      if (err?.code === 'EXPIRED_CAPTURE_SESSION' || err?.code === 'INVALID_CAPTURE_SESSION') {
        setSession(null);
      }
      if (typeof err?.failedPhotoIndex === 'number') {
        setFailedPhotoIndex(err.failedPhotoIndex);
      }
      setUploadError(
        err?.message || 'Upload failed due to a network or server error. Your photos are safe — please tap Retry Upload.'
      );
      setUploadProgress({
        loadedBytes: 0,
        totalBytes: check.totalBytes,
        percent: 0,
      });
      submittingRef.current = false;
      setIsUploading(false);
    }
  };

  const handleToggleFacingMode = () => {
    if (isUploading || isCapturing) return;
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Guard modal close when unsubmitted photos exist so photos are never lost accidentally
  const handleRequestClose = () => {
    if (isUploading || isCapturing) return;
    if (capturedPhotos.length > 0 && !uploadSuccess) {
      setConfirmCloseOpen(true);
      return;
    }
    stopCamera();
    onClose();
  };

  const handleKeepDraftAndClose = () => {
    if (isUploading) return;
    saveCaptureSessionDraft(userEmail, taskId, session, capturedPhotos);
    setConfirmCloseOpen(false);
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  const currentPreviewPhoto =
    previewingPhotoIndex !== null && capturedPhotos[previewingPhotoIndex]
      ? capturedPhotos[previewingPhotoIndex]
      : null;

  const isRetaking =
    retakingPhotoIndex !== null && retakingPhotoIndex >= 0 && retakingPhotoIndex < capturedPhotos.length;

  const canCaptureNow =
    !isUploading &&
    !isCapturing &&
    !uploadSuccess &&
    (previewingPhotoIndex !== null ||
      (isStreaming && videoReady && (isRetaking || capturedPhotos.length < maxPhotos)));

  const canSubmitNow =
    capturedPhotos.length >= 1 &&
    !isUploading &&
    !isCapturing &&
    !uploadSuccess &&
    batchValidation.valid;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[95vh]">
        {/* Hidden Canvas Reference */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">Live Camera Photo Capture</h2>
                {isStreaming && videoReady && (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE CAMERA
                  </span>
                )}
                <span
                  data-testid="session-photo-counter"
                  className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 tabular-nums"
                >
                  {capturedPhotos.length} Captured (Max {maxPhotos})
                </span>
                {sessionLoading && (
                  <span className="text-[10px] font-mono text-slate-500">Syncing session...</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                <span className="font-semibold text-slate-800 truncate max-w-[160px] sm:max-w-[240px]">
                  {session?.task?.roomAreaName || roomName}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[180px] sm:max-w-[260px]">{taskTitle}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRequestClose}
            disabled={isUploading || isCapturing}
            aria-label="Close live camera capture modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Policy Banner */}
        <div className="px-4 py-1.5 bg-amber-50/90 border-b border-amber-200/60 flex items-center justify-between gap-2 text-[11px] text-amber-900 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>
              <strong>White Collar Realty Security Policy:</strong> Capture 1 or more live photos, review in gallery, and submit when ready.
            </span>
          </div>
          {session?.captureSessionTimestamp && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-amber-800 shrink-0">
              <Clock className="w-3 h-3 text-amber-700" />
              <span>
                Session:{' '}
                {new Date(session.captureSessionTimestamp).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                IST
              </span>
            </div>
          )}
        </div>

        {/* Scrollable Middle Container (Camera Viewfinder + Preview Gallery) */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Accidental Photo Loss Guard Banner (on Close/Cancel with unsubmitted photos) */}
          {confirmCloseOpen && capturedPhotos.length > 0 && !isUploading && (
            <div className="px-4 py-2.5 bg-amber-950 text-white border-b border-amber-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0">
              <div className="text-xs">
                <span className="font-bold text-amber-300">
                  {capturedPhotos.length} unsubmitted photo{capturedPhotos.length === 1 ? '' : 's'} in session.
                </span>{' '}
                <span className="text-slate-200">
                  Submit now, keep saved in this session for later, or discard.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => setConfirmCloseOpen(false)}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-md cursor-pointer"
                >
                  Keep Reviewing
                </button>
                <button
                  type="button"
                  onClick={handleKeepDraftAndClose}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-md cursor-pointer"
                >
                  Keep in Session & Close
                </button>
                <button
                  type="button"
                  onClick={() => handleExplicitDiscardAll(true)}
                  className="px-2.5 py-1 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-md cursor-pointer"
                >
                  Discard Photos ({capturedPhotos.length})
                </button>
              </div>
            </div>
          )}

          {/* Active Retake Mode Banner */}
          {isRetaking && (
            <div className="px-4 py-2 bg-sky-950 text-sky-100 border-b border-sky-800 flex items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>
                  <strong>Retaking Photo #{retakingPhotoIndex! + 1}:</strong> Align camera and tap{' '}
                  <strong>Replace Photo #{retakingPhotoIndex! + 1}</strong>. Your current shot stays safe until replaced.
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelRetake}
                className="px-2.5 py-1 text-[11px] font-semibold bg-sky-800 hover:bg-sky-700 text-white rounded-md shrink-0 cursor-pointer"
              >
                Cancel Retake
              </button>
            </div>
          )}

          {/* Viewfinder / Enlarged Review Area */}
          <div
            className={`relative bg-black flex-1 flex items-center justify-center overflow-hidden ${
              capturedPhotos.length > 0
                ? 'min-h-[190px] sm:min-h-[250px]'
                : 'min-h-[240px] sm:min-h-[320px]'
            }`}
          >
            {/* Live Camera Stream Container (kept mounted so MediaStream never drops during photo review) */}
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={handleVideoMetadataLoaded}
                onCanPlay={handleVideoMetadataLoaded}
                onPlaying={handleVideoMetadataLoaded}
                className={`w-full h-full object-cover ${
                  capturedPhotos.length > 0 ? 'max-h-[250px] sm:max-h-[290px]' : 'max-h-[340px]'
                } ${isStreaming && videoReady ? 'block' : 'hidden'}`}
              />

              {/* Live Viewfinder Reticle */}
              {isStreaming && videoReady && !currentPreviewPhoto && (
                <div className="absolute inset-3 sm:inset-4 pointer-events-none border-2 border-white/30 rounded-xl flex flex-col justify-between p-2.5 sm:p-3 z-10">
                  <div className="flex justify-between text-white/90 text-[11px] font-mono">
                    <span className="flex items-center gap-1.5 bg-black/55 px-2 py-0.5 rounded backdrop-blur-xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      {isRetaking ? `RETAKE PHOTO #${retakingPhotoIndex! + 1}` : 'LIVE FEED'}
                    </span>
                    <span className="bg-black/55 px-2 py-0.5 rounded backdrop-blur-xs">
                      {videoRef.current?.videoWidth}x{videoRef.current?.videoHeight}
                    </span>
                  </div>

                  <div className="flex justify-center">
                    <div className="bg-black/70 text-white text-xs px-3 py-1 rounded-lg backdrop-blur-sm border border-white/20 text-center">
                      {isRetaking
                        ? `Frame replacement for Photo #${retakingPhotoIndex! + 1}`
                        : 'Align chairs, table surfaces, and water bottles in frame'}
                    </div>
                  </div>

                  <div className="flex justify-between text-white/80 text-[10px] font-mono items-center">
                    <span className="truncate max-w-[160px]">{roomName}</span>
                    <span className="flex items-center gap-1 bg-black/50 px-2 py-0.5 rounded">
                      <Layers className="w-3 h-3 text-amber-400" />
                      {capturedPhotos.length} photo{capturedPhotos.length === 1 ? '' : 's'} in session
                    </span>
                  </div>
                </div>
              )}

              {/* Connecting Camera State */}
              {!cameraError && (!isStreaming || !videoReady) && !currentPreviewPhoto && (
                <div className="text-center p-5 text-white">
                  <RefreshCw className="w-7 h-7 text-amber-400 animate-spin mx-auto mb-2.5" />
                  <h3 className="text-sm font-semibold mb-1">Connecting to Live Camera Stream...</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Please allow camera permissions if prompted by your device browser.
                  </p>
                </div>
              )}

              {/* Camera Error State */}
              {cameraError && !currentPreviewPhoto && (
                <div className="p-4 sm:p-5 text-center max-w-md text-white bg-slate-900/95 rounded-xl border border-rose-500/30 m-3 shadow-xl">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-2.5">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1 text-rose-300">Camera Access Required</h3>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">{cameraError}</p>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 text-xs font-bold bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Video className="w-4 h-4 text-slate-900" />
                    Restart Camera
                  </button>
                </div>
              )}
            </div>

            {/* Enlarged Review Overlay for Selected Gallery Photo */}
            {currentPreviewPhoto && previewingPhotoIndex !== null && (
              <div className="absolute inset-0 z-20 w-full h-full flex flex-col items-center justify-center bg-slate-950 p-2">
                <img
                  src={currentPreviewPhoto.dataUrl}
                  alt={`Captured photo ${previewingPhotoIndex + 1}`}
                  className="max-h-[230px] sm:max-h-[280px] w-full object-contain rounded-lg"
                />

                {/* Top Metadata Bar */}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
                  <div className="bg-slate-900/90 border border-slate-700 text-white text-xs px-2.5 py-1 rounded-lg backdrop-blur-md flex items-center gap-2 font-mono flex-wrap">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        currentPreviewPhoto.valid ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <span>
                      Photo #{previewingPhotoIndex + 1} of {capturedPhotos.length}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300">{currentPreviewPhoto.sizeLabel}</span>
                    <span className="text-slate-500 hidden sm:inline">·</span>
                    <span className="text-slate-300 hidden sm:inline">{currentPreviewPhoto.capturedAtIST}</span>
                  </div>

                  {capturedPhotos.length > 1 && (
                    <div className="flex items-center gap-1 pointer-events-auto">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewingPhotoIndex(
                            (previewingPhotoIndex - 1 + capturedPhotos.length) % capturedPhotos.length
                          )
                        }
                        aria-label="Previous captured photo"
                        className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-white cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewingPhotoIndex((previewingPhotoIndex + 1) % capturedPhotos.length)}
                        aria-label="Next captured photo"
                        className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-white cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom Individual Review Controls: Retake / Remove / Live Camera */}
                <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStartRetakePhoto(previewingPhotoIndex)}
                      disabled={isUploading || isCapturing}
                      className="px-3 py-1.5 text-xs font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900 border border-amber-500/40 rounded-lg backdrop-blur-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retake Photo #{previewingPhotoIndex + 1}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(previewingPhotoIndex)}
                      disabled={isUploading || isCapturing}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-200 bg-rose-950/90 hover:bg-rose-900 border border-rose-500/40 rounded-lg backdrop-blur-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPreviewingPhotoIndex(null)}
                    className="px-3.5 py-1.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Live Viewfinder
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Gallery of All Captured Session Photos */}
          {capturedPhotos.length > 0 && (
            <div
              data-testid="captured-photos-gallery"
              className="p-3 bg-slate-100 border-t border-slate-200 shrink-0"
            >
              {/* Gallery Header & Controls Bar (Includes Submit Photo(s) (N) Beside Gallery Controls) */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Preview Gallery ({capturedPhotos.length} photo{capturedPhotos.length === 1 ? '' : 's'} ready)
                    </span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-600 tabular-nums">
                    · Total: {batchValidation.totalSizeLabel}
                  </span>
                  <span className="text-[10px] text-slate-500 hidden md:inline">
                    · Click photo to enlarge
                  </span>
                </div>

                {/* Gallery Actions: Discard All + Clearly Visible Submit Photo(s) (N) */}
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  {!confirmDiscardAll ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDiscardAll(true)}
                      disabled={isUploading || isCapturing || uploadSuccess}
                      className="px-2.5 py-1.5 min-h-[36px] text-xs font-semibold text-rose-700 hover:text-rose-800 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Discard All
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 min-h-[36px]">
                      <span className="text-[11px] font-semibold text-rose-800">Discard all?</span>
                      <button
                        type="button"
                        onClick={() => handleExplicitDiscardAll(false)}
                        className="text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 px-2 py-0.5 rounded cursor-pointer"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscardAll(false)}
                        className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 px-1.5 py-0.5 cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmitPhotos}
                    disabled={!canSubmitNow}
                    data-testid="gallery-submit-photos-btn"
                    className="px-3.5 py-1.5 min-h-[36px] text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer tabular-nums"
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                        <span>Submitting ({capturedPhotos.length})...</span>
                      </>
                    ) : uploadSuccess ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5 text-white shrink-0" />
                        <span>Submitted ({capturedPhotos.length})</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5 text-white shrink-0" />
                        <span>Submit Photo(s) ({capturedPhotos.length})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
                {capturedPhotos.map((photo, index) => {
                  const isSelected = previewingPhotoIndex === index;
                  const isBeingRetaken = retakingPhotoIndex === index;
                  const hasError = !photo.valid || failedPhotoIndex === index + 1;

                  return (
                    <div
                      key={photo.id}
                      className={`relative shrink-0 w-28 rounded-lg overflow-hidden border-2 bg-slate-900 flex flex-col transition-all ${
                        hasError
                          ? 'border-rose-500 ring-2 ring-rose-400/40'
                          : isBeingRetaken
                          ? 'border-sky-500 ring-2 ring-sky-400/40'
                          : isSelected
                          ? 'border-amber-500 ring-2 ring-amber-400/40'
                          : 'border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {/* Clickable Thumbnail Preview */}
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewingPhotoIndex(previewingPhotoIndex === index ? null : index)
                        }
                        className="relative w-full h-16 overflow-hidden cursor-pointer block text-left"
                        title={`Review Photo #${index + 1} (${photo.sizeLabel} · ${photo.capturedAtIST})`}
                      >
                        <img
                          src={photo.dataUrl}
                          alt={`Captured photo ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-1 left-1 bg-black/75 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">
                          #{index + 1}
                        </span>
                        <span
                          className={`absolute top-1 right-1 text-[8px] font-mono px-1 py-0.5 rounded ${
                            hasError ? 'bg-rose-600 text-white' : 'bg-black/70 text-slate-200'
                          }`}
                        >
                          {hasError ? 'INVALID' : photo.sizeLabel}
                        </span>
                      </button>

                      {/* Individual Per-Photo Retake & Remove Bar */}
                      <div className="grid grid-cols-2 divide-x divide-slate-700 bg-slate-900 border-t border-slate-800 text-[10px]">
                        <button
                          type="button"
                          onClick={() => handleStartRetakePhoto(index)}
                          disabled={isUploading || isCapturing}
                          aria-label={`Retake photo ${index + 1}`}
                          title={`Retake photo #${index + 1}`}
                          className="py-1 px-1 font-semibold text-amber-300 hover:bg-slate-800 flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                          <span>Retake</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          disabled={isUploading || isCapturing}
                          aria-label={`Remove photo ${index + 1}`}
                          title={`Remove photo #${index + 1}`}
                          className="py-1 px-1 font-semibold text-rose-300 hover:bg-rose-950/70 flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <Trash2 className="w-2.5 h-2.5 shrink-0" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Quick "Add Photo" Tile inside Gallery */}
                {capturedPhotos.length < maxPhotos && (
                  <button
                    type="button"
                    onClick={handleAddPhotoAction}
                    disabled={isUploading || isCapturing || uploadSuccess}
                    className="shrink-0 w-24 min-h-[88px] rounded-lg border-2 border-dashed border-amber-400 hover:border-amber-500 bg-amber-50/70 hover:bg-amber-100/80 text-amber-950 flex flex-col items-center justify-center transition-all cursor-pointer gap-1 px-2 disabled:opacity-40"
                    title="Capture and add another photo to this session"
                  >
                    <Plus className="w-4 h-4 text-amber-700" />
                    <span className="text-[10px] font-bold leading-tight text-center">Add Photo</span>
                    <span className="text-[9px] font-mono text-amber-700">
                      #{capturedPhotos.length + 1}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pinned Modal Footer Controls */}
        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
          {/* Inline Notice Banner (session restore, retake info, validation feedback) */}
          {captureNotice && !isUploading && !uploadError && !uploadSuccess && (
            <div
              className={`mb-2.5 text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-2 border ${
                captureNotice.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : captureNotice.type === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <span>{captureNotice.message}</span>
              <button
                type="button"
                onClick={() => setCaptureNotice(null)}
                aria-label="Dismiss notice"
                className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Batch Validation Warning (if any photo in gallery is invalid) */}
          {capturedPhotos.length > 0 && !batchValidation.valid && !uploadError && !isUploading && (
            <div className="mb-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{batchValidation.error}</span>
            </div>
          )}

          {/* Real-Time Byte Upload Progress Indicator */}
          {isUploading && (
            <div className="mb-2.5 p-2.5 sm:p-3 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-900 mb-1.5">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  Submitting {capturedPhotos.length} photo{capturedPhotos.length === 1 ? '' : 's'}...
                </span>
                <span className="font-mono tabular-nums">
                  {uploadProgress.percent}%
                  {uploadProgress.totalBytes > 0 && (
                    <span className="text-[10px] text-amber-700 ml-1.5">
                      ({formatPhotoBytes(uploadProgress.loadedBytes)} / {formatPhotoBytes(uploadProgress.totalBytes)})
                    </span>
                  )}
                </span>
              </div>
              <div className="w-full h-2 bg-amber-200/60 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-amber-600 transition-all duration-200 rounded-full ${
                    uploadProgress.percent >= 100
                      ? 'w-full'
                      : uploadProgress.percent >= 90
                      ? 'w-11/12'
                      : uploadProgress.percent >= 75
                      ? 'w-3/4'
                      : uploadProgress.percent >= 50
                      ? 'w-1/2'
                      : uploadProgress.percent >= 25
                      ? 'w-1/4'
                      : 'w-1/12'
                  }`}
                />
              </div>
              <div className="text-[10px] text-amber-700 mt-1 font-mono">
                Validating image signatures, associating with {roomName}, and saving session evidence...
              </div>
            </div>
          )}

          {/* Upload Success Banner */}
          {uploadSuccess && (
            <div className="mb-2.5 p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Submitted {capturedPhotos.length} photo{capturedPhotos.length === 1 ? '' : 's'} successfully! Updating task...
              </span>
            </div>
          )}

          {/* Upload Failure Banner with Retry & Preserved Session Photos */}
          {uploadError && !isUploading && (
            <div className="mb-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-900">Upload Failed — Photos Preserved in Session</div>
                  <div className="text-rose-700 mt-0.5">{uploadError}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSubmitPhotos}
                disabled={!batchValidation.valid || isUploading}
                data-testid="retry-upload-btn"
                className="px-3 py-1.5 min-h-[36px] text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg shrink-0 cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Upload</span>
              </button>
            </div>
          )}

          {/* Action Bar: Camera Utilities | Add Photo | Submit Photo(s) (N) */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left Controls: Camera Stream Restart, Flip & Cancel */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={startCamera}
                disabled={isUploading || isCapturing}
                className="px-2.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Restart Camera Stream"
              >
                <Video className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">{isStreaming ? 'Restart' : 'Connect'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleFacingMode}
                disabled={isUploading || isCapturing}
                className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title="Switch Front/Back Camera"
                aria-label="Switch Front or Back Camera"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isUploading || isCapturing}
                className="px-2.5 py-2 min-h-[40px] text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </div>

            {/* Right Primary Actions: Add Photo + Submit Photo(s) (N) */}
            <div className="flex items-center gap-2 ml-auto flex-wrap sm:flex-nowrap">
              {isRetaking ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancelRetake}
                    disabled={isUploading || isCapturing}
                    className="px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel Retake
                  </button>
                  <button
                    type="button"
                    onClick={handleCaptureFrame}
                    disabled={!isStreaming || !videoReady || isUploading || isCapturing}
                    className="px-4 py-2 min-h-[40px] text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-sm rounded-xl cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isCapturing ? 'Capturing...' : `Replace Photo #${retakingPhotoIndex! + 1}`}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleAddPhotoAction}
                  disabled={!canCaptureNow}
                  data-testid="add-photo-btn"
                  className="px-3.5 sm:px-4 py-2 min-h-[40px] text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-sm rounded-xl cursor-pointer"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>{isCapturing ? 'Capturing...' : 'Add Photo'}</span>
                  {!isCapturing && capturedPhotos.length < maxPhotos && (
                    <span className="bg-amber-800/70 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums">
                      #{capturedPhotos.length + 1}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={handleSubmitPhotos}
                disabled={!canSubmitNow}
                data-testid="submit-photos-btn"
                className="px-4 sm:px-5 py-2 min-h-[40px] text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 rounded-xl shadow-sm cursor-pointer tabular-nums"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                    <span>Submitting ({capturedPhotos.length})...</span>
                  </>
                ) : uploadSuccess ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Submitted ({capturedPhotos.length})</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Submit Photo(s) ({capturedPhotos.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
