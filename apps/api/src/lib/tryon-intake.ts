import type { RequestHandler } from 'express';
import { observeTryOnIntakeRejection } from './operational-metrics';

export const isTryOnIntakeEnabled = () => {
  const configured = String(process.env.DRAPIXAI_TRYON_INTAKE_ENABLED || '').trim();
  if (configured === '1') return true;
  if (configured === '0') return false;
  return process.env.NODE_ENV !== 'production';
};

export const requireTryOnIntake: RequestHandler = (_req, res, next) => {
  if (isTryOnIntakeEnabled()) return next();
  observeTryOnIntakeRejection();
  res.setHeader('Retry-After', '60');
  res.setHeader('x-drapixai-intake-status', 'paused');
  return res.status(503).json({
    error: 'TRYON_TEMPORARILY_UNAVAILABLE',
    message: 'Virtual try-on is temporarily unavailable. Please retry shortly.',
  });
};
