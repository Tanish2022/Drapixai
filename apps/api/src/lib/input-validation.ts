import type { NextFunction, Request, Response } from 'express';

const MAX_JSON_DEPTH = 12;
const MAX_JSON_KEYS = 200;
const MAX_STRING_BYTES = 64 * 1024;
const BINARY_FIELDS = new Set(['person_image_base64', 'cloth_image_base64', 'image_base64']);
const PLAIN_TEXT_FIELD_LIMITS: Record<string, number> = {
  companyName: 160,
  mobileNumber: 32,
  name: 120,
  reason: 500,
  notes: 2_000,
  product_name: 250,
  display_name: 250,
  garment_id: 120,
  garment_profile: 120,
  category: 80,
  appId: 120,
};

const hasUnsafeControlCharacter = (value: string) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/.test(value);
const hasMarkup = (value: string) => /<\s*\/?\s*[a-z!][^>]*>/i.test(value);
const looksLikeExecutableQuery = (value: string) => /^\s*(?:(?:select\b[\s\S]{0,160}\bfrom\b)|(?:insert\b[\s\S]{0,160}\binto\b)|(?:update\b[\s\S]{0,160}\bset\b)|(?:delete\b[\s\S]{0,160}\bfrom\b)|(?:drop|alter|create|grant|revoke)\s+(?:table|database|role|user|schema)\b|(?:query|mutation)\s*(?:\(|\{)|(?:curl|wget|powershell|bash)\b)/i.test(value);

export type InputValidationFailure = {
  code: 'INPUT_TOO_COMPLEX' | 'INVALID_INPUT_STRUCTURE' | 'INPUT_MUST_BE_PLAIN_TEXT';
};

const plainTextFailure = (value: string, maxBytes: number): InputValidationFailure | null => {
  if (Buffer.byteLength(value, 'utf8') > maxBytes || hasUnsafeControlCharacter(value) || hasMarkup(value) || looksLikeExecutableQuery(value)) {
    return { code: 'INPUT_MUST_BE_PLAIN_TEXT' };
  }
  return null;
};

export const validateRequestInput = (value: unknown, fieldName = '', depth = 0): InputValidationFailure | null => {
  if (depth > MAX_JSON_DEPTH) return { code: 'INPUT_TOO_COMPLEX' };
  if (typeof value === 'string') {
    if (hasUnsafeControlCharacter(value)) return { code: 'INVALID_INPUT_STRUCTURE' };
    if (!BINARY_FIELDS.has(fieldName) && Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) {
      return { code: 'INPUT_TOO_COMPLEX' };
    }
    const plainTextLimit = PLAIN_TEXT_FIELD_LIMITS[fieldName];
    return plainTextLimit ? plainTextFailure(value, plainTextLimit) : null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_KEYS) return { code: 'INPUT_TOO_COMPLEX' };
    for (const item of value) {
      const failure = validateRequestInput(item, '', depth + 1);
      if (failure) return failure;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_JSON_KEYS) return { code: 'INPUT_TOO_COMPLEX' };
  for (const [key, item] of entries) {
    if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor' || key.includes('.') || key.startsWith('$')) {
      return { code: 'INVALID_INPUT_STRUCTURE' };
    }
    const failure = validateRequestInput(item, key, depth + 1);
    if (failure) return failure;
  }
  return null;
};

export const inputValidationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const failure = validateRequestInput(req.body);
  if (failure) return res.status(400).json({ error: failure.code });
  return next();
};

export const validateMultipartFields = (value: unknown): InputValidationFailure | null => validateRequestInput(value);
