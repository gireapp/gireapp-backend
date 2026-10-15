import jwt from 'jsonwebtoken';
import { JWT_ISSUER, JWT_SECRET } from '../config/env';

/**
 * Its own audience, so a quiz ticket can never be replayed as a session token:
 * session verification only accepts the frontend audience.
 */
const TICKET_AUDIENCE = 'gireapp-quiz-attempt';

/**
 * Slack after the time limit for the auto-submit's network round trip. Without
 * it, an answer sheet submitted on the final second could arrive just after
 * the deadline and be thrown away.
 */
export const SUBMIT_GRACE_SEC = 30;

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

export type QuizTicket = {
  quizId: string;
  userId: string;
  /** Server clock, in milliseconds — becomes the attempt's `startedAt`. */
  startedAt: Date;
};

export type TicketCheck =
  | { status: 'valid'; ticket: QuizTicket }
  | { status: 'expired' }
  | { status: 'invalid' };

/**
 * Signs a start ticket. The start time lives inside the signature, so a client
 * cannot claim to have started later to buy itself more time, and the expiry
 * enforces the time limit against the server's clock.
 *
 * Milliseconds, not the second-precision `iat`: `startedAt` is part of a
 * unique key, and two Starts in the same second must not collide.
 */
export function issueQuizTicket(
  quizId: string,
  userId: string,
  timeLimitMin: number,
  now: Date = new Date()
): { ticket: string; expiresAt: Date } {
  const limitSec = timeLimitMin * SECONDS_PER_MINUTE;
  const ticket = jwt.sign({ quizId, startedAtMs: now.getTime() }, JWT_SECRET, {
    subject: userId,
    issuer: JWT_ISSUER,
    audience: TICKET_AUDIENCE,
    expiresIn: limitSec + SUBMIT_GRACE_SEC,
  });

  return { ticket, expiresAt: new Date(now.getTime() + limitSec * MS_PER_SECOND) };
}

export function verifyQuizTicket(ticket: string): TicketCheck {
  try {
    const claims = jwt.verify(ticket, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: TICKET_AUDIENCE,
    });

    if (
      typeof claims !== 'object' ||
      typeof claims.quizId !== 'string' ||
      typeof claims.startedAtMs !== 'number' ||
      typeof claims.sub !== 'string'
    ) {
      return { status: 'invalid' };
    }

    return {
      status: 'valid',
      ticket: { quizId: claims.quizId, userId: claims.sub, startedAt: new Date(claims.startedAtMs) },
    };
  } catch (error) {
    return { status: error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}
