import React, { useRef, useState, useEffect, useCallback } from 'react';
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
  Eye,
  ShieldCheck,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';
import { api } from '../../services/api.ts';
import type { Task, PhotoEvidence, CaptureSessionResponse } from '../../types/index.ts';

interface CapturedPhotoItem {
  id: string;
  dataUrl: string;
  capturedAt: string; // ISO UTC
  capturedAtIST: string;
  resolution: string;
  width: number;
  height: number;
}

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

  // Capture session state from server
  const [session, setSession] = useState<CaptureSessionResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(false);

  // Live stream state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Multi-photo state
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhotoItem[]>([]);
  const [previewingPhotoIndex, setPreviewingPhotoIndex] = useState<number | null>(null);
  const [maxPhotos, setMaxPhotos] = useState<number>(10);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  // Upload state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; percent: number }>({
    current: 0,
    total: 0,
    percent: 0,
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);

  // Stop all camera media tracks
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

  // Initialize server authoritative capture session
  const initSession = useCallback(async () => {
    setSessionLoading(true);
    setUploadError(null);
    try {
      const sess = await api.initCaptureSession(taskId);
      setSession(sess);
      if (sess.maxPhotos) {
        setMaxPhotos(sess.maxPhotos);
      }
    } catch (err: any) {
      console.warn('Could not initialize capture session from server, using local fallback:', err);
      setSession({
        sessionId: `csess_${Date.now()}_local`,
        captureSessionTimestamp: new Date().toISOString(),
        maxPhotos: 10,
        task: { id: taskId, title: taskTitle, roomAreaName: roomName },
      });
    } finally {
      setSessionLoading(false);
    }
  }, [taskId, taskTitle, roomName]);

  // Start real webcam stream
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

  // Mount/unmount lifecycle
  useEffect(() => {
    if (isOpen) {
      setCapturedPhotos([]);
      setPreviewingPhotoIndex(null);
      setUploadSuccess(false);
      setUploadError(null);
      initSession();
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, initSession, startCamera, stopCamera]);

  // Prevent accidental close during active upload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isUploading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isUploading]);

  // Capture single frame from live video without closing camera
  const handleSnapPhoto = async (): Promise<boolean> => {
    if (isCapturing) return false;

    if (capturedPhotos.length >= maxPhotos) {
      alert(`Maximum of ${maxPhotos} photos reached for this task. You can upload all photos or remove any photo below.`);
      return false;
    }

    const video = videoRef.current;
    if (!video) {
      alert('Camera stream is not available. Please wait or restart the camera.');
      return false;
    }

    if (video.paused || video.ended || video.readyState < 2) {
      alert('Camera feed is buffering or not ready yet. Please wait a moment for live video.');
      return false;
    }

    setIsCapturing(true);

    try {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      // Use a new canvas element for each shot to prevent canvas buffer re-use or state caching
      const freshCanvas = document.createElement('canvas');
      freshCanvas.width = width;
      freshCanvas.height = height;

      const ctx = freshCanvas.getContext('2d');
      if (!ctx) {
        alert('Failed to initialize 2D canvas context for camera capture.');
        return false;
      }

      // Draw active live video frame
      ctx.drawImage(video, 0, 0, width, height);

      // Apply corporate security watermark
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

      const boxHeight = Math.max(54, Math.round(height * 0.088));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(16, height - boxHeight - 16, width - 32, boxHeight);

      // Gold accent top bar on watermark box
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(16, height - boxHeight - 16, width - 32, 3);

      // Primary watermark line: Company, Room, IST Timestamp
      const titleFontSize = Math.max(13, Math.round(height * 0.024));
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${titleFontSize}px "JetBrains Mono", monospace`;
      ctx.fillText(
        `WHITE COLLAR REALTY · ${roomName} · ${formattedIST} IST`,
        32,
        height - boxHeight + Math.round(boxHeight * 0.44) - 16
      );

      // Secondary metadata line: Task ID, Photo Index, Attendant
      const metaFontSize = Math.max(10, Math.round(height * 0.017));
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${metaFontSize}px "JetBrains Mono", monospace`;
      const photoNumber = capturedPhotos.length + 1;
      const sessShort = session?.sessionId ? session.sessionId.slice(-10) : 'LIVE';
      ctx.fillText(
        `PHOTO #${photoNumber} · TASK: ${taskId} · SESS: ${sessShort} · ATTR: ${userEmail}`,
        32,
        height - boxHeight + Math.round(boxHeight * 0.84) - 16
      );

      const dataUrl = freshCanvas.toDataURL('image/jpeg', 0.92);

      const uniqueShotId = `shot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${photoNumber}`;

      const newPhoto: CapturedPhotoItem = {
        id: uniqueShotId,
        dataUrl,
        capturedAt: nowIso,
        capturedAtIST: formattedIST,
        resolution: `${width}x${height}`,
        width,
        height,
      };

      setCapturedPhotos((prev) => [...prev, newPhoto]);
      setUploadError(null);
      return true;
    } catch (err: any) {
      console.error('Error during photo capture:', err);
      alert('Failed to capture frame from live camera. Please try again.');
      return false;
    } finally {
      setIsCapturing(false);
    }
  };

  // Add shot: switches back from single preview if needed and snaps frame directly
  const handleAddShotClick = async () => {
    setPreviewingPhotoIndex(null);
    if (isStreaming && videoReady && videoRef.current && videoRef.current.readyState >= 2) {
      await handleSnapPhoto();
    } else {
      await startCamera();
    }
  };

  // Remove individual photo
  const handleRemovePhoto = (index: number) => {
    setCapturedPhotos((prev) => prev.filter((_, i) => i !== index));
    if (previewingPhotoIndex === index) {
      setPreviewingPhotoIndex(null);
    } else if (previewingPhotoIndex !== null && previewingPhotoIndex > index) {
      setPreviewingPhotoIndex(previewingPhotoIndex - 1);
    }
  };

  // Retake specific photo
  const handleRetakePhoto = (index: number) => {
    handleRemovePhoto(index);
    setPreviewingPhotoIndex(null);
    if (!isStreaming) {
      startCamera();
    }
  };

  // Upload all captured photos in batch
  const handleUploadAll = async () => {
    if (capturedPhotos.length === 0 || isUploading) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress({ current: 0, total: capturedPhotos.length, percent: 10 });

    try {
      const payloadPhotos = capturedPhotos.map((p, idx) => ({
        photoData: p.dataUrl,
        capturedAt: p.capturedAt,
        metadata: {
          device: 'Browser WebRTC Live Camera',
          resolution: p.resolution,
          mode: 'LIVE_CAMERA',
          photoIndex: idx + 1,
          totalInBatch: capturedPhotos.length,
          sessionId: session?.sessionId,
        },
      }));

      setUploadProgress({ current: Math.ceil(capturedPhotos.length / 2), total: capturedPhotos.length, percent: 50 });

      const result = await api.uploadMultiPhotoEvidence(taskId, payloadPhotos, session?.sessionId);

      setUploadProgress({ current: capturedPhotos.length, total: capturedPhotos.length, percent: 100 });
      setUploadSuccess(true);

      // Give visual feedback then trigger parent callback and close
      setTimeout(() => {
        stopCamera();
        onPhotoUploaded(result.task, result.photoEvidence, result.photoEvidences);
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Multi-photo upload error:', err);
      setUploadError(err.message || 'Failed to upload photo evidence batch to company server. Please retry.');
      setUploadProgress({ current: 0, total: capturedPhotos.length, percent: 0 });
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleClose = () => {
    if (isUploading) return;
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  const currentPreviewPhoto =
    previewingPhotoIndex !== null && capturedPhotos[previewingPhotoIndex]
      ? capturedPhotos[previewingPhotoIndex]
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[96vh]">
        {/* Hidden Canvas for Live Frame Processing & Watermarking */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">Live Camera Photo Capture</h2>
                {isStreaming && videoReady && (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE CAMERA
                  </span>
                )}
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                  {capturedPhotos.length} / {maxPhotos} Captured
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                <span className="font-semibold text-slate-800">{roomName}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[200px]">{taskTitle}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading || isCapturing}
            aria-label="Close live camera capture modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Policy Banner: File & Gallery Uploads Strictly Disabled */}
        <div className="px-4 py-1.5 bg-amber-50/90 border-b border-amber-200/60 flex items-center justify-between text-[11px] text-amber-900 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>
              <strong>White Collar Realty Security Policy:</strong> Live camera stream capture only. Gallery & file picker strictly disabled.
            </span>
          </div>
          {session?.captureSessionTimestamp && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-amber-800 shrink-0">
              <Clock className="w-3 h-3 text-amber-700" />
              <span>
                Session Start:{' '}
                {new Date(session.captureSessionTimestamp).toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                IST
              </span>
            </div>
          )}
        </div>

        {/* Viewfinder / Active Preview Area */}
        <div className="relative bg-black flex-1 min-h-[300px] sm:min-h-[380px] flex items-center justify-center overflow-hidden">
          {/* Live Camera Stream Container (ALWAYS MOUNTED IN DOM SO REF & STREAM NEVER UNMOUNT) */}
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={handleVideoMetadataLoaded}
              onCanPlay={handleVideoMetadataLoaded}
              onPlaying={handleVideoMetadataLoaded}
              className={`w-full h-full object-cover max-h-[380px] ${
                isStreaming && videoReady ? 'block' : 'hidden'
              }`}
            />

            {/* Live Viewfinder Reticle */}
            {isStreaming && videoReady && !currentPreviewPhoto && (
              <div className="absolute inset-4 sm:inset-6 pointer-events-none border-2 border-white/30 rounded-xl flex flex-col justify-between p-3 z-10">
                <div className="flex justify-between text-white/90 text-[11px] font-mono">
                  <span className="flex items-center gap-1.5 bg-black/50 px-2 py-0.5 rounded backdrop-blur-xs">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    LIVE FEED
                  </span>
                  <span className="bg-black/50 px-2 py-0.5 rounded backdrop-blur-xs">
                    {videoRef.current?.videoWidth}x{videoRef.current?.videoHeight}
                  </span>
                </div>

                <div className="flex justify-center">
                  <div className="bg-black/70 text-white text-xs px-3.5 py-1 rounded-full backdrop-blur-sm border border-white/20 text-center">
                    Align chairs, table surfaces, and water bottles in frame
                  </div>
                </div>

                <div className="flex justify-between text-white/80 text-[10px] font-mono items-center">
                  <span className="truncate max-w-[150px]">{roomName}</span>
                  <span className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded">
                    <Layers className="w-3 h-3 text-amber-400" />
                    {capturedPhotos.length} / {maxPhotos} photos ready
                  </span>
                </div>
              </div>
            )}

            {/* Connecting / Loading Camera State */}
            {!cameraError && (!isStreaming || !videoReady) && !currentPreviewPhoto && (
              <div className="text-center p-6 text-white">
                <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
                <h3 className="text-sm font-semibold mb-1">Connecting to Live Camera Stream...</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Please allow camera permissions if prompted by your device browser.
                </p>
              </div>
            )}

            {/* Camera Error Message */}
            {cameraError && !currentPreviewPhoto && (
              <div className="p-6 text-center max-w-md text-white bg-slate-900/95 rounded-xl border border-rose-500/30 m-4 shadow-xl">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold mb-1.5 text-rose-300">Camera Access Required</h3>
                <p className="text-xs text-slate-300 leading-relaxed mb-4">{cameraError}</p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-5 py-2 text-xs font-bold bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Video className="w-4 h-4 text-slate-900" />
                  Restart Camera
                </button>
              </div>
            )}
          </div>

          {/* Enlarged Inspection Overlay of a Captured Photo (Overlay on top of video) */}
          {currentPreviewPhoto && (
            <div className="absolute inset-0 z-20 w-full h-full flex flex-col items-center justify-center bg-black p-2">
              <img
                src={currentPreviewPhoto.dataUrl}
                alt={`Captured photo ${previewingPhotoIndex! + 1}`}
                className="max-h-[340px] sm:max-h-[380px] w-full object-contain rounded-lg"
              />

              <div className="absolute top-4 left-4 bg-slate-900/85 border border-slate-700 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur-md flex items-center gap-2 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Photo #{previewingPhotoIndex! + 1} of {capturedPhotos.length}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-300">{currentPreviewPhoto.capturedAtIST}</span>
              </div>

              <div className="absolute bottom-4 inset-x-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleRetakePhoto(previewingPhotoIndex!)}
                  disabled={isUploading || isCapturing}
                  className="px-3.5 py-1.5 text-xs font-semibold text-rose-200 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 rounded-lg backdrop-blur-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Retake / Remove This Shot
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewingPhotoIndex(null)}
                  className="px-4 py-1.5 text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Back to Live Camera
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Captured Photos Preview Tray (Horizontal thumbnail list with timestamps & removal) */}
        {capturedPhotos.length > 0 && (
          <div className="p-3 bg-slate-100 border-t border-slate-200 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                Captured Photos ({capturedPhotos.length} of {maxPhotos}):
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Click any thumbnail to inspect or retake
              </span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {capturedPhotos.map((photo, index) => (
                <div
                  key={photo.id}
                  className={`relative group shrink-0 w-24 h-20 rounded-lg overflow-hidden border-2 bg-slate-900 transition-all cursor-pointer ${
                    previewingPhotoIndex === index
                      ? 'border-amber-500 ring-2 ring-amber-400/40'
                      : 'border-slate-300 hover:border-slate-400'
                  }`}
                  onClick={() => setPreviewingPhotoIndex(index)}
                  title={`Photo #${index + 1} - Captured: ${photo.capturedAtIST}`}
                >
                  <img src={photo.dataUrl} alt={`Captured ${index + 1}`} className="w-full h-full object-cover" />

                  {/* Photo Index Badge */}
                  <span className="absolute top-1 left-1 bg-black/70 text-white text-[9px] font-mono font-bold px-1 py-0.5 rounded">
                    #{index + 1}
                  </span>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePhoto(index);
                    }}
                    disabled={isUploading || isCapturing}
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute top-1 right-1 p-1 rounded bg-rose-600 hover:bg-rose-700 text-white shadow-xs opacity-90 hover:opacity-100 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>

                  {/* Timestamp overlay on hover */}
                  <div className="absolute inset-x-0 bottom-0 bg-black/80 px-1 py-0.5 text-[8px] text-white font-mono truncate">
                    {photo.capturedAtIST.split(',')[1] || photo.capturedAtIST}
                  </div>
                </div>
              ))}

              {capturedPhotos.length < maxPhotos && (
                <button
                  type="button"
                  onClick={handleAddShotClick}
                  disabled={isUploading || isCapturing}
                  className="shrink-0 w-24 h-20 rounded-lg border-2 border-dashed border-amber-300 hover:border-amber-500 bg-amber-50/50 hover:bg-amber-100/70 text-amber-900 flex flex-col items-center justify-center transition-all cursor-pointer gap-1 shadow-2xs active:scale-95 disabled:opacity-50"
                  title="Snap another live camera photo"
                >
                  <Camera className="w-4 h-4 text-amber-600" />
                  <span className="text-[10px] font-bold">+ Snap Shot</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer Controls */}
        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
          {/* Upload Progress Indicator */}
          {isUploading && (
            <div className="mb-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-900 mb-1.5">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  Uploading {capturedPhotos.length} live camera photo(s)...
                </span>
                <span className="font-mono">{uploadProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-amber-200/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-600 transition-all duration-300 rounded-full"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              <div className="text-[10px] text-amber-700 mt-1 font-mono">
                Server is verifying image integrity, magic bytes, and recording authoritative timestamps.
              </div>
            </div>
          )}

          {/* Success Indicator */}
          {uploadSuccess && (
            <div className="mb-3 p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>All {capturedPhotos.length} photo(s) saved and timestamped successfully! Updating task...</span>
            </div>
          )}

          {/* Upload Error Banner & Retry */}
          {uploadError && (
            <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start justify-between gap-2">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={handleUploadAll}
                className="px-2.5 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shrink-0 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
            {/* Left Controls: Switch Camera & Restart */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={startCamera}
                disabled={isUploading || isCapturing}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Restart Camera Stream"
              >
                <Video className="w-3.5 h-3.5 text-slate-600" />
                <span className="hidden sm:inline">{isStreaming ? 'Restart' : 'Connect'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleFacingMode}
                disabled={isUploading || isCapturing}
                className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title="Switch Front/Back Camera"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Middle Control: Live Snap Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSnapPhoto}
                disabled={!isStreaming || !videoReady || isUploading || isCapturing || capturedPhotos.length >= maxPhotos}
                className="px-4 sm:px-6 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm rounded-xl cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>{isCapturing ? 'Capturing...' : 'Snap Live Photo'}</span>
                {capturedPhotos.length > 0 && !isCapturing && (
                  <span className="bg-amber-700/80 px-1.5 py-0.5 rounded text-[10px] font-mono">
                    #{capturedPhotos.length + 1}
                  </span>
                )}
              </button>
            </div>

            {/* Right Control: Upload All Photos (or Cancel) */}
            <div className="flex items-center gap-2">
              {capturedPhotos.length > 0 ? (
                <button
                  type="button"
                  onClick={handleUploadAll}
                  disabled={isUploading || isCapturing}
                  className="px-4 sm:px-5 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center gap-2 rounded-xl shadow-sm cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>Upload All Photos ({capturedPhotos.length})</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isUploading || isCapturing}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

