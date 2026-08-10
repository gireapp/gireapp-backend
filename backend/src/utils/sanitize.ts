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
  // Statement *shapes*, not bare keywords. A keyword followed only by whitespace
  // matches ordinary language — "Union Ekpo", "Cast Iron", "Drop Anchor" were all
  // rejected — so each verb must be accompanied by the syntax real SQL requires.
  /\bUNION\s+(?:ALL\s+)?SELECT\b/gi,
  /\bSELECT\b[\s\S]{0,120}?\bFROM\b/gi,
  /\bINSERT\s+INTO\b/gi,
  /\bUPDATE\b[\s\S]{0,120}?\bSET\b/gi,
  /\bDELETE\s+FROM\b/gi,
  /\b(?:DROP|CREATE|ALTER|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b/gi,
  /\b(?:EXEC|EXECUTE)\s*\(/gi,
  /\bDECLARE\s+@/gi,
  /\bCAST\s*\(/gi,
  /(--|;|\/\*|\*\/|xp_|sp_)/gi,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi,     // OR 1=1, AND 1=1
  // Word-bounded so it matches a standalone hex literal (`SELECT 0x414243`) and
  // not "0x…" buried inside an ordinary token — randomly generated email aliases
  // (e.g. Firefox Relay masks) routinely contain such a substring.
  /\b0x[0-9a-fA-F]+\b/g,                     // Hex-encoded strings
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
/**
 * `RegExp.test()` on a /g/ pattern advances `lastIndex` and leaves it there, so
 * these shared module-level patterns carry state between calls. Resetting before
 * every test is what makes detection deterministic — previously a match left the
 * index dirty (the old reset only ran when the test *failed*), and the next
 * request scanned from that offset, so identical input alternated between
 * blocked and allowed on successive attempts.
 */
function matchesAnyPattern(patterns: RegExp[], input: string): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}

export function detectThreats(input: string): string[] {
  const threats: string[] = [];

  if (matchesAnyPattern(SQL_INJECTION_PATTERNS, input)) {
    threats.push('sql_injection');
  }

  if (matchesAnyPattern(XSS_PATTERNS, input)) {
    threats.push('xss');
  }

  return threats;
}

/**
 * Credentials are never scanned. They are bcrypt-hashed or looked up by SHA-256
 * hash and never interpolated anywhere, so scanning buys nothing — while a
 * high-entropy password trips `;`, `--` or a hex run purely by chance, and the
 * user gets "suspicious input" with no way to tell which field is at fault.
 */
const UNSCANNED_CREDENTIAL_FIELDS = new Set([
  'password',
  'confirmPassword',
  'currentPassword',
  'newPassword',
  'token',
]);

/**
 * Fields whose Zod schema pins them to a closed format — an email address, a
 * parseable date, an enum member. A value that satisfies those checks has no
 * room left to carry a payload, so scanning it only produces false positives
 * (randomly generated email aliases were being rejected).
 */
const UNSCANNED_SCHEMA_FIELDS = new Set([
  'email',
  'guardianEmail',
  'dateOfBirth',
  'academicLevel',
  'moodTheme',
]);

function isUnscannedField(key: string): boolean {
  return UNSCANNED_CREDENTIAL_FIELDS.has(key) || UNSCANNED_SCHEMA_FIELDS.has(key);
}

function visitScannableStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) visitScannableStrings(item, visit);
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isUnscannedField(key)) continue;
      visitScannableStrings(nested, visit);
    }
  }
}

/**
 * Threat-scan a request body field by field.
 *
 * Scanning `JSON.stringify(body)` as one blob meant the structural punctuation
 * and neighbouring fields could combine into a match that exists in no single
 * value, and it swept in credentials and schema-validated fields alongside the
 * free text that actually warrants checking.
 */
export function detectThreatsInBody(body: unknown): string[] {
  const threats = new Set<string>();

  visitScannableStrings(body, (text) => {
    for (const threat of detectThreats(text)) threats.add(threat);
  });

  return [...threats];
}
