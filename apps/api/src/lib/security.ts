import path from 'path';
import fs from 'fs';
import type { Request } from 'express';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export const isAllowedImageUpload = (file: Express.Multer.File) => {
  const mimetype = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();
  return ALLOWED_IMAGE_MIME_TYPES.has(mimetype) && ALLOWED_IMAGE_EXTENSIONS.has(extension);
};

const normalizeImageMimeType = (value: unknown) => {
  const mimetype = String(value || '').toLowerCase();
  return mimetype === 'image/jpg' ? 'image/jpeg' : mimetype;
};

export const detectImageMimeType = (buffer: Buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
};

export const isAllowedImageFileContent = (file: Express.Multer.File) => {
  if (!file?.path || !fs.existsSync(file.path)) return false;
  const fd = fs.openSync(file.path, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    const detected = detectImageMimeType(header.subarray(0, bytesRead));
    return Boolean(detected && detected === normalizeImageMimeType(file.mimetype));
  } finally {
    fs.closeSync(fd);
  }
};

export const getUploadRoot = () => process.env.DRAPIXAI_UPLOAD_DIR || 'uploads';

const getResolvedUploadRoot = () => path.resolve(getUploadRoot());

const isPathInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const removeUploadedFile = (file: Express.Multer.File | undefined | null) => {
  if (!file?.path) return;
  const root = getResolvedUploadRoot();
  const localPath = path.resolve(file.path);
  if (isPathInside(root, localPath) && fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
  }
};

export const sanitizePathSegment = (value: unknown, fallback = 'item') => {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 120);
  return sanitized || fallback;
};

export const buildUploadPath = (...segments: unknown[]) => {
  const root = getResolvedUploadRoot();
  const safeSegments = segments.map((segment) => sanitizePathSegment(segment));
  const resolved = path.resolve(root, ...safeSegments);
  if (!isPathInside(root, resolved)) {
    throw new Error('UPLOAD_PATH_OUTSIDE_ROOT');
  }
  return resolved;
};

export const readLocalUploadFile = (storedUrl: string) => {
  if (!storedUrl.startsWith('local:')) return null;
  const root = getResolvedUploadRoot();
  const localPath = path.resolve(storedUrl.replace('local:', ''));
  if (!isPathInside(root, localPath) || !fs.existsSync(localPath)) {
    return null;
  }
  return fs.readFileSync(localPath);
};

export const removeLocalStoredFile = (storedUrl: string | null | undefined, requiredRelativePrefix?: string) => {
  if (!storedUrl?.startsWith('local:')) return false;
  const root = getResolvedUploadRoot();
  const localPath = path.resolve(storedUrl.replace('local:', ''));
  if (!isPathInside(root, localPath)) return false;

  if (requiredRelativePrefix) {
    const normalizedRelative = path.relative(root, localPath).replace(/\\/g, '/');
    const normalizedPrefix = requiredRelativePrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalizedRelative.startsWith(`${normalizedPrefix}/`)) return false;
  }

  if (!fs.existsSync(localPath)) return false;
  fs.unlinkSync(localPath);
  return true;
};

export const sanitizeUpstreamError = (fallback: string, raw: string) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown; error?: unknown };
    const detail = typeof parsed.detail === 'string' ? parsed.detail : undefined;
    const error = typeof parsed.error === 'string' ? parsed.error : undefined;
    return detail || error || fallback;
  } catch {
    return fallback;
  }
};

export const redactSensitiveText = (value: unknown) =>
  String(value ?? '')
    .replace(/\b(?:postgresql|postgres|redis|smtp|https?):\/\/[^\s]+/gi, (match) => {
      const scheme = match.split('://')[0];
      return `${scheme}://[redacted]`;
    })
    .replace(/([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*=)([^\s]+)/gi, '$1[redacted]');

export const formatLogError = (error: unknown) =>
  redactSensitiveText(error instanceof Error ? error.message : error || 'UNKNOWN_ERROR');

export const getRequestOrigin = (req: Request) => {
  const origin = req.headers.origin;
  return typeof origin === 'string' ? origin : null;
};
