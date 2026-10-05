import { describe, it, expect, vi, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { issueQuizTicket, SUBMIT_GRACE_SEC, verifyQuizTicket } from '../quiz-ticket';
import { JWT_SECRET } from '../../config/env';
import { signSessionToken } from '../token';

const START = new Date('2026-10-05T12:00:00.123Z');

afterEach(() => vi.useRealTimers());

describe('quiz tickets', () => {
  it('carries the server start time to the millisecond', () => {
    const { ticket } = issueQuizTicket('quiz-1', 'user-1', 30, START);

    expect(verifyQuizTicket(ticket)).toEqual({
      status: 'valid',
      ticket: { quizId: 'quiz-1', userId: 'user-1', startedAt: START },
    });
  });

  it('tells the client to count down to the time limit, without the grace', () => {
    const { expiresAt } = issueQuizTicket('quiz-1', 'user-1', 30, START);

    expect(expiresAt.getTime() - START.getTime()).toBe(30 * 60 * 1000);
  });

  it('still accepts answers inside the grace period after the limit', () => {
    vi.useFakeTimers({ now: START });
    const { ticket } = issueQuizTicket('quiz-1', 'user-1', 1);

    vi.setSystemTime(START.getTime() + (60 + SUBMIT_GRACE_SEC - 5) * 1000);

    expect(verifyQuizTicket(ticket).status).toBe('valid');
  });

  it('reports a ticket past the grace period as expired, not invalid', () => {
    vi.useFakeTimers({ now: START });
    const { ticket } = issueQuizTicket('quiz-1', 'user-1', 1);

    vi.setSystemTime(START.getTime() + (60 + SUBMIT_GRACE_SEC + 5) * 1000);

    expect(verifyQuizTicket(ticket).status).toBe('expired');
  });

  it('rejects a ticket whose start time has been edited', () => {
    const { ticket } = issueQuizTicket('quiz-1', 'user-1', 30, START);
    const [header, , signature] = ticket.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...jwt.decode(ticket) as object, startedAtMs: Date.now() + 3_600_000 })
    ).toString('base64url');

    expect(verifyQuizTicket(`${header}.${forged}.${signature}`).status).toBe('invalid');
  });

  it('refuses a session token presented as a ticket', () => {
    const session = signSessionToken({
      userId: 'user-1',
      email: 'a@b.com',
      role: 'STUDENT',
      academicLevel: null,
      department: null,
      isOnboardingComplete: false,
      isMinor: false,
      guardianConsentStatus: 'not_required',
    });

    expect(verifyQuizTicket(session).status).toBe('invalid');
  });

  it('refuses a ticket signed with another secret', () => {
    const foreign = jwt.sign({ quizId: 'quiz-1', startedAtMs: 1 }, `${JWT_SECRET}-not`, {
      subject: 'user-1',
    });

    expect(verifyQuizTicket(foreign).status).toBe('invalid');
  });
});
