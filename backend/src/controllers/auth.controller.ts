import { Request, Response } from 'express';
import { hash, compare } from 'bcryptjs';
import { prisma } from '../services/prisma';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  onboardingSchema,
} from '@gireapp/shared';
import type { AcademicLevel, SessionUser } from '@gireapp/shared';
import { sanitizeObject, detectThreats } from '../utils/sanitize';
import {
  signSessionToken,
  setSessionCookie,
  generateOneTimeToken,
  hashToken,
} from '../utils/token';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email';
import { logger } from '../utils/logger';

/** Registration wizard `track` values → AcademicLevel enum */
export const TRACK_TO_ACADEMIC_LEVEL: Record<string, AcademicLevel> = {
  Secondary: 'SECONDARY',
  Tertiary: 'TERTIARY',
  Professional: 'PROFESSIONAL',
};

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Dev/testing escape hatch: auto-verifies new accounts and auto-logs-in on register.
// Must NEVER be set in production — real users must verify their email.
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';

const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  academicLevel: true,
  department: true,
  moodTheme: true,
  points: true,
  image: true,
} as const;

type SessionUserRow = {
  id: string;
  name: string;
  email: string;
  role: SessionUser['role'];
  academicLevel: AcademicLevel | null;
  department: string | null;
  moodTheme: string | null;
  points: number;
  image: string | null;
};

function toSessionUser(user: SessionUserRow): SessionUser {
  return {
    ...user,
    isOnboardingComplete: Boolean(user.academicLevel && user.department),
  };
}

/** Threat-detect + sanitise a request body; returns null (and responds 400) when blocked */
function screenBody(req: Request, res: Response, context: string): unknown | null {
  const threats = detectThreats(JSON.stringify(req.body));
  if (threats.length > 0) {
    logger.security(`${context} blocked — threat detected`, {
      threats,
      ip: req.ip,
    });
    res.status(400).json({ error: 'Request blocked due to suspicious input.' });
    return null;
  }
  return sanitizeObject(req.body);
}

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── 1. Threat detection (BE-SEC-005) + sanitise ──
    const sanitizedBody = screenBody(req, res, 'Registration');
    if (sanitizedBody === null) return;

    // ── 2. Validate with Zod ──
    const result = registerSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { name, email, password, track, department } = result.data;

    // ── 3. Check for duplicate email ──
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    // ── 4. Hash password (bcrypt cost ≥ 12) ──
    const passwordHash = await hash(password, 12);

    // ── 5. Generate verification token (hashed at rest, 24h expiry) ──
    const verification = generateOneTimeToken();

    // ── 6. Map onboarding selection from the signup wizard ──
    const academicLevel = track ? TRACK_TO_ACADEMIC_LEVEL[track] ?? null : null;

    // ── 7. Create user ──
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email,
        passwordHash,
        academicLevel,
        department: department || null,
        verificationToken: verification.hash,
        verificationExpiry: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
        emailVerified: SKIP_EMAIL_VERIFICATION ? new Date() : null,
      },
      select: sessionUserSelect,
    });

    const sessionUser = toSessionUser(user);

    // ── 8. Dev flag on: auto-login with { user, token } ──
    if (SKIP_EMAIL_VERIFICATION) {
      const token = signSessionToken({
        userId: user.id,
        role: user.role,
        email: user.email,
        academicLevel: user.academicLevel,
        department: user.department,
        isOnboardingComplete: sessionUser.isOnboardingComplete,
      });

      setSessionCookie(res, token);
      res.status(201).json({
        message: 'Account created successfully.',
        user: sessionUser,
        token,
      });
      return;
    }

    // ── 8. Production: send verification email; no session until verified ──
    sendVerificationEmail(email, user.name, verification.raw).catch((err) => {
      logger.error('Failed to send verification email', {
        errorMessage: (err as Error).message,
        userId: user.id,
      });
    });

    res.status(201).json({
      message: 'Account created successfully. Please check your inbox to verify your email address.',
      user: sessionUser,
    });
  } catch (error) {
    logger.error('Registration error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    // ── 1. Threat detection (BE-SEC-005) + sanitise ──
    const sanitizedBody = screenBody(req, res, 'Login');
    if (sanitizedBody === null) return;

    // ── 2. Validate with Zod ──
    const result = loginSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = result.data;

    // ── 3. Find user ──
    const user = await prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: {
        ...sessionUserSelect,
        passwordHash: true,
        emailVerified: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    // Unified error message to prevent user enumeration (OWASP)
    if (!user || !user.passwordHash) {
      logger.security('Failed login attempt — user not found or no password', {
        ip: req.ip,
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // ── 4. Account lockout (BE-SEC-H3) ──
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      logger.security('Login blocked — account locked', {
        userId: user.id,
        ip: req.ip,
        lockedUntil: user.lockedUntil,
      });
      res.status(429).json({ error: 'Too many failed login attempts. Please try again later.' });
      return;
    }

    // ── 5. Check email verification ──
    if (!user.emailVerified) {
      res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox.' });
      return;
    }

    // ── 6. Verify password ──
    const isValid = await compare(password, user.passwordHash);
    if (!isValid) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });
      logger.security('Failed login attempt — wrong password', {
        userId: user.id,
        ip: req.ip,
        attempts,
        locked: shouldLock,
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Reset lockout state on a successful login
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // ── 7. Sign JWT (24h expiry), set cookie, return { user, token } ──
    const { passwordHash: _ph, emailVerified: _ev, ...profile } = user;
    const sessionUser = toSessionUser(profile);
    const token = signSessionToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      academicLevel: user.academicLevel,
      department: user.department,
      isOnboardingComplete: sessionUser.isOnboardingComplete,
    });

    setSessionCookie(res, token);
    res.status(200).json({ user: sessionUser, token });
  } catch (error) {
    logger.error('Login error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  res.cookie('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0), // Expire immediately
  });
  res.status(200).json({ message: 'Logged out successfully' });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId, deletedAt: null },
      select: sessionUserSelect,
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account not found' });
      return;
    }

    res.status(200).json(toSessionUser(user));
  } catch (error) {
    logger.error('Me error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const sanitizedBody = screenBody(req, res, 'Forgot-password');
    if (sanitizedBody === null) return;

    const result = forgotPasswordSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { email } = result.data;

    const user = await prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: { id: true, name: true },
    });

    if (user) {
      const reset = generateOneTimeToken();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: reset.hash,
          resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      // Fire-and-forget so response time doesn't leak whether the email exists
      sendPasswordResetEmail(email, user.name, reset.raw).catch((err) => {
        logger.error('Failed to send password reset email', {
          errorMessage: (err as Error).message,
          userId: user.id,
        });
      });
    } else {
      logger.security('Password reset requested for unknown email', { ip: req.ip });
    }

    // Always 200 — enumeration-safe (the frontend assumes this)
    res.status(200).json({
      message: 'If an account exists for that email, a reset link has been sent.',
    });
  } catch (error) {
    logger.error('Forgot-password error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const sanitizedBody = screenBody(req, res, 'Reset-password');
    if (sanitizedBody === null) return;

    const result = resetPasswordSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { token, password } = result.data;

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashToken(token),
        resetTokenExpiry: { gt: new Date() },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      logger.security('Password reset attempt with invalid or expired token', { ip: req.ip });
      res.status(422).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
      return;
    }

    const passwordHash = await hash(password, 12);

    // Single-use: clear the token alongside the new hash
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    logger.error('Reset-password error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const sanitizedBody = screenBody(req, res, 'Verify-email');
    if (sanitizedBody === null) return;

    const token = (sanitizedBody as { token?: unknown })?.token;
    if (typeof token !== 'string' || token.length === 0) {
      res.status(400).json({ error: 'Verification token is required.' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: hashToken(token),
        verificationExpiry: { gt: new Date() },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      res.status(400).json({ error: 'This verification link is invalid or has expired.' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        verificationToken: null,
        verificationExpiry: null,
      },
    });

    res.status(200).json({ message: 'Email verified successfully. You can now log in.' });
  } catch (error) {
    logger.error('Verify-email error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const onboarding = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const sanitizedBody = screenBody(req, res, 'Onboarding');
    if (sanitizedBody === null) return;

    const result = onboardingSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { academicLevel, department, moodTheme } = result.data;

    const user = await prisma.user.update({
      where: { id: payload.userId, deletedAt: null },
      data: { academicLevel, department, moodTheme },
      select: sessionUserSelect,
    });

    // Re-sign the JWT with the updated claims so the frontend refreshes its session
    const sessionUser = toSessionUser(user);
    const token = signSessionToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      academicLevel: user.academicLevel,
      department: user.department,
      isOnboardingComplete: sessionUser.isOnboardingComplete,
    });

    setSessionCookie(res, token);
    res.status(200).json({ user: sessionUser, token });
  } catch (error) {
    logger.error('Onboarding error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
