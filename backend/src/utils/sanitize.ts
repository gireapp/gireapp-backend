// ─────────────────────────────────────────────────
// GIREAPP — Input Sanitisation Utility (BE-SEC-005)
// Escapes XSS tags; flags (but does not rewrite) SQL-looking input
// ─────────────────────────────────────────────────

/**
 * SQL injection patterns used for threat *detection* only (see `detectThreats`).
 * Not used to rewrite input — Prisma parameterises all queries, so there is
 * no injection risk to mitigate here, and stripping these tokens from
 * sanitizeString/sanitizeRichText corrupts legitimate content (e.g. a name
 * or message that happens to contain "select" or "delete").
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|TRUNCATE|DECLARE|CAST)\b\s)/gi,
  /(--|;|\/\*|\*\/|xp_|sp_)/gi,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi,     // OR 1=1, AND 1=1
  /(0x[0-9a-fA-F]+)/g,                       // Hex-encoded strings
  /(\bCHAR\s*\(\d+\))/gi,                    // CHAR() encoding
  /(WAITFOR\s+DELAY|BENCHMARK\s*\()/gi,      // Time-based injection
  /(\bINFORMATION_SCHEMA\b)/gi,              // Schema enumeration
];

/**
 * XSS patterns to neutralise in user input.
 * Strips script tags, event handlers, javascript: URIs, data: URIs.
 */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<iframe\b[^>]*>/gi,
  /<object\b[^>]*>/gi,
  /<embed\b[^>]*>/gi,
  /<link\b[^>]*>/gi,
  /on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi,  // onerror=, onclick=, etc.
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  /expression\s*\(/gi,                          // CSS expression()
];

/**
 * Sanitise a single string value:
 * 1. Strip XSS patterns
 * 2. Escape XSS-relevant HTML entities
 * 3. Trim whitespace
 */
export function sanitizeString(input: string): string {
  let sanitized = input;

  // Strip XSS patterns
  for (const pattern of XSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Escape remaining HTML entities that could be dangerous
  sanitized = sanitized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized.trim();
}

/**
 * Sanitise a string but preserve basic markdown formatting.
 * Used for rich-text fields like lesson content and quiz explanations.
 * Strips XSS but keeps markdown-safe characters.
 */
export function sanitizeRichText(input: string): string {
  let sanitized = input;

  // Strip only dangerous XSS patterns (keep markdown-safe HTML like <em>, <strong>)
  for (const pattern of XSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  return sanitized.trim();
}

/**
 * Recursively sanitise all string values in a JSON-like object.
 * Handles nested objects and arrays.
 * Fields listed in `richTextFields` use the markdown-safe sanitizer.
 */
export function sanitizeObject<T>(
  obj: T,
  richTextFields: string[] = ['content', 'explanation', 'message']
): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeString(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, richTextFields)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && richTextFields.includes(key)) {
        sanitized[key] = sanitizeRichText(value);
      } else {
        sanitized[key] = sanitizeObject(value, richTextFields);
      }
    }
    return sanitized as T;
  }

  return obj;
}

/**
 * Validate that a request body doesn't contain common attack payloads.
 * Returns an array of detected threat types (empty = safe).
 */
export function detectThreats(input: string): string[] {
  const threats: string[] = [];

  // Check for SQL injection
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      threats.push('sql_injection');
      break;
    }
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
  }

  // Check for XSS
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(input)) {
      threats.push('xss');
      break;
    }
    pattern.lastIndex = 0;
  }

  return threats;
}
