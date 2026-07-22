import path from 'path';
import fs from 'fs';
import type { Request } from 'express';
import sharp from 'sharp';

export const PASSWORD_HASH_ROUNDS = 12;

export const validatePasswordStrength = (value: unknown) => {
  const password = String(value || '');
  if (password.length < 12) return 'PASSWORD_TOO_SHORT';
  if (password.length > 128) return 'PASSWORD_TOO_LONG';
  if (!/[a-z]/.test(password)) return 'PASSWORD_REQUIRES_LOWERCASE';
  if (!/[A-Z]/.test(password)) return 'PASSWORD_REQUIRES_UPPERCASE';
  if (!/[0-9]/.test(password)) return 'PASSWORD_REQUIRES_NUMBER';
  if (!/[^A-Za-z0-9]/.test(password)) return 'PASSWORD_REQUIRES_SYMBOL';
  return null;
};

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

export const isAllowedImageFileContent = async (
  file: Express.Multer.File,
  limits: { maxPixels?: number; maxDimension?: number } = {},
) => {
  if (!file?.path || !fs.existsSync(file.path)) return false;
  const fd = fs.openSync(file.path, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    const detected = detectImageMimeType(header.subarray(0, bytesRead));
    if (!detected || detected !== normalizeImageMimeType(file.mimetype)) return false;
  } finally {
    fs.closeSync(fd);
  }

  const configuredMaxPixels = Number(process.env.DRAPIXAI_MAX_IMAGE_PIXELS || 40_000_000);
  const configuredMaxDimension = Number(process.env.DRAPIXAI_MAX_IMAGE_DIMENSION || 10_000);
  const maxPixels = Math.max(1, Math.floor(limits.maxPixels ?? configuredMaxPixels));
  const maxDimension = Math.max(1, Math.floor(limits.maxDimension ?? configuredMaxDimension));
  try {
    const metadata = await sharp(file.path, {
      animated: false,
      failOn: 'error',
      limitInputPixels: maxPixels,
    }).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const pages = Number(metadata.pages || 1);
    return width > 0
      && height > 0
      && width <= maxDimension
      && height <= maxDimension
      && width * height <= maxPixels
      && pages === 1;
  } catch {
    return false;
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
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(dpx(?:st|pv)?_[A-Za-z0-9_-]{12,})\b/g, '[redacted-api-key]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/(cookie|set-cookie)(\s*:\s*)[^\r\n]+/gi, '$1$2[redacted]')
    .replace(/("?(?:person|cloth|image)_image_base64"?\s*[:=]\s*"?)[A-Za-z0-9+/=]{32,}/gi, '$1[redacted]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[redacted]')
    .replace(/\b(?:postgresql|postgres|redis|smtp|https?):\/\/[^\s]+/gi, (match) => {
      const scheme = match.split('://')[0];
      return `${scheme}://[redacted]`;
    })
    .replace(/([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*=)([^\s]+)/gi, '$1[redacted]');

export const formatLogError = (error: unknown) => {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    const code = typeof errorWithCode.code === 'string' ? errorWithCode.code.trim() : '';
    const message = error.message.trim();
    const fallback = error.name && error.name !== 'Error' ? error.name : 'UNKNOWN_ERROR';
    return redactSensitiveText([code, message || fallback].filter(Boolean).join(': '));
  }
  return redactSensitiveText(error || 'UNKNOWN_ERROR');
};

export const getRequestOrigin = (req: Request) => {
  const origin = req.headers.origin;
  return typeof origin === 'string' ? origin : null;
};
