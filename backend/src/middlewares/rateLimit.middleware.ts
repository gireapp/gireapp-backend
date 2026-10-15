import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { CLIENT_IP_HEADERS, type JwtPayload } from '@gireapp/shared';
import { CLIENT_IP_SECRET, JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../config/env';
import { sessionTokenOf } from './auth.middleware';

const WINDOW_MS = 15 * 60 * 1000;
const ANONYMOUS_REQUESTS_PER_WINDOW = 100;
/**
 * Higher than the anonymous budget because one page in the app fans out to
 * several API calls, and a per-account bucket is never shared with anyone.
 */
const SIGNED_IN_REQUESTS_PER_WINDOW = 300;
const AUTH_ATTEMPTS_PER_WINDOW = 10;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Hashing first gives equal-length buffers, which timingSafeEqual requires. */
function isTrustedForwarder(presentedSecret: string, secret: string): boolean {
  return timingSafeEqual(sha256(presentedSecret), sha256(secret));
}

/**
 * The learner's IP. Almost every request arrives from the frontend's server,
 * so `req.ip` is that server's address; the frontend forwards the learner's
 * own IP beside a shared secret. Without the secret the header is ignored,
 * so a client cannot pick its own bucket.
 */
export function clientIpOf(req: Request, secret: string | undefined): string {
  const fallback = req.ip ?? 'unknown';
  if (!secret) return fallback;

  const presentedSecret = req.get(CLIENT_IP_HEADERS.SECRET);
  const forwardedIp = req.get(CLIENT_IP_HEADERS.IP)?.trim();
  if (!presentedSecret || !forwardedIp || isIP(forwardedIp) === 0) return fallback;

  return isTrustedForwarder(presentedSecret, secret) ? forwardedIp : fallback;
}

/**
 * The account behind a validly signed session, or null. Signature only: the
 * deletion and password-change checks in `requireAuth` cost a database read,
 * and a stale token is still bounded by its own account's budget.
 */
export function signedInUserIdOf(req: Request): string | null {
  const token = sessionTokenOf(req);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JwtPayload;
    return payload.userId || null;
  } catch {
    // An invalid or expired token is simply anonymous traffic here; the route
    // itself answers 401 if it needs a session.
    return null;
  }
}

type RateLimitSubject = { key: string; signedIn: boolean };

/** Memoised per request: the key and the limit both need it. */
const subjects = new WeakMap<Request, RateLimitSubject>();

export function rateLimitSubjectOf(req: Request): RateLimitSubject {
  const known = subjects.get(req);
  if (known) return known;

  const userId = signedInUserIdOf(req);
  const subject = userId
    ? { key: `user:${userId}`, signedIn: true }
    : { key: `ip:${clientIpOf(req, CLIENT_IP_SECRET)}`, signedIn: false };
  subjects.set(req, subject);
  return subject;
}

/** Signed-in traffic is limited per account, everything else per learner IP. */
export const globalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: (req) =>
    rateLimitSubjectOf(req).signedIn ? SIGNED_IN_REQUESTS_PER_WINDOW : ANONYMOUS_REQUESTS_PER_WINDOW,
  keyGenerator: (req) => rateLimitSubjectOf(req).key,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Keyed by IP even when signed in: it guards password guessing, and keying on
 * the account would hand an attacker a fresh budget per stolen session.
 */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: AUTH_ATTEMPTS_PER_WINDOW,
  keyGenerator: (req) => clientIpOf(req, CLIENT_IP_SECRET),
  message: { error: 'Too many authentication attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});
