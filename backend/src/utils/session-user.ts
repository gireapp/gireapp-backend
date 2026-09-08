// ─────────────────────────────────────────────────
// GIREAPP — Session User Projection
// One definition of how a User row becomes a SessionUser, shared by every
// controller so the derived fields cannot drift between them.
// ─────────────────────────────────────────────────

import { calculateAge } from '@gireapp/shared';
import { resolveAvatarUrl } from '../services/storage';
import type { AcademicLevel, GuardianConsentStatus, SessionUser } from '@gireapp/shared';

/** Prisma `select` covering exactly the columns toSessionUser() needs. */
export const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  academicLevel: true,
  department: true,
  moodTheme: true,
  points: true,
  image: true,
  dateOfBirth: true,
  guardianConsentStatus: true,
} as const;

export type SessionUserRow = {
  id: string;
  name: string;
  email: string;
  role: SessionUser['role'];
  academicLevel: AcademicLevel | null;
  department: string | null;
  moodTheme: string | null;
  points: number;
  image: string | null;
  dateOfBirth: Date | null;
  guardianConsentStatus: GuardianConsentStatus;
};

/**
 * Async because `image` is a private object key once a learner uploads one, and
 * the browser needs a signed URL. Signing here rather than at each call site is
 * the point of this projection: a controller cannot forget it and ship a broken
 * avatar.
 */
export async function toSessionUser(user: SessionUserRow): Promise<SessionUser> {
  // dateOfBirth is deliberately dropped — it is PII the client never needs, and
  // isMinor is derived from it here so it cannot go stale as a learner turns 18.
  const { dateOfBirth, ...rest } = user;
  return {
    ...rest,
    image: await resolveAvatarUrl(user.image),
    isOnboardingComplete: Boolean(user.academicLevel && user.department),
    isMinor: dateOfBirth ? calculateAge(dateOfBirth) < 18 : false,
  };
}
