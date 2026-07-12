// ─────────────────────────────────────────────────
// GIREAPP — Email Service (Resend)
// Transactional emails: verification, reset, contact
// ─────────────────────────────────────────────────

import { Resend } from 'resend';

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('[GIREAPP] RESEND_API_KEY not configured');
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

const FROM = process.env.EMAIL_FROM ?? 'GIREAPP <noreply@gireapp.com>';
// Links in emails must point at the deployed frontend
const APP_URL =
  process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ── Email Templates ──

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/** Low-level send with retry (up to 3 attempts per M2: BE-SEC-001) */
async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  const resend = getResend();
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await resend.emails.send({
        from: FROM,
        to,
        subject,
        html,
      });

      if (result.error) {
        console.error(`[GIREAPP Email] Attempt ${attempt} failed:`, result.error);
        if (attempt === maxRetries) return false;
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
        continue;
      }

      return true;
    } catch (error) {
      console.error(`[GIREAPP Email] Attempt ${attempt} exception:`, error);
      if (attempt === maxRetries) return false;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return false;
}

/** Send email verification link */
export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string
): Promise<boolean> {
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
        <h2 style="color: #0F172A; font-size: 20px;">Welcome, ${name}!</h2>
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

/** Send password reset link */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string
): Promise<boolean> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  return sendEmail({
    to,
    subject: 'Reset your GIREAPP password',
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #3730A3; font-size: 28px; margin: 0;">GIREAPP</h1>
        </div>
        <h2 style="color: #0F172A; font-size: 20px;">Hi ${name},</h2>
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
): Promise<boolean> {
  const counsellingEmail = process.env.COUNSELLING_EMAIL ?? 'counselling@gireapp.com';

  return sendEmail({
    to: counsellingEmail,
    subject: `[Mentorship Request] ${subject}`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #3730A3; font-size: 20px;">New Mentorship Request</h2>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">From:</td><td style="padding: 8px;">${fromName}</td></tr>
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">Email:</td><td style="padding: 8px;">${fromEmail}</td></tr>
          <tr><td style="padding: 8px; color: #64748B; font-weight: 600;">Subject:</td><td style="padding: 8px;">${subject}</td></tr>
        </table>
        <div style="background: #F1F5F9; padding: 16px; border-radius: 8px; margin-top: 16px;">
          <p style="color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${message}</p>
        </div>
      </div>
    `,
  });
}
