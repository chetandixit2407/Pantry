import type { CaptureSessionResponse } from '../types/index.ts';

export const MIN_PHOTO_SIZE_BYTES = 20;
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per photo client validation cap (server caps at 15 MB)
export const MAX_BATCH_TOTAL_BYTES = 45 * 1024 * 1024; // 45 MB total batch cap
export const DEFAULT_MAX_PHOTOS_PER_SESSION = 10;

export const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedPhotoMime = (typeof ALLOWED_PHOTO_MIMES)[number];

export interface CapturedPhotoItem {
  id: string;
  dataUrl: string;
  capturedAt: string; // ISO UTC
  capturedAtIST: string;
  resolution: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
  sizeLabel: string;
  valid: boolean;
  validationError?: string;
}

export interface PhotoValidationResult {
  valid: boolean;
  mimeType: string;
  sizeBytes: number;
  sizeLabel: string;
  error?: string;
}

export function formatPhotoBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function decodeBase64PrefixBytes(base64Str: string, maxBytes: number = 16): Uint8Array | null {
  try {
    // Take a clean 4-char aligned prefix sufficient to decode maxBytes
    const neededChars = Math.min(base64Str.length, Math.ceil((maxBytes + 4) / 3) * 4);
    const alignedLen = neededChars - (neededChars % 4);
    if (alignedLen < 4) return null;
    const slice = base64Str.slice(0, alignedLen);

    if (typeof atob === 'function') {
      const bin = atob(slice);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }

    // Node.js fallback for automated test suites
    const buf = Buffer.from(slice, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

export function computeBase64ByteLength(base64Clean: string): number {
  const len = base64Clean.length;
  if (len === 0) return 0;
  let padding = 0;
  if (base64Clean.endsWith('==')) padding = 2;
  else if (base64Clean.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export function validateCapturedPhotoDataUrl(dataUrl: string): PhotoValidationResult {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return {
      valid: false,
      mimeType: 'unknown',
      sizeBytes: 0,
      sizeLabel: '0 B',
      error: 'Missing image data.',
    };
  }

  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return {
      valid: false,
      mimeType: 'unknown',
      sizeBytes: 0,
      sizeLabel: '0 B',
      error: 'Unsupported image format. Only JPEG, PNG, or WebP live camera frames are allowed.',
    };
  }

  const rawSubtype = match[1].toLowerCase();
  const normalizedMime =
    rawSubtype === 'jpg' || rawSubtype === 'jpeg'
      ? 'image/jpeg'
      : rawSubtype === 'png'
      ? 'image/png'
      : rawSubtype === 'webp'
      ? 'image/webp'
      : `image/${rawSubtype}`;

  if (!(ALLOWED_PHOTO_MIMES as readonly string[]).includes(normalizedMime)) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes: 0,
      sizeLabel: '0 B',
      error: `Unsupported image type (${normalizedMime}). Allowed formats: JPEG, PNG, WebP.`,
    };
  }

  const base64Clean = match[2].replace(/\s+/g, '');
  if (base64Clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Clean)) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes: 0,
      sizeLabel: '0 B',
      error: 'Corrupted base64 image encoding.',
    };
  }

  const sizeBytes = computeBase64ByteLength(base64Clean);
  const sizeLabel = formatPhotoBytes(sizeBytes);

  if (sizeBytes < MIN_PHOTO_SIZE_BYTES) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes,
      sizeLabel,
      error: `Photo is too small or empty (${sizeLabel}; minimum ${MIN_PHOTO_SIZE_BYTES} B).`,
    };
  }

  if (sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes,
      sizeLabel,
      error: `Photo size (${sizeLabel}) exceeds the ${formatPhotoBytes(MAX_PHOTO_SIZE_BYTES)} per-photo limit.`,
    };
  }

  const header = decodeBase64PrefixBytes(base64Clean, 16);
  if (!header || header.length < 4) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes,
      sizeLabel,
      error: 'Unable to decode image header bytes.',
    };
  }

  const isJpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng =
    header.length >= 4 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47;
  const isWebp =
    header.length >= 12 &&
    header[0] === 0x52 && // R
    header[1] === 0x49 && // I
    header[2] === 0x46 && // F
    header[3] === 0x46 && // F
    header[8] === 0x57 && // W
    header[9] === 0x45 && // E
    header[10] === 0x42 && // B
    header[11] === 0x50; // P

  if (!isJpeg && !isPng && !isWebp) {
    return {
      valid: false,
      mimeType: normalizedMime,
      sizeBytes,
      sizeLabel,
      error: 'Invalid image signature: file header does not match JPEG, PNG, or WebP.',
    };
  }

  const detectedMime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';

  return {
    valid: true,
    mimeType: detectedMime,
    sizeBytes,
    sizeLabel,
  };
}

export interface BatchValidationSummary {
  valid: boolean;
  totalBytes: number;
  totalSizeLabel: string;
  invalidIndices: number[];
  error?: string;
  itemResults: PhotoValidationResult[];
}

export function validatePhotoBatchForSubmission(
  photos: Array<{ id: string; dataUrl: string }>,
  maxPhotos: number = DEFAULT_MAX_PHOTOS_PER_SESSION
): BatchValidationSummary {
  if (!Array.isArray(photos) || photos.length === 0) {
    return {
      valid: false,
      totalBytes: 0,
      totalSizeLabel: '0 B',
      invalidIndices: [],
      error: 'Capture at least 1 photo before submitting.',
      itemResults: [],
    };
  }

  if (photos.length > maxPhotos) {
    return {
      valid: false,
      totalBytes: 0,
      totalSizeLabel: '0 B',
      invalidIndices: [],
      error: `Maximum of ${maxPhotos} photos allowed per submission (currently ${photos.length}). Remove ${photos.length - maxPhotos} photo(s) to continue.`,
      itemResults: [],
    };
  }

  const itemResults = photos.map((p) => validateCapturedPhotoDataUrl(p.dataUrl));
  const invalidIndices: number[] = [];
  let totalBytes = 0;

  itemResults.forEach((res, idx) => {
    totalBytes += res.sizeBytes;
    if (!res.valid) {
      invalidIndices.push(idx);
    }
  });

  const totalSizeLabel = formatPhotoBytes(totalBytes);

  if (invalidIndices.length > 0) {
    const firstBad = invalidIndices[0];
    return {
      valid: false,
      totalBytes,
      totalSizeLabel,
      invalidIndices,
      error: `Photo #${firstBad + 1} failed validation: ${itemResults[firstBad].error || 'Invalid image'}. Remove or retake Photo #${firstBad + 1} to submit.`,
      itemResults,
    };
  }

  if (totalBytes > MAX_BATCH_TOTAL_BYTES) {
    return {
      valid: false,
      totalBytes,
      totalSizeLabel,
      invalidIndices: [],
      error: `Total batch size (${totalSizeLabel}) exceeds the ${formatPhotoBytes(MAX_BATCH_TOTAL_BYTES)} limit. Remove a photo and retry.`,
      itemResults,
    };
  }

  return {
    valid: true,
    totalBytes,
    totalSizeLabel,
    invalidIndices: [],
    itemResults,
  };
}

export function computeBatchSubmissionKey(
  taskId: string,
  sessionId: string | undefined,
  photos: Array<{ id: string; capturedAt: string }>
): string {
  const raw = `${taskId}|${sessionId || 'live'}|${photos.map((p) => `${p.id}:${p.capturedAt}`).join(',')}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `psub_${taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24)}_${photos.length}_${hex}`;
}

export interface CaptureSessionDraft {
  taskId: string;
  userEmail: string;
  session: CaptureSessionResponse | null;
  photos: CapturedPhotoItem[];
  savedAt: string;
}

function getDraftStorageKey(userEmail: string, taskId: string): string {
  return `wcr_photo_draft_v1::${userEmail.trim().toLowerCase()}::${taskId.trim()}`;
}

export function loadCaptureSessionDraft(
  userEmail: string,
  taskId: string,
  storage?: Pick<Storage, 'getItem'>
): CaptureSessionDraft | null {
  try {
    const targetStorage = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
    if (!targetStorage || !userEmail || !taskId) return null;
    const raw = targetStorage.getItem(getDraftStorageKey(userEmail, taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CaptureSessionDraft;
    if (
      !parsed ||
      parsed.taskId !== taskId ||
      parsed.userEmail.toLowerCase() !== userEmail.trim().toLowerCase() ||
      !Array.isArray(parsed.photos) ||
      parsed.photos.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCaptureSessionDraft(
  userEmail: string,
  taskId: string,
  session: CaptureSessionResponse | null,
  photos: CapturedPhotoItem[],
  storage?: Pick<Storage, 'setItem' | 'removeItem'>
): boolean {
  try {
    const targetStorage = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
    if (!targetStorage || !userEmail || !taskId) return false;
    const key = getDraftStorageKey(userEmail, taskId);
    if (!photos || photos.length === 0) {
      targetStorage.removeItem(key);
      return true;
    }
    const payload: CaptureSessionDraft = {
      taskId,
      userEmail: userEmail.trim().toLowerCase(),
      session,
      photos,
      savedAt: new Date().toISOString(),
    };
    targetStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearCaptureSessionDraft(
  userEmail: string,
  taskId: string,
  storage?: Pick<Storage, 'removeItem'>
): void {
  try {
    const targetStorage = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
    if (!targetStorage || !userEmail || !taskId) return;
    targetStorage.removeItem(getDraftStorageKey(userEmail, taskId));
  } catch {}
}
