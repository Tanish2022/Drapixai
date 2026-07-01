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

export const getUploadRoot = () => process.env.DRAPIXAI_UPLOAD_DIR || 'uploads';

const getResolvedUploadRoot = () => path.resolve(getUploadRoot());

const isPathInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

export const getRequestOrigin = (req: Request) => {
  const origin = req.headers.origin;
  return typeof origin === 'string' ? origin : null;
};
