// ─────────────────────────────────────────────────
// GIREAPP — Global Error Handler (Phase 3: BE-SEC-ERR)
// Catches all unhandled errors, prevents data leakage
// ─────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { logger, generateReferenceId } from '../utils/logger';
import type { AuthenticatedRequest } from './auth.middleware';

/**
 * Known operational error class.
 * Throw this from controllers to return a specific status code + message
 * without leaking implementation details.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 404 handler — must be registered AFTER all route definitions.
 * Catches requests to undefined routes.
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
  logger.warn('Route not found', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });

  res.status(404).json({
    error: 'The requested resource was not found.',
  });
};

/**
 * Global error handler — must be the LAST middleware registered.
 *
 * Rules:
 * 1. NEVER expose stack traces in production.
 * 2. NEVER expose internal error messages (Prisma, DB, etc.) to the client.
 * 3. Always return a referenceId so the user can report the issue and we can trace it in logs.
 * 4. Log the full error internally with the same referenceId for correlation.
 */
export const globalErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const referenceId = generateReferenceId();
  const isProduction = process.env.NODE_ENV === 'production';

  // ── Determine status code ──
  let statusCode = 500;
  let clientMessage = 'An unexpected error occurred. Please try again later.';

  if (err instanceof AppError && err.isOperational) {
    // Known, expected error — safe to forward the message
    statusCode = err.statusCode;
    clientMessage = err.message;
  }

  // ── Detect Prisma-specific errors ──
  // PrismaClientKnownRequestError, PrismaClientValidationError, etc.
  if (err.constructor?.name?.startsWith('PrismaClient')) {
    statusCode = 400;
    clientMessage = 'Invalid request. Please check your input and try again.';

    logger.error('Prisma database error', {
      referenceId,
      prismaErrorName: err.constructor.name,
      message: err.message,
      method: req.method,
      path: req.originalUrl,
      userId: (req as Partial<AuthenticatedRequest>).user?.userId || 'anonymous',
    });
  }

  // body-parser errors carry a `type` discriminator not present on Error
  const bodyParserErrorType = (err as Error & { type?: string }).type;

  // ── Detect JSON parse errors (malformed request body) ──
  if (bodyParserErrorType === 'entity.parse.failed') {
    statusCode = 400;
    clientMessage = 'Malformed request body. Please send valid JSON.';
  }

  // ── Detect payload too large ──
  if (bodyParserErrorType === 'entity.too.large') {
    statusCode = 413;
    clientMessage = 'Request payload is too large.';
  }

  // ── Log full error internally (never to the client) ──
  logger.error('Unhandled error caught by global handler', {
    referenceId,
    statusCode,
    errorName: err.name,
    errorMessage: err.message,
    stack: isProduction ? undefined : err.stack,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: (req as any).user?.userId || 'anonymous',
  });

  // ── Send safe response to client ──
  const response: Record<string, unknown> = {
    error: clientMessage,
    referenceId,
  };

  // In development, attach the stack trace for easier debugging
  if (!isProduction) {
    response.stack = err.stack;
    response.details = err.message;
  }

  res.status(statusCode).json(response);
};
