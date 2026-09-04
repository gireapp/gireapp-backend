import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from '@gireapp/shared';

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock('../../services/prisma', () => ({
  prisma: { user: { findUnique: findUniqueMock } },
}));

vi.mock('../../utils/logger', () => ({
  logger: { security: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { requireGuardianConsent } from '../auth.middleware';

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

function makeReq(user?: Partial<JwtPayload>): Request {
  return {
    originalUrl: '/api/mentorship/sessions',
    ip: '127.0.0.1',
    ...(user ? { user } : {}),
  } as unknown as Request;
}

function makeRes() {
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
  return res as unknown as Response & { statusCode: number; body: any };
}

const ADULT: Partial<JwtPayload> = { userId: 'u1', isMinor: false, guardianConsentStatus: 'not_required' };
const MINOR: Partial<JwtPayload> = { userId: 'u2', isMinor: true, guardianConsentStatus: 'pending' };

let next: NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
  next = vi.fn();
});

describe('requireGuardianConsent', () => {
  it('rejects an unauthenticated request', async () => {
    const res = makeRes();
    await requireGuardianConsent(makeReq(), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets an adult through without touching the database', async () => {
    const res = makeRes();
    await requireGuardianConsent(makeReq(ADULT), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('blocks a minor whose guardian has not confirmed', async () => {
    findUniqueMock.mockResolvedValue({
      dateOfBirth: yearsAgo(15),
      guardianConsentStatus: 'pending',
    });
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.guardianConsentStatus).toBe('pending');
    expect(next).not.toHaveBeenCalled();
  });

  it('admits a minor once the guardian has confirmed', async () => {
    findUniqueMock.mockResolvedValue({
      dateOfBirth: yearsAgo(15),
      guardianConsentStatus: 'confirmed',
    });
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('trusts the live row over a stale token: consent granted since signing', async () => {
    // Token still says pending; the guardian confirmed after it was minted.
    findUniqueMock.mockResolvedValue({
      dateOfBirth: yearsAgo(16),
      guardianConsentStatus: 'confirmed',
    });
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('releases a learner who has since turned 18, consent or not', async () => {
    findUniqueMock.mockResolvedValue({
      dateOfBirth: yearsAgo(18),
      guardianConsentStatus: 'pending',
    });
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('treats a missing date of birth as adult rather than blocking', async () => {
    // Rows predating the feature have no DOB; they must not be locked out.
    findUniqueMock.mockResolvedValue({
      dateOfBirth: null,
      guardianConsentStatus: 'not_required',
    });
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects when the account no longer exists', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = makeRes();

    await requireGuardianConsent(makeReq(MINOR), res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
