import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@adsight/types';

/**
 * Error responses share one shape so the client has a single place to read them.
 * Validation problems are keyed by field path, which is what lets the create
 * form highlight the offending input instead of showing a generic toast.
 */

export function sendValidationError(
  res: Response,
  message: string,
  fields?: Record<string, string>,
): void {
  const body: ApiErrorBody = {
    error: { code: 'VALIDATION_FAILED', message, ...(fields ? { fields } : {}) },
  };
  res.status(400).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
}

/**
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code can `await` without try/catch around everything.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  const detail = error instanceof Error ? error.message : String(error);
  if (!isProd) {
    process.stderr.write(`[api] unhandled: ${error instanceof Error ? error.stack : detail}\n`);
  }

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      // Don't leak internals in production, but keep them in dev where the
      // alternative is guessing from a 500.
      message: isProd ? 'Something went wrong handling this request' : detail,
    },
  };
  res.status(500).json(body);
}
