// ─────────────────────────────────────────────────
// GIREAPP — Shared Constants
// Gamification, points, badge thresholds
// ─────────────────────────────────────────────────

import type { BadgeType } from '../types/index.js';

// ── Gamification Constants ──

export const POINTS = {
  QUIZ_PASS: 50,
  QUIZ_FAIL: 10,
} as const;

export const BADGE_THRESHOLDS: Record<BadgeType, { label: string; minScore: number; color: string }> = {
  BRONZE: { label: 'Bronze', minScore: 50, color: '#CD7F32' },
  SILVER: { label: 'Silver', minScore: 70, color: '#C0C0C0' },
  GOLD: { label: 'Gold', minScore: 90, color: '#FFD700' },
  CURRENT_MASTER: { label: 'Current Master', minScore: 95, color: '#3730A3' },
} as const;

// ── Pagination defaults ──

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// ── API paths (relative, without base URL) ──

export const API_PATHS = {
  AUTH: {
    REGISTER: '/api/auth/register',
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    FORGOT_PASSWORD: '/api/auth/forgot-password',
    RESET_PASSWORD: '/api/auth/reset-password',
    CHANGE_PASSWORD: '/api/auth/change-password',
    UPDATE_EMAIL: '/api/auth/update-email',
    CONFIRM_EMAIL_CHANGE: '/api/auth/confirm-email-change',
    AVATAR_UPLOAD_URL: '/api/auth/avatar-upload-url',
    AVATAR: '/api/auth/avatar',
    NAME: '/api/auth/name',
    VERIFY_EMAIL: '/api/auth/verify-email',
    RESEND_VERIFICATION: '/api/auth/resend-verification',
    ONBOARDING: '/api/auth/onboarding',
    GUARDIAN_CONSENT: '/api/auth/guardian-consent',
  },
  SUPPORT: {
    CONTACT: '/api/support/contact',
  },

  COURSES: {
    LIST: '/api/courses',
    DETAIL: (courseId: string) => `/api/courses/${courseId}`,
    ENROL: (courseId: string) => `/api/courses/${courseId}/enrol`,
    LESSON: (courseId: string, lessonId: string) => `/api/courses/${courseId}/lessons/${lessonId}`,
    COMPLETE_LESSON: (courseId: string, lessonId: string) => `/api/courses/${courseId}/lessons/${lessonId}/complete`,
  },
  DASHBOARD: {
    OVERVIEW: '/api/dashboard',
  },
  QUIZZES: {
    DETAIL: (quizId: string) => `/api/quizzes/${quizId}`,
    SUBMIT: (quizId: string) => `/api/quizzes/${quizId}/submit`,
  },
  ADMIN: {
    COURSES: '/api/admin/courses',
    USERS: '/api/admin/users',
    STUDENTS: '/api/admin/students',
    OVERVIEW: '/api/admin/overview',
    ANALYTICS: '/api/admin/analytics',
  },
  HEALTH: '/api/health',
} as const;
