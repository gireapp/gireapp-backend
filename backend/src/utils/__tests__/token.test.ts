import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signSessionToken, generateOneTimeToken, hashToken } from '../token';
import { TRACK_TO_ACADEMIC_LEVEL } from '../../controllers/auth.controller';
import type { JwtPayload } from '@gireapp/shared';

describe('signSessionToken', () => {
  const claims = {
    userId: 'user_123',
    role: 'STUDENT' as const,
    email: 'jane@example.com',
    academicLevel: 'SECONDARY' as const,
    department: 'Science',
    isOnboardingComplete: true,
  };

  it('produces a token whose payload matches the shared JwtPayload contract', () => {
    const token = signSessionToken(claims);
    const decoded = jwt.decode(token) as JwtPayload;

    expect(decoded.userId).toBe('user_123');
    expect(decoded.role).toBe('STUDENT');
    expect(decoded.email).toBe('jane@example.com');
    expect(decoded.academicLevel).toBe('SECONDARY');
    expect(decoded.department).toBe('Science');
    expect(decoded.isOnboardingComplete).toBe(true);
    expect(decoded.sub).toBe('user_123');
    expect(decoded.iat).toBeTypeOf('number');
    expect(decoded.exp).toBeTypeOf('number');
  });

  it('expires in 24 hours', () => {
    const decoded = jwt.decode(signSessionToken(claims)) as JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(24 * 60 * 60);
  });

  it('preserves null onboarding fields for brand-new users', () => {
    const decoded = jwt.decode(
      signSessionToken({ ...claims, academicLevel: null, department: null, isOnboardingComplete: false })
    ) as JwtPayload;

    expect(decoded.academicLevel).toBeNull();
    expect(decoded.department).toBeNull();
    expect(decoded.isOnboardingComplete).toBe(false);
  });
});

describe('generateOneTimeToken / hashToken', () => {
  it('returns a 32-byte hex raw token and its sha256 hash', () => {
    const { raw, hash } = generateOneTimeToken();

    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(raw);
    expect(hashToken(raw)).toBe(hash);
  });

  it('generates unique tokens', () => {
    expect(generateOneTimeToken().raw).not.toBe(generateOneTimeToken().raw);
  });

  it('hashes deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

describe('TRACK_TO_ACADEMIC_LEVEL', () => {
  it('maps every signup wizard track to its enum value', () => {
    expect(TRACK_TO_ACADEMIC_LEVEL['Secondary']).toBe('SECONDARY');
    expect(TRACK_TO_ACADEMIC_LEVEL['Tertiary']).toBe('TERTIARY');
    expect(TRACK_TO_ACADEMIC_LEVEL['Professional']).toBe('PROFESSIONAL');
  });

  it('has no mapping for unknown tracks', () => {
    expect(TRACK_TO_ACADEMIC_LEVEL['secondary']).toBeUndefined();
    expect(TRACK_TO_ACADEMIC_LEVEL['']).toBeUndefined();
  });
});
