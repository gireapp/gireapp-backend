// ─────────────────────────────────────────────────
// GIREAPP — Frontend origin configuration
//
// Deliberately free of side effects: `config/env` loads dotenv on import, and
// importing that from a service re-populates process.env, which breaks any
// test that clears a variable before importing the module under test. Modules
// that only need these values import this file instead. `server.ts` still
// imports `config/env` first so dotenv has run before these are read.
// ─────────────────────────────────────────────────

const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

/**
 * `FRONTEND_URL` is exactly one canonical origin — it is the base every link in
 * a transactional email is built from, so a list would produce
 * "https://a.com,https://b.com/reset-password?token=…" and silently break
 * verification and password reset. Extra browser origins go in `CORS_ORIGINS`.
 */
export function parseFrontendOrigin(raw: string | undefined): string {
  const value = (raw ?? '').trim() || DEFAULT_FRONTEND_ORIGIN;

  if (value.includes(',')) {
    throw new Error(
      'FRONTEND_URL must be a single origin — it is the base for links in emails. ' +
        'Put additional browser origins in CORS_ORIGINS (comma-separated).'
    );
  }

  // A trailing slash would double up in every emailed link.
  return value.replace(/\/+$/, '');
}

/** Browser origins allowed by CORS. Defaults to the frontend origin alone. */
export function parseCorsOrigins(raw: string | undefined, frontendOrigin: string): string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return configured.length > 0 ? configured : [frontendOrigin];
}

/** Single canonical frontend origin; the base for links in emails. */
export const FRONTEND_ORIGIN = parseFrontendOrigin(process.env.FRONTEND_URL);

/** CORS allowlist — the frontend origin unless CORS_ORIGINS widens it. */
export const CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS, FRONTEND_ORIGIN);
