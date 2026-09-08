import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { prismaMock, emailMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { user: { findFirst: vi.fn(), update: vi.fn() } },
  emailMock: {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    sendGuardianConsentEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeVerification: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeNotice: vi.fn().mockResolvedValue(undefined),
  },
  loggerMock: { error: vi.fn(), security: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../services/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../services/email', () => emailMock);
vi.mock('../../utils/logger', () => ({ logger: loggerMock }));

import { hash } from 'bcryptjs';
import { hashToken } from '../../utils/token';
import { changePassword, requestEmailChange, confirmEmailChange } from '../auth.controller';

const USER_ID = 'user-1';

function buildRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    cookies: [] as { name: string; value: string }[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string) {
      this.cookies.push({ name, value });
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

function buildReq(body: unknown, authenticated = true) {
  const req: Record<string, unknown> = { body, ip: '203.0.113.7' };
  if (authenticated) req.user = { userId: USER_ID, email: 'old@example.com' };
  return req as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({});
});

describe('changePassword', () => {
  const VALID = {
    currentPassword: 'OldPassw0rd',
    password: 'NewPassw0rd',
    confirmPassword: 'NewPassw0rd',
  };

  it('rejects a wrong current password without writing anything', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      passwordHash: await hash('SomethingElse1', 4),
    });
    const res = buildRes();

    await changePassword(buildReq(VALID), res);

    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('retires every existing session by stamping passwordChangedAt', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      passwordHash: await hash(VALID.currentPassword, 4),
    });
    const res = buildRes();

    await changePassword(buildReq(VALID), res);

    expect(res.statusCode).toBe(200);
    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(data.passwordHash).not.toBe(VALID.password);
  });

  it('clears the lockout so a recovered account is not left locked', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      passwordHash: await hash(VALID.currentPassword, 4),
    });

    await changePassword(buildReq(VALID), buildRes());

    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.failedLoginAttempts).toBe(0);
    expect(data.lockedUntil).toBeNull();
  });

  it('expires the session cookie of the caller it just logged out', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      passwordHash: await hash(VALID.currentPassword, 4),
    });
    const res = buildRes();

    await changePassword(buildReq(VALID), res);

    expect(res.cookies).toEqual([{ name: 'token', value: '' }]);
  });
});

describe('requestEmailChange', () => {
  const VALID = {
    newEmail: 'new@example.com',
    confirmEmail: 'new@example.com',
    currentPassword: 'OldPassw0rd',
  };
  let CURRENT: Record<string, unknown>;

  beforeEach(async () => {
    CURRENT = {
      id: USER_ID,
      name: 'Afolabi',
      email: 'old@example.com',
      passwordHash: await hash(VALID.currentPassword, 4),
    };
  });

  it('parks the new address instead of rewriting the account', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce(null);
    const res = buildRes();

    await requestEmailChange(buildReq(VALID), res);

    expect(res.statusCode).toBe(200);
    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.pendingEmail).toBe('new@example.com');
    expect(data).not.toHaveProperty('email');
  });

  it('stores only the hash of the confirmation token', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce(null);

    await requestEmailChange(buildReq(VALID), buildRes());

    const stored = prismaMock.user.update.mock.calls[0][0].data.pendingEmailToken;
    const emailed = emailMock.sendEmailChangeVerification.mock.calls[0][2];
    expect(stored).not.toBe(emailed);
    expect(stored).toBe(hashToken(emailed));
  });

  it('warns the current address, which the requester may not control', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce(null);

    await requestEmailChange(buildReq(VALID), buildRes());

    expect(emailMock.sendEmailChangeVerification).toHaveBeenCalledWith(
      'new@example.com',
      'Afolabi',
      expect.any(String)
    );
    expect(emailMock.sendEmailChangeNotice).toHaveBeenCalledWith(
      'old@example.com',
      'Afolabi',
      'new@example.com'
    );
  });

  it('refuses an address another account already holds', async () => {
    prismaMock.user.findFirst
      .mockResolvedValueOnce(CURRENT)
      .mockResolvedValueOnce({ id: 'someone-else' });
    const res = buildRes();

    await requestEmailChange(buildReq(VALID), res);

    expect(res.statusCode).toBe(409);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses the address the account already uses', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT);
    const res = buildRes();

    await requestEmailChange(
      buildReq({ ...VALID, newEmail: 'old@example.com', confirmEmail: 'old@example.com' }),
      res
    );

    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses a mismatched confirmation before touching the database', async () => {
    const res = buildRes();

    await requestEmailChange(
      buildReq({ ...VALID, confirmEmail: 'typo@example.com' }),
      res
    );

    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(emailMock.sendEmailChangeVerification).not.toHaveBeenCalled();
  });

  it('refuses a wrong password before looking any address up', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT);
    const res = buildRes();

    await requestEmailChange(buildReq({ ...VALID, currentPassword: 'WrongPass1' }), res);

    expect(res.statusCode).toBe(422);
    expect((res.body as { errors: Record<string, string[]> }).errors.currentPassword).toEqual([
      'That is not your current password',
    ]);
    // Only the caller's own row was read — nothing was learned about the new address.
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(emailMock.sendEmailChangeVerification).not.toHaveBeenCalled();
  });

  it('refuses a missing password before touching the database', async () => {
    const res = buildRes();

    await requestEmailChange(buildReq({ ...VALID, currentPassword: '' }), res);

    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('still answers 200 when the mail provider fails, the change being durable', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce(null);
    emailMock.sendEmailChangeVerification.mockRejectedValueOnce(new Error('provider down'));
    const res = buildRes();

    await requestEmailChange(buildReq(VALID), res);

    expect(res.statusCode).toBe(200);
  });
});

describe('confirmEmailChange', () => {
  it('applies the parked address and clears the pending state', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      name: 'Afolabi',
      pendingEmail: 'new@example.com',
    });
    const res = buildRes();

    await confirmEmailChange(buildReq({ token: 'raw-token' }, false), res);

    expect(res.statusCode).toBe(200);
    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.email).toBe('new@example.com');
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(data.pendingEmail).toBeNull();
    expect(data.pendingEmailToken).toBeNull();
  });

  it('looks the token up by hash, never by its raw value', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      name: 'Afolabi',
      pendingEmail: 'new@example.com',
    });

    await confirmEmailChange(buildReq({ token: 'raw-token' }, false), buildRes());

    const where = prismaMock.user.findFirst.mock.calls[0][0].where;
    expect(where.pendingEmailToken).toBe(hashToken('raw-token'));
    expect(where.pendingEmailToken).not.toBe('raw-token');
  });

  it('refuses an expired or unknown token', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const res = buildRes();

    await confirmEmailChange(buildReq({ token: 'stale' }, false), res);

    expect(res.statusCode).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    const res = buildRes();

    await confirmEmailChange(buildReq({}, false), res);

    expect(res.statusCode).toBe(400);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('reports a conflict when the address was claimed before the click', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: USER_ID,
      name: 'Afolabi',
      pendingEmail: 'new@example.com',
    });
    prismaMock.user.update.mockRejectedValue({ code: 'P2002' });
    const res = buildRes();

    await confirmEmailChange(buildReq({ token: 'raw-token' }, false), res);

    expect(res.statusCode).toBe(409);
  });
});
