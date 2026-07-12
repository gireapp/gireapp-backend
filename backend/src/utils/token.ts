// ─────────────────────────────────────────────────
// GIREAPP — Session & One-Time Token Utilities
// JWT signing (shared JwtPayload contract) + hashed-at-rest tokens
// ─────────────────────────────────────────────────

import { createHash, randomBytes } from 'crypto';
import { Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AcademicLevel, Role } from '@gireapp/shared';

if (!process.env.AUTH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('AUTH_SECRET environment variable is required in production');
}

const JWT_SECRET = process.env.AUTH_SECRET || 'fallback-dev-secret-change-me';

export interface SessionClaims {
  userId: string;
  role: Role;
  email: string;
  academicLevel: AcademicLevel | null;
  department: string | null;
  isOnboardingComplete: boolean;
}

/** Sign the session JWT — payload must exactly match the shared `JwtPayload` contract */
export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: '24h', subject: claims.userId });
}

/** Set the httpOnly session cookie (frontend also reads `token` from the JSON body) */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
}

/** Random 32-byte one-time token. Only the hash is stored at rest. */
export function generateOneTimeToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

/** SHA-256 hash for storing/looking up one-time tokens */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
