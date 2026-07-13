// ─────────────────────────────────────────────────
// GIREAPP — Environment Configuration
// Single source of truth for env loading + validated secrets.
// Import this module FIRST (before anything that reads process.env
// at module scope) — imports are hoisted, so dotenv must load here,
// not in server.ts.
// ─────────────────────────────────────────────────

import dotenv from 'dotenv';

// .env.local wins over .env; Prisma CLI (migrate/db push) only reads .env
dotenv.config({ path: ['.env.local', '.env'] });

const IS_TEST = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

if (!process.env.AUTH_SECRET && !IS_TEST) {
  throw new Error(
    'AUTH_SECRET environment variable is required (generate with: openssl rand -base64 32). ' +
      'It must be byte-for-byte identical to the frontend AUTH_SECRET.'
  );
}

/** HS256 signing secret — shared with the frontend (jose) */
export const JWT_SECRET: string = process.env.AUTH_SECRET || 'vitest-only-secret';

/** JWT issuer/audience claims — reject tokens minted by/for other services */
export const JWT_ISSUER = 'gireapp-backend';
export const JWT_AUDIENCE = 'gireapp-frontend';
