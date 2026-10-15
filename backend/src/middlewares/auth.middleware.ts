import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload, Role } from '@gireapp/shared';
import { calculateAge } from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../config/env';
import { logger } from '../utils/logger';

/** Request that has passed `requireAuth` — `user` is the verified JWT payload */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * A token is stale once the account's password has changed under it.
 *
 * `iat` is whole seconds, so the cut-off is floored to seconds too: a token
 * minted in the same second as the reset is honoured rather than rejected,
 * which keeps the user's own fresh post-reset login working. The cost is a
 * sub-second window in which an old token still passes — far cheaper than
 * signing someone out of the session they just created.
 */
export function isTokenStale(
  issuedAtSeconds: number | undefined,
  passwordChangedAt: Date | null
): boolean {
  if (!passwordChangedAt) return false;
  if (issuedAtSeconds === undefined) return true;

  return issuedAtSeconds < Math.floor(passwordChangedAt.getTime() / 1000);
}

/** The session token from the cookie, or failing that a Bearer header. */
export function sessionTokenOf(req: Request): string | undefined {
  const cookieToken: unknown = req.cookies?.token;
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.split(' ')[1];

  return undefined;
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = sessionTokenOf(req);

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JwtPayload;
  } catch (error) {
    const expired = error instanceof Error && error.name === 'TokenExpiredError';
    res.status(401).json({
      error: expired ? 'Session expired. Please log in again.' : 'Unauthorized: Invalid token',
    });
    return;
  }

  try {
    // A valid signature only proves the token was ours when minted. The account
    // behind it may since have been deleted, or had its password changed.
    const account = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { deletedAt: true, passwordChangedAt: true },
    });

    if (!account || account.deletedAt) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    if (isTokenStale(payload.iat, account.passwordChangedAt)) {
      logger.security('Rejected token issued before the last password change', {
        userId: payload.userId,
        ip: req.ip,
      });
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }

    (req as AuthenticatedRequest).user = payload;
    next();
  } catch (error) {
    logger.error('Auth middleware error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/** Roles allowed through `/api/admin/*`. */
const STAFF_ROLES: Role[] = ['TUTOR', 'ADMIN'];

/**
 * BE-ADMIN-001. Runs after `requireAuth`, so the token is already verified and
 * the account already checked for deletion and stale credentials. This adds the
 * role gate and records every rejection in the security audit log.
 */
export const requireStaff = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as AuthenticatedRequest).user;

  if (!user || !STAFF_ROLES.includes(user.role)) {
    logger.security('Staff route blocked — insufficient role', {
      userId: user?.userId ?? 'anonymous',
      role: user?.role ?? 'none',
      path: req.originalUrl,
      ip: req.ip,
    });
    res.status(403).json({ error: 'Forbidden: staff access required.' });
    return;
  }

  next();
};

/**
 * Guardian-consent gate for Mentorship (NDPA 2023 / POPIA / Ghana Act 843).
 * Runs after `requireAuth`. Academic access — courses, assessments, gamification —
 * is never routed through this; only adult contact is.
 *
 * The live row decides rather than the JWT claim: a guardian confirms hours or
 * days after the learner's 24h token was minted, and gating on the stale claim
 * would leave Mentorship locked until the learner happened to log in again.
 * Adults skip the lookup entirely on the strength of the token.
 */
export const requireGuardianConsent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  if (!user.isMinor) {
    next();
    return;
  }

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { dateOfBirth: true, guardianConsentStatus: true },
  });

  if (!row) {
    res.status(401).json({ error: 'Unauthorized: account not found.' });
    return;
  }

  // Recomputed from the row so a learner who has since turned 18 is not held
  // behind a consent gate that no longer applies to them.
  const isMinor = row.dateOfBirth ? calculateAge(row.dateOfBirth) < 18 : false;

  if (!isMinor || row.guardianConsentStatus === 'confirmed') {
    next();
    return;
  }

  logger.security('Mentorship blocked — guardian consent outstanding', {
    userId: user.userId,
    guardianConsentStatus: row.guardianConsentStatus,
    path: req.originalUrl,
    ip: req.ip,
  });

  res.status(403).json({
    error:
      'Mentorship needs a guardian to confirm this account first. Everything else stays available.',
    guardianConsentStatus: row.guardianConsentStatus,
  });
};
