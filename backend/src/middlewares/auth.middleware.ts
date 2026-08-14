import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload, Role } from '@gireapp/shared';
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

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let token = req.cookies?.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

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
