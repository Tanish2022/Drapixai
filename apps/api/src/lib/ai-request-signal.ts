import type { Request, Response } from 'express';

const signals = new WeakMap<Request, AbortSignal>();
export const aiRequestSignal = (req: Request, res: Response): AbortSignal => {
  const existing = signals.get(req); if (existing) return existing;
  const controller = new AbortController(); signals.set(req, controller.signal);
  const clean = () => { req.removeListener('aborted', abort); res.removeListener('close', closed); res.removeListener('finish', clean); };
  const abort = () => { controller.abort(new Error('AI_REQUEST_ABORTED')); clean(); };
  const closed = () => { if (!res.writableFinished) abort(); else clean(); };
  req.once('aborted', abort); res.once('close', closed); res.once('finish', clean);
  if (req.aborted || (res.destroyed && !res.writableFinished)) abort();
  return controller.signal;
};
