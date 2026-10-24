import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, RefreshCw, Upload, X, CheckCircle, Video, AlertCircle, FlipHorizontal } from 'lucide-react';
import { api } from '../../services/api.ts';

interface CameraCaptureModalProps {
  taskId: string;
  taskTitle: string;
  roomName: string;
  userEmail: string;
  isOpen: boolean;
  onClose: () => void;
  onPhotoUploaded: (task: any, photoEvidence: any) => void;
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

  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [videoReady, setVideoReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [captureMetadata, setCaptureMetadata] = useState<{
    capturedAt: string;
    resolution: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Stop all camera media tracks
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setVideoReady(false);
  }, []);

  // Start real webcam stream
  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    setVideoReady(false);

    // Verify browser support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Your browser does not support camera access (getUserMedia). Please open this app in Chrome, Safari, or Edge over HTTPS.'
      );
      return;
    }

    try {
      let stream: MediaStream;

      // 1. Try preferred facingMode with ideal dimensions
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
        // Fallback to basic video constraint if constraints were over-constrained
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

      // Attach stream to the video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.autoplay = true;
        videoRef.current.playsInline = true;
        videoRef.current.muted = true;

        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('Video play() promise error:', playErr);
        }

        setIsStreaming(true);

        // Check if video dimensions are already available
        if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          setVideoReady(true);
        }
      }
    } catch (err: any) {
      console.error('Real camera access failed:', err);
      let errorMsg = 'Could not access device camera. Please check your system camera settings.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg =
          'Camera access was denied. Please click the camera icon in your browser address bar, grant camera permission, and click "Start Camera".';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = 'No camera hardware found on this device. Please connect a webcam or open this app on a mobile device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg =
          'Your camera is currently in use by another application or browser tab. Please close other camera apps and click "Start Camera".';
      } else if (err.name === 'SecurityError') {
        errorMsg = 'Camera access blocked due to security restrictions. Ensure the site is running over HTTPS.';
      } else if (err.message) {
        errorMsg = err.message;
      }

      setCameraError(errorMsg);
      setIsStreaming(false);
      setVideoReady(false);
    }
  }, [facingMode, stopCamera]);

  // Handle video element metadata load
  const handleVideoMetadataLoaded = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoReady(true);
    }
  };

  // Re-start / stop stream according to modal open state
  useEffect(() => {
    if (isOpen && !capturedPhoto) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, capturedPhoto, startCamera, stopCamera]);

  // Capture real frame from the live video element using canvas
  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      alert('Camera video frame is not ready yet. Please wait for the live preview to appear.');
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw the actual live video frame
    ctx.drawImage(video, 0, 0, width, height);

    // Add corporate security watermark directly onto the captured image
    const now = new Date();
    const nowIso = now.toISOString();
    const formattedDate = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Watermark overlay box
    const boxHeight = Math.max(50, Math.round(height * 0.08));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(16, height - boxHeight - 16, width - 32, boxHeight);

    // Primary watermark text
    const titleFontSize = Math.max(14, Math.round(height * 0.024));
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${titleFontSize}px "JetBrains Mono", monospace`;
    ctx.fillText(
      `WHITE COLLAR REALTY · ${roomName} · ${formattedDate} IST`,
      32,
      height - boxHeight + Math.round(boxHeight * 0.42) - 16
    );

    // Secondary metadata text
    const metaFontSize = Math.max(11, Math.round(height * 0.018));
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${metaFontSize}px "JetBrains Mono", monospace`;
    ctx.fillText(
      `TASK: ${taskId} · PANTRY ATTR: ${userEmail}`,
      32,
      height - boxHeight + Math.round(boxHeight * 0.82) - 16
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedPhoto(dataUrl);
    setCaptureMetadata({
      capturedAt: nowIso,
      resolution: `${width}x${height}`,
    });

    stopCamera();
  };

  // Retake photo: clear capture and restart webcam
  const handleRetake = () => {
    setCapturedPhoto(null);
    setCaptureMetadata(null);
    setUploadError(null);
    startCamera();
  };

  // Upload captured photo to server
  const handleUpload = async () => {
    if (!capturedPhoto) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const result = await api.uploadPhotoEvidence(taskId, capturedPhoto, {
        device: 'Real Browser WebRTC Live Camera',
        resolution: captureMetadata?.resolution || '1280x720',
        mode: 'LIVE_CAMERA',
      });
      onPhotoUploaded(result.task, result.photoEvidence);
      onClose();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload photo evidence to cloud server');
    } finally {
      setIsUploading(false);
    }
  };

  // Toggle front/back camera
  const handleToggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">Live Camera Photo Capture</h2>
                {isStreaming && videoReady && (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{roomName}</span>
                <span aria-hidden="true">·</span>
                <span>White Collar Realty</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative bg-black flex-1 min-h-[340px] sm:min-h-[420px] flex items-center justify-center overflow-hidden">
          {/* Hidden Canvas for Frame Grab */}
          <canvas ref={canvasRef} className="hidden" />

          {/* 1. Review Captured Photo */}
          {capturedPhoto ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
              <img
                src={capturedPhoto}
                alt="Captured Room Evidence"
                className="max-h-[380px] sm:max-h-[440px] w-full object-contain"
              />
              <div className="absolute top-3 left-3 bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-xs px-2.5 py-1 rounded-md backdrop-blur-md flex items-center gap-1.5 font-mono">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Captured: {new Date(captureMetadata?.capturedAt || '').toLocaleTimeString()}</span>
              </div>
            </div>
          ) : (
            /* 2. Real Live Video Element (ALWAYS MOUNTED IN DOM SO REF IS NEVER NULL) */
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={handleVideoMetadataLoaded}
                onCanPlay={handleVideoMetadataLoaded}
                onPlaying={handleVideoMetadataLoaded}
                className={`w-full h-full object-cover max-h-[420px] ${
                  isStreaming && videoReady ? 'block' : 'hidden'
                }`}
              />

              {/* Live Viewfinder Reticle (Only shown when real video is playing) */}
              {isStreaming && videoReady && (
                <div className="absolute inset-6 pointer-events-none border-2 border-white/30 rounded-xl flex flex-col justify-between p-3">
                  <div className="flex justify-between text-white/80 text-[11px] font-mono">
                    <span className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      LIVE FEED
                    </span>
                    <span className="bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
                      {videoRef.current?.videoWidth}x{videoRef.current?.videoHeight}
                    </span>
                  </div>

                  <div className="flex justify-center">
                    <div className="bg-black/60 text-white text-xs px-3.5 py-1 rounded-full backdrop-blur-sm border border-white/20">
                      Center chairs & desk surfaces in frame
                    </div>
                  </div>

                  <div className="flex justify-between text-white/60 text-[10px] font-mono">
                    <span>{roomName}</span>
                    <span>WCR HOSPITALITY OS</span>
                  </div>
                </div>
              )}

              {/* Loading Stream State */}
              {!cameraError && (!isStreaming || !videoReady) && (
                <div className="text-center p-6 text-white">
                  <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto mb-3" />
                  <h3 className="text-sm font-semibold mb-1">Connecting to Device Camera...</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Please allow camera permissions if prompted by your browser.
                  </p>
                </div>
              )}

              {/* Real Camera Error State */}
              {cameraError && (
                <div className="p-6 text-center max-w-md text-white bg-slate-900/90 rounded-xl border border-slate-800 m-4">
                  <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1.5">Camera Access Needed</h3>
                  <p className="text-xs text-slate-300 leading-relaxed mb-4">{cameraError}</p>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-5 py-2 text-xs font-bold bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5 shadow-sm"
                  >
                    <Video className="w-4 h-4 text-slate-900" />
                    Start Camera
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-slate-200 bg-white shrink-0">
          {uploadError && (
            <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
              {uploadError}
            </div>
          )}

          {capturedPhoto ? (
            /* Review Actions */
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRetake}
                disabled={isUploading}
                className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retake Photo
              </button>
              <div className="text-[11px] text-slate-500 hidden sm:block truncate">
                Server will verify timestamp & chair alignment
              </div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={isUploading}
                className="px-5 py-2.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center gap-2 shrink-0 shadow-sm"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Uploading Evidence...
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    Upload & Submit Task
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Live Camera Actions */
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1.5"
                >
                  <Video className="w-3.5 h-3.5 text-slate-600" />
                  {isStreaming ? 'Restart Camera' : 'Use Webcam'}
                </button>
                <button
                  type="button"
                  onClick={handleToggleFacingMode}
                  className="p-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  title="Switch Front/Back Camera"
                >
                  <FlipHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Real Capture Button - Only enabled when video is actually streaming and ready */}
              <button
                type="button"
                onClick={handleCapture}
                disabled={!isStreaming || !videoReady}
                className="px-6 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm rounded-lg"
              >
                <Camera className="w-4 h-4" />
                Snap Evidence Photo
              </button>

              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onClose();
                }}
                className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
