// ─────────────────────────────────────────────────
// GIREAPP — Email Service (Resend)
// Transactional emails: verification, reset, contact
// ─────────────────────────────────────────────────

import { Resend } from 'resend';
import { logger } from '../utils/logger';

let resendClient: Resend | null = null;

/**
 * Resend keys are `re_` followed by a long random body. The value shipped in
 * .env.example (`re_xxxxxxxxxx`) is syntactically close enough that the SDK
 * accepts it and only fails at send time, with a 403 the caller never sees.
 * Rejecting it here turns a silent non-delivery into a startup-time error.
 */
function assertUsableApiKey(apiKey: string): void {
  const looksLikePlaceholder = /^re_x+$/i.test(apiKey) || apiKey.length < 20;

  if (!apiKey.startsWith('re_') || looksLikePlaceholder) {
    throw new Error(
      '[GIREAPP] RESEND_API_KEY looks like a placeholder, not a real key. ' +
        'Create one at https://resend.com/api-keys and set it in backend/.env.local.'
    );
  }
}

function getResend(): Resend {
  if (resendClient) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[GIREAPP] RESEND_API_KEY not configured — no transactional email can be sent.'
    );
  }

  assertUsableApiKey(apiKey);

  resendClient = new Resend(apiKey);
  return resendClient;
}

const FROM = process.env.EMAIL_FROM ?? 'GIREAPP <noreply@gireapp.com>';
// Links in emails must point at the deployed frontend
const APP_URL =
  process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/** Escape user-controlled values before interpolating them into email HTML (BE-SEC-M2) */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Email Templates ──

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/** Raised when a message could not be handed to Resend. Callers log it; none recover. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly attempts: number
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Resend failures that repeat identically no matter how often they are retried:
 * bad credentials, an unverified From domain, a malformed request. Retrying these
 * only delays the error by the length of the backoff.
 */
const PERMANENT_ERROR_CODES = new Set([
  'missing_api_key',
  'invalid_api_Key', // Resend's own spelling of this code
  'invalid_from_address',
  'validation_error',
  'missing_required_field',
  'invalid_access',
  'invalid_parameter',
  'invalid_region',
  'not_found',
  'method_not_allowed',
]);

const MAX_RETRIES = 3;

/**
 * Low-level send with retry (up to 3 attempts per M2: BE-SEC-001).
 *
 * Throws on failure rather than returning false. Every caller is fire-and-forget
 * (`sendX(...).catch(log)`) so that a mail outage cannot fail a registration —
 * but a `.catch()` only runs on a rejected promise. While this resolved `false`,
 * a rejected send logged nothing at the call site and the backend looked healthy
 * while no mail was arriving.
 */
async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const resend = getResend();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await resend.emails.send({ from: FROM, to, subject, html });

      if (!result.error) return;

      const { name: code, message } = result.error;
      const isPermanent = PERMANENT_ERROR_CODES.has(code);

      logger.error('Resend rejected a message', {
        subject,
        code,
        errorMessage: message,
        attempt,
        permanent: isPermanent,
      });

      if (isPermanent || attempt === MAX_RETRIES) {
        throw new EmailDeliveryError(
          `Resend rejected "${subject}" (${code}): ${message}`,
          code,
          attempt
        );
      }
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;

      const errorMessage = (error as Error).message;
      logger.error('Resend request threw', { subject, errorMessage, attempt });

      if (attempt === MAX_RETRIES) {
        throw new EmailDeliveryError(
          `Could not reach Resend for "${subject}": ${errorMessage}`,
          'network_error',
          attempt
        );
      }
    }

    await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
  }
}

/** Send email verification link */
export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;

  return sendEmail({
    to,
    subject: 'Verify your GIREAPP account',
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #3730A3; font-size: 28px; margin: 0;">GIREAPP</h1>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Get It Right Edu App</p>
        </div>
        <h2 style="color: #0F172A; font-size: 20px;">Welcome, ${escapeHtml(name)}!</h2>
        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
          Thank you for joining GIREAPP. Please verify your email address to start your learning journey.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" 
             style="display: inline-block; padding: 14px 32px; background: #3730A3; color: #FFFFFF; 
                    text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Verify Email Address
          </a>
        </div>
        <p style="color: #64748B; font-size: 14px;">
          This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
        <p style="color: #94A3B8; font-size: 12px; text-align: center;">
          © ${new Date().getFullYear()} GIREAPP — Enabling Academic Excellence Across Africa
        </p>
      </div>
    `,
  });
}

/**
 * Guardian consent request for an under-18 account (NDPA 2023 / POPIA / Ghana Act 843).
 * Academic access is never gated on this — only Mentorship stays locked until the
 * guardian confirms, so the learner is never blocked from studying.
 */
export async function sendGuardianConsentEmail(
  to: string,
  learnerName: string,
  token: string
): Promise<void> {
  const confirmUrl = `${APP_URL}/guardian-consent?token=${token}`;

  return sendEmail({
    to,
    subject: `Confirm ${escapeHtml(learnerName)}'s GIREAPP account`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #3730A3; font-size: 28px; margin: 0;">GIREAPP</h1>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Get It Right Edu App</p>
        </div>
        <h2 style="color: #0F172A; font-size: 20px;">A learner listed you as their guardian</h2>
        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
          ${escapeHtml(learnerName)} has created a GIREAPP account and is under 18.
          They can already study — courses, practice and progress are open to them.
        </p>
        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
          We only need your confirmation before they can use <strong>Mentorship</strong>,
          which lets them speak with adult mentors.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${confirmUrl}"
             style="display: inline-block; padding: 14px 32px; background: #3730A3; color: #FFFFFF;
                    text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Confirm and allow Mentorship
          </a>
        </div>
        <p style="color: #64748B; font-size: 14px;">
          This link expires in 30 days. If you do not recognise this learner, simply ignore
          this email — Mentorship stays switched off and no further action is taken.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
        <p style="color: #94A3B8; font-size: 12px; text-align: center;">
          © ${new Date().getFullYear()} GIREAPP — Enabling Academic Excellence Across Africa
        </p>
      </div>
    `,
  });
}

/** Send password reset link */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  return sendEmail({
    to,
    subject: 'Reset your GIREAPP password',
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #3730A3; font-size: 28px; margin: 0;">GIREAPP</h1>
        </div>
        <h2 style="color: #0F172A; font-size: 20px;">Hi ${escapeHtml(name)},</h2>
        <p style="color: #334155; font-size: 16px; line-height: 1.6;">
          We received a request to reset your password. Click the button below to set a new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" 
             style="display: inline-block; padding: 14px 32px; background: #3730A3; color: #FFFFFF; 
                    text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Reset Password
          </a>
        </div>
        <p style="color: #64748B; font-size: 14px;">
          This link expires in 1 hour. If you didn't request a reset, your account is safe — no action needed.
        </p>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0;" />
        <p style="color: #94A3B8; font-size: 12px; text-align: center;">
          © ${new Date().getFullYear()} GIREAPP — Enabling Academic Excellence Across Africa
        </p>
      </div>
    `,
  });
}

/** Send counselling/mentorship request notification */
export async function sendContactFormEmail(
  fromName: string,
  fromEmail: string,
  subject: string,
  message: string
): Promise<void> {
  const counsellingEmail = process.env.COUNSELLING_EMAIL ?? 'counselling@gireapp.com';

  return sendEmail({
    to: counsellingEmail,
    subject: `[Mentorship Request] ${subject}`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #3730A3; font-size: 20px;">New Mentorship Request</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">From:</td><td style="padding: 8px;">${escapeHtml(fromName)}</td></tr>
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">Email:</td><td style="padding: 8px;">${escapeHtml(fromEmail)}</td></tr>
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">Subject:</td><td style="padding: 8px;">${escapeHtml(subject)}</td></tr>
        </table>
        <div style="background: #F1F5F9; padding: 16px; border-radius: 8px; margin-top: 16px;">
          <p style="color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
        </div>
      </div>
    `,
  });
}
