import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { prismaMock, emailMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { user: { findFirst: vi.fn() } },
  emailMock: { sendSupportRequestEmail: vi.fn().mockResolvedValue(undefined) },
  loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../services/email', () => emailMock);
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import { contactSupport } from '../support.controller';

const USER_ID = 'user-1';
const ACCOUNT = { name: 'Afolabi Hassan', email: 'afolabi@example.com' };

function buildRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

function buildReq(body: unknown) {
  return { body, ip: '203.0.113.7', user: { userId: USER_ID } } as unknown as Request;
}

const VALID = {
  subject: 'Cannot open my quiz',
  message: 'The quiz page has been loading forever since yesterday evening.',
  urgency: 'high',
};

beforeEach(() => {
  vi.clearAllMocks();
  emailMock.sendSupportRequestEmail.mockResolvedValue(undefined);
  prismaMock.user.findFirst.mockResolvedValue(ACCOUNT);
});

describe('contactSupport', () => {
  it('sends the request with the sender taken from the account', async () => {
    const res = buildRes();

    await contactSupport(buildReq(VALID), res);

    expect(res.statusCode).toBe(200);
    expect(emailMock.sendSupportRequestEmail).toHaveBeenCalledWith(
      ACCOUNT.name,
      ACCOUNT.email,
      VALID.subject,
      VALID.message,
      'high'
    );
  });

  it('ignores a sender supplied in the body — it cannot be spoofed', async () => {
    const res = buildRes();

    await contactSupport(
      buildReq({ ...VALID, name: 'Someone Else', email: 'attacker@example.com' }),
      res
    );

    expect(emailMock.sendSupportRequestEmail).toHaveBeenCalledWith(
      ACCOUNT.name,
      ACCOUNT.email,
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it('defaults the urgency when none is chosen', async () => {
    const { urgency: _urgency, ...withoutUrgency } = VALID;

    await contactSupport(buildReq(withoutUrgency), buildRes());

    expect(emailMock.sendSupportRequestEmail).toHaveBeenCalledWith(
      ACCOUNT.name,
      ACCOUNT.email,
      VALID.subject,
      VALID.message,
      'medium'
    );
  });

  it.each([
    ['a subject that is too short', { ...VALID, subject: 'hi' }],
    ['a message that is too short', { ...VALID, message: 'broken' }],
    ['an urgency outside the list', { ...VALID, urgency: 'catastrophic' }],
  ])('refuses %s', async (_label, body) => {
    const res = buildRes();

    await contactSupport(buildReq(body), res);

    expect(res.statusCode).toBe(422);
    expect(emailMock.sendSupportRequestEmail).not.toHaveBeenCalled();
  });

  it('tells the learner when the message could not be sent', async () => {
    // Nothing is stored, so a failed send means the request did not happen.
    emailMock.sendSupportRequestEmail.mockRejectedValue(new Error('provider down'));
    const res = buildRes();

    await contactSupport(buildReq(VALID), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Could not send your message. Please try again.',
    });
  });

  it('reports a soft-deleted account as unauthorized', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const res = buildRes();

    await contactSupport(buildReq(VALID), res);

    expect(res.statusCode).toBe(401);
    expect(emailMock.sendSupportRequestEmail).not.toHaveBeenCalled();
  });
});
