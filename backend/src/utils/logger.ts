// ─────────────────────────────────────────────────
// GIREAPP — Secure Logger (Phase 4: BE-SEC-LOG)
// PII-safe structured logging with redaction
// ─────────────────────────────────────────────────

/**
 * Fields that must NEVER appear in logs (NDPR/POPIA compliance).
 * Values are replaced with '[REDACTED]' before writing.
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'authorization',
  'cookie',
  'verificationToken',
  'resetToken',
  'secret',
  'creditCard',
  'ssn',
  'AUTH_SECRET',
  'AWS_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
]);

/**
 * Fields containing PII that are partially masked in logs.
 * Email: j***@example.com, Name: kept but flagged.
 */
const PII_FIELDS = new Set(['email', 'name']);

type LogLevel = 'info' | 'warn' | 'error' | 'security';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  referenceId?: string;
  [key: string]: unknown;
}

/**
 * Mask an email address for safe logging.
 * "jane.doe@example.com" → "j***@example.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[REDACTED_EMAIL]';
  return `${local[0]}***@${domain}`;
}

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object safe for logging — never mutates the original.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(lowerKey)) {
        redacted[key] = '[REDACTED]';
      } else if (PII_FIELDS.has(lowerKey) && typeof value === 'string') {
        redacted[key] = lowerKey === 'email' ? maskEmail(value) : value;
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Generate a short unique reference ID for error tracking.
 * Format: "ref-<timestamp>-<random>" (safe to share with users).
 */
export function generateReferenceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `ref-${ts}-${rand}`;
}

/**
 * Core structured logger.
 * Always outputs JSON for easy parsing by log aggregators (CloudWatch, Datadog, etc.)
 */
function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactSensitiveData(meta || {}) as Record<string, unknown>,
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
    case 'security':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

/**
 * Public logger API.
 * Usage:
 *   logger.info('User logged in', { userId: '123' });
 *   logger.security('Failed login attempt', { ip: '1.2.3.4', email: 'jane@ex.com' });
 *   logger.error('Database connection failed', { error: err.message, referenceId });
 */
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => writeLog('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => writeLog('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => writeLog('error', message, meta),
  security: (message: string, meta?: Record<string, unknown>) => writeLog('security', message, meta),
};
