import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@gireapp/shared';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../config/env';

/** Request that has passed `requireAuth` — `user` is the verified JWT payload */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
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

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    (req as AuthenticatedRequest).user = payload as JwtPayload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
    return;
  }
};
