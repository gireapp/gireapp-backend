import { Request, Response } from 'express';
import { hash, compare } from 'bcryptjs';
import { prisma } from '../services/prisma';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateEmailSchema,
  updateAvatarSchema,
  updateNameSchema,
  resendVerificationSchema,
  onboardingSchema,
  calculateAge,
} from '@gireapp/shared';
import type {
  AcademicLevel,
  SessionUser,
  GuardianConsentStatus,
} from '@gireapp/shared';
import { sanitizeObject, detectThreatsInBody } from '../utils/sanitize';
import {
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
  generateOneTimeToken,
  hashToken,
} from '../utils/token';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sessionUserSelect, toSessionUser } from '../utils/session-user';
import {
  AVATAR_MAX_BYTES,
  allowedAvatarExtensions,
  createAvatarUploadUrl,
  isAllowedAvatar,
  isMintedAvatarKey,
  isStorageConfigured,
  resolveAvatarUrl,
} from '../services/storage';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendGuardianConsentEmail,
  sendEmailChangeVerification,
  sendEmailChangeNotice,
} from '../services/email';
import { logger } from '../utils/logger';

/** Registration wizard `track` values → AcademicLevel enum */
export const TRACK_TO_ACADEMIC_LEVEL: Record<string, AcademicLevel> = {
  Secondary: 'SECONDARY',
  Tertiary: 'TERTIARY',
  Professional: 'PROFESSIONAL',
};

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Per-account gap between verification sends — authLimiter is per-IP, so it
 *  alone can't stop a distributed attempt to flood one person's inbox. */
const RESEND_VERIFICATION_COOLDOWN_MS = 60 * 1000; // 1 minute
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Dev/testing escape hatch: auto-verifies new accounts and auto-logs-in on register.
// Must NEVER be set in production — real users must verify their email.
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';

// Guardians often act days after the learner signs up, so this link outlives the
// 24h email-verification window by a wide margin.
const GUARDIAN_CONSENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Threat-detect + sanitise a request body; returns null (and responds 400) when blocked */
function screenBody(req: Request, res: Response, context: string): unknown | null {
  const threats = detectThreatsInBody(req.body);
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

    const { name, email, password, track, department, dateOfBirth, guardianEmail } =
      result.data;

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

    // ── 5b. Guardian consent: only under-18 accounts need it (NDPA 2023 / POPIA) ──
    const dob = new Date(dateOfBirth);
    const isMinor = calculateAge(dob) < 18;
    // registerSchema already guarantees guardianEmail is present when isMinor.
    const guardianConsent = isMinor ? generateOneTimeToken() : null;

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
        dateOfBirth: dob,
        guardianEmail: isMinor ? guardianEmail ?? null : null,
        guardianConsentStatus: isMinor ? 'pending' : 'not_required',
        guardianConsentToken: guardianConsent?.hash ?? null,
        guardianConsentExpiry: guardianConsent
          ? new Date(Date.now() + GUARDIAN_CONSENT_TOKEN_TTL_MS)
          : null,
      },
      select: sessionUserSelect,
    });

    const sessionUser = await toSessionUser(user);

    // Guardian consent is independent of email verification, so it is requested
    // here rather than inside either branch below. Fire-and-forget: a mail failure
    // must not fail the registration, it only leaves Mentorship locked.
    if (guardianConsent && guardianEmail) {
      sendGuardianConsentEmail(guardianEmail, user.name, guardianConsent.raw).catch((err) => {
        logger.error('Failed to send guardian consent email', {
          errorMessage: (err as Error).message,
          userId: user.id,
        });
      });
    }

    // ── 8. Dev flag on: auto-login with { user, token } ──
    if (SKIP_EMAIL_VERIFICATION) {
      const token = signSessionToken({
        userId: user.id,
        role: user.role,
        email: user.email,
        academicLevel: user.academicLevel,
        department: user.department,
        isOnboardingComplete: sessionUser.isOnboardingComplete,
        isMinor: sessionUser.isMinor,
        guardianConsentStatus: sessionUser.guardianConsentStatus,
      });

      setSessionCookie(res, token);
      res.status(201).json({
        success: true,
        data: {
          message: 'Account created successfully.',
          user: sessionUser,
          token,
        },
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
      success: true,
      data: {
        message: 'Account created successfully. Please check your inbox to verify your email address.',
        user: sessionUser,
      },
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
    const {
      passwordHash: _ph,
      emailVerified: _ev,
      failedLoginAttempts: _fla,
      lockedUntil: _lu,
      ...profile
    } = user;
    const sessionUser = await toSessionUser(profile);
    const token = signSessionToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      academicLevel: user.academicLevel,
      department: user.department,
      isOnboardingComplete: sessionUser.isOnboardingComplete,
      isMinor: sessionUser.isMinor,
      guardianConsentStatus: sessionUser.guardianConsentStatus,
    });

    setSessionCookie(res, token);
    res.status(200).json({ success: true, data: { user: sessionUser, token } });
  } catch (error) {
    logger.error('Login error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  clearSessionCookie(res);
  res.status(200).json({ success: true, data: { message: 'Logged out successfully' } });
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

    res.status(200).json({ success: true, data: await toSessionUser(user) });
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
      success: true,
      data: { message: 'If an account exists for that email, a reset link has been sent.' },
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

    // Single-use: clear the token alongside the new hash. Stamping
    // passwordChangedAt retires every token minted before now, so a reset ends
    // any session an attacker was already holding — and clears the lockout,
    // since the legitimate owner has just proven control of the inbox.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    logger.security('Password reset — existing sessions invalidated', {
      userId: user.id,
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: { message: 'Password reset successfully. You can now log in.' },
    });
  } catch (error) {
    logger.error('Reset-password error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * One-click guardian confirmation. Deliberately idempotent-friendly: an already
 * confirmed link reports success rather than an error, because guardians commonly
 * click the same email twice and a scary failure page is worse than a no-op.
 */
export const confirmGuardianConsent = async (req: Request, res: Response): Promise<void> => {
  try {
    const sanitizedBody = screenBody(req, res, 'Guardian-consent');
    if (sanitizedBody === null) return;

    const token = (sanitizedBody as { token?: unknown })?.token;
    if (typeof token !== 'string' || token.length === 0) {
      res.status(400).json({ error: 'Consent token is required.' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        guardianConsentToken: hashToken(token),
        guardianConsentExpiry: { gt: new Date() },
        deletedAt: null,
      },
      select: { id: true, name: true, guardianConsentStatus: true },
    });

    if (!user) {
      res.status(400).json({ error: 'This consent link is invalid or has expired.' });
      return;
    }

    if (user.guardianConsentStatus === 'confirmed') {
      res.status(200).json({
        success: true,
        data: { message: 'Consent already confirmed. Nothing further is needed.', name: user.name },
      });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        guardianConsentStatus: 'confirmed',
        guardianConsentAt: new Date(),
        // Burn the token so the link cannot be replayed.
        guardianConsentToken: null,
        guardianConsentExpiry: null,
      },
    });

    logger.info('Guardian consent confirmed', { userId: user.id });

    res.status(200).json({
      success: true,
      data: { message: 'Thank you — Mentorship is now available.', name: user.name },
    });
  } catch (error) {
    logger.error('Guardian-consent error', {
      errorMessage: (error as Error).message,
    });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
      // The name is returned so the success screen can greet the user; the link
      // is often opened on a different device, where no local state survives.
      select: { id: true, name: true },
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

    res.status(200).json({
      success: true,
      data: {
        message: 'Email verified successfully. You can now log in.',
        name: user.name,
      },
    });
  } catch (error) {
    logger.error('Verify-email error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  // Mirrors forgotPassword: the response is identical whether or not the account
  // exists, so this endpoint can't be used to enumerate registered emails.
  const neutralResponse = {
    message: 'If that account exists and is unverified, a new verification link has been sent.',
  };

  try {
    const sanitizedBody = screenBody(req, res, 'Resend-verification');
    if (sanitizedBody === null) return;

    const result = resendVerificationSchema.safeParse(sanitizedBody);
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
      select: { id: true, name: true, emailVerified: true, verificationExpiry: true },
    });

    if (!user) {
      logger.security('Verification resend requested for unknown email', { ip: req.ip });
      res.status(200).json({ success: true, data: neutralResponse });
      return;
    }

    if (user.emailVerified) {
      res.status(200).json({ success: true, data: neutralResponse });
      return;
    }

    // The issue time isn't stored, but expiry is always issuedAt + TTL — so the
    // cooldown can be enforced without widening the schema.
    if (user.verificationExpiry) {
      const issuedAt = user.verificationExpiry.getTime() - VERIFICATION_TOKEN_TTL_MS;
      if (Date.now() - issuedAt < RESEND_VERIFICATION_COOLDOWN_MS) {
        logger.security('Verification resend throttled by cooldown', {
          userId: user.id,
          ip: req.ip,
        });
        res.status(200).json({ success: true, data: neutralResponse });
        return;
      }
    }

    // Issuing a new token invalidates the previous link — a resend must not
    // leave two working verification URLs in the user's inbox.
    const verification = generateOneTimeToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: verification.hash,
        verificationExpiry: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    // Fire-and-forget so response time doesn't leak whether the email exists
    sendVerificationEmail(email, user.name, verification.raw).catch((err) => {
      logger.error('Failed to resend verification email', {
        errorMessage: (err as Error).message,
        userId: user.id,
      });
    });

    res.status(200).json({ success: true, data: neutralResponse });
  } catch (error) {
    logger.error('Resend-verification error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Change the password from inside the account. The reset flow proves identity
 * by email; here the current password is the proof, so it must be checked
 * before anything is written — otherwise a stolen session silently becomes a
 * stolen account.
 */
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const sanitizedBody = screenBody(req, res, 'Change-password');
    if (sanitizedBody === null) return;

    const result = changePasswordSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { currentPassword, password } = result.data;

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account not found.' });
      return;
    }

    const currentIsValid = await compare(currentPassword, user.passwordHash);
    if (!currentIsValid) {
      logger.security('Change-password rejected — current password incorrect', {
        userId: user.id,
        ip: req.ip,
      });
      res.status(422).json({
        error: 'Validation failed.',
        errors: { currentPassword: ['That is not your current password'] },
      });
      return;
    }

    const passwordHash = await hash(password, 12);

    // Stamping passwordChangedAt retires every token minted before now — this
    // one included, so the caller is deliberately logged out and must sign in
    // again. That is the point: if a thief held a session, it dies here.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    logger.security('Password changed — existing sessions invalidated', {
      userId: user.id,
      ip: req.ip,
    });

    clearSessionCookie(res);

    res.status(200).json({
      success: true,
      data: {
        message: 'Password changed successfully. Please log in again.',
      },
    });
  } catch (error) {
    logger.error('Change-password error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Start an email change. Nothing is rewritten here — the new address is parked
 * on the row until the link sent to it is opened, so a typo or a hijacked
 * session cannot strand the real owner outside their own account.
 */
export const requestEmailChange = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const sanitizedBody = screenBody(req, res, 'Update-email');
    if (sanitizedBody === null) return;

    const result = updateEmailSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { newEmail, currentPassword } = result.data;

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, deletedAt: null },
      select: { id: true, name: true, email: true, passwordHash: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account not found.' });
      return;
    }

    // Checked before anything else is looked up: a caller who cannot prove the
    // password learns nothing about which addresses are already registered.
    const currentIsValid = await compare(currentPassword, user.passwordHash);
    if (!currentIsValid) {
      logger.security('Email change rejected — current password incorrect', {
        userId: user.id,
        ip: req.ip,
      });
      res.status(422).json({
        error: 'Validation failed.',
        errors: { currentPassword: ['That is not your current password'] },
      });
      return;
    }

    if (user.email === newEmail) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { newEmail: ['That is already your email address'] },
      });
      return;
    }

    const taken = await prisma.user.findFirst({
      where: { email: newEmail, deletedAt: null },
      select: { id: true },
    });

    if (taken) {
      res.status(409).json({
        error: 'Validation failed.',
        errors: { newEmail: ['That email address is already in use'] },
      });
      return;
    }

    const pending = generateOneTimeToken();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        pendingEmail: newEmail,
        pendingEmailToken: pending.hash,
        pendingEmailExpiry: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    logger.security('Email change requested', {
      userId: user.id,
      ip: req.ip,
    });

    // Delivery is not awaited: a slow mail provider should not hold the request
    // open, and the pending change is already durable.
    sendEmailChangeVerification(newEmail, user.name, pending.raw).catch((err) => {
      logger.error('Email-change verification send failed', {
        userId: user.id,
        errorMessage: (err as Error).message,
      });
    });

    // The old address is the only channel the requester does not control.
    sendEmailChangeNotice(user.email, user.name, newEmail).catch((err) => {
      logger.error('Email-change notice send failed', {
        userId: user.id,
        errorMessage: (err as Error).message,
      });
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Verification email sent successfully. Please check your inbox.',
        pendingEmail: newEmail,
      },
    });
  } catch (error) {
    logger.error('Update-email error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Finish an email change from the link. Public by design — the link is often
 * opened on the phone rather than the device that started it, and holding the
 * token is the proof that matters.
 */
export const confirmEmailChange = async (req: Request, res: Response): Promise<void> => {
  try {
    const sanitizedBody = screenBody(req, res, 'Confirm-email-change');
    if (sanitizedBody === null) return;

    const token = (sanitizedBody as { token?: unknown })?.token;
    if (typeof token !== 'string' || token.length === 0) {
      res.status(400).json({ error: 'Confirmation token is required.' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        pendingEmailToken: hashToken(token),
        pendingEmailExpiry: { gt: new Date() },
        deletedAt: null,
      },
      select: { id: true, name: true, pendingEmail: true },
    });

    if (!user?.pendingEmail) {
      res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
      return;
    }

    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          // Opening the link is itself proof the address works.
          emailVerified: new Date(),
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpiry: null,
        },
      });
    } catch (error) {
      // Someone else claimed the address between the request and the click.
      if ((error as { code?: string }).code === 'P2002') {
        res.status(409).json({ error: 'That email address is already in use.' });
        return;
      }
      throw error;
    }

    logger.security('Email change confirmed', { userId: user.id, ip: req.ip });

    res.status(200).json({
      success: true,
      data: {
        message: 'Email address updated successfully.',
        email: user.pendingEmail,
        name: user.name,
      },
    });
  } catch (error) {
    logger.error('Confirm-email-change error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Hand the browser a short-lived URL to PUT a profile photo straight to storage.
 * The bytes never touch this server: it only decides what may be uploaded and
 * under what key.
 */
export const getAvatarUploadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const filename = typeof req.query.filename === 'string' ? req.query.filename : '';
    const fileSize = Number(req.query.fileSize);

    if (!filename) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: { filename: ['filename query parameter is required'] },
      });
      return;
    }

    if (!isAllowedAvatar(filename)) {
      res.status(415).json({
        error: `Unsupported file type. Allowed: ${allowedAvatarExtensions().join(', ')}`,
      });
      return;
    }

    // The browser checks this too, but the browser is not the one being trusted.
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > AVATAR_MAX_BYTES) {
      res.status(413).json({
        error: `File too large. Maximum size is ${AVATAR_MAX_BYTES / (1024 * 1024)}MB.`,
      });
      return;
    }

    // Missing config is an environment problem, not a server fault — 503 says
    // "not wired up here" rather than burying it in a generic 500.
    if (!isStorageConfigured()) {
      logger.error('Avatar upload URL requested but object storage is not configured');
      res.status(503).json({ error: 'Photo uploads are not configured on this environment.' });
      return;
    }

    const data = await createAvatarUploadUrl(filename);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Avatar upload URL error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Point the account at an uploaded photo. The key arrives from the browser, so
 * it is only written once proved to be one this server minted.
 */
export const updateAvatar = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const sanitizedBody = screenBody(req, res, 'Update-avatar');
    if (sanitizedBody === null) return;

    const result = updateAvatarSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { key } = result.data;

    if (!isMintedAvatarKey(key)) {
      logger.security('Update-avatar rejected — key was not minted by this server', {
        userId: payload.userId,
        ip: req.ip,
      });
      res.status(422).json({
        error: 'Validation failed.',
        errors: { key: ['That upload could not be verified. Please try again.'] },
      });
      return;
    }

    const user = await prisma.user.updateMany({
      where: { id: payload.userId, deletedAt: null },
      data: { image: key },
    });

    if (user.count === 0) {
      res.status(401).json({ error: 'Unauthorized: account not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        message: 'Profile photo updated successfully!',
        // Signed here so the screen can show the new photo without a round trip.
        image: await resolveAvatarUrl(key),
      },
    });
  } catch (error) {
    logger.error('Update-avatar error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};

/**
 * Change the display name. The session JWT does not carry the name, so unlike
 * an email change there is no token to re-sign — the next read simply sees the
 * new value.
 */
export const updateName = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const sanitizedBody = screenBody(req, res, 'Update-name');
    if (sanitizedBody === null) return;

    const result = updateNameSchema.safeParse(sanitizedBody);
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { name } = result.data;

    const updated = await prisma.user.updateMany({
      where: { id: payload.userId, deletedAt: null },
      data: { name },
    });

    if (updated.count === 0) {
      res.status(401).json({ error: 'Unauthorized: account not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: { message: 'Name updated successfully!', name },
    });
  } catch (error) {
    logger.error('Update-name error', {
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
    const sessionUser = await toSessionUser(user);
    const token = signSessionToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      academicLevel: user.academicLevel,
      department: user.department,
      isOnboardingComplete: sessionUser.isOnboardingComplete,
      isMinor: sessionUser.isMinor,
      guardianConsentStatus: sessionUser.guardianConsentStatus,
    });

    setSessionCookie(res, token);
    res.status(200).json({ success: true, data: { user: sessionUser, token } });
  } catch (error) {
    logger.error('Onboarding error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
