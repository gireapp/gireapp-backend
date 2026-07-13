// ─────────────────────────────────────────────────
// GIREAPP — HTTP Request Logger Middleware (Phase 4)
// PII-safe request logging with response time tracking
// ─────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import type { AuthenticatedRequest } from './auth.middleware';

/**
 * Paths to exclude from request logging (e.g., health checks generate noise).
 */
const EXCLUDED_PATHS = new Set(['/api/health']);

/**
 * HTTP request logger middleware.
 *
 * Logs every incoming request with:
 * - Method, path, status code, response time
 * - IP address (for security monitoring)
 * - User ID (if authenticated, from JWT payload)
 *
 * Sensitive data (request body, cookies, auth headers) is NEVER logged.
 * Failed auth attempts (401/403) are logged at 'security' level.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Skip noisy health check endpoints
  if (EXCLUDED_PATHS.has(req.originalUrl)) {
    next();
    return;
  }

  const start = Date.now();

  // Hook into the response finish event to capture status code and timing
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const userId = (req as Partial<AuthenticatedRequest>).user?.userId || 'anonymous';

    const logData = {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userId,
      userAgent: req.get('User-Agent') || 'unknown',
    };

    // Route security-relevant responses to the security log level
    if (statusCode === 401 || statusCode === 403) {
      logger.security('Auth failure', logData);
    } else if (statusCode >= 500) {
      logger.error('Server error response', logData);
    } else if (statusCode >= 400) {
      logger.warn('Client error response', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
};
