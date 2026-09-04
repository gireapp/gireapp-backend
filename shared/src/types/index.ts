// ─────────────────────────────────────────────────
// GIREAPP — Shared Types & Enums
// Single source of truth for TypeScript types
// Used by both frontend and backend
// ─────────────────────────────────────────────────

/** Academic level segments — maps to user onboarding selection */
export const ACADEMIC_LEVELS = ['SECONDARY', 'TERTIARY', 'PROFESSIONAL'] as const;
export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];

/** User roles for RBAC */
export const ROLES = ['STUDENT', 'TUTOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** Content types supported in lessons */
export const CONTENT_TYPES = ['TEXT', 'PDF', 'MARKDOWN', 'VIDEO'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Gamification badge tiers */
export const BADGE_TYPES = ['BRONZE', 'SILVER', 'GOLD', 'CURRENT_MASTER'] as const;
export type BadgeType = (typeof BADGE_TYPES)[number];

/** Mood themes for UI personalization */
export const MOOD_THEMES = ['calm', 'focused', 'energized', 'relaxed'] as const;
export type MoodTheme = (typeof MOOD_THEMES)[number];

/** Department options per academic level */
export const DEPARTMENTS: Record<AcademicLevel, readonly string[]> = {
  SECONDARY: ['Science', 'Business', 'Arts'] as const,
  TERTIARY: ['Undergraduate', 'Postgraduate'] as const,
  PROFESSIONAL: ['Data Analytics', 'Project Management', 'Digital Marketing', 'Software Engineering'] as const,
} as const;

// ── Session / Auth Types ──

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  academicLevel: AcademicLevel | null;
  department: string | null;
  moodTheme: string | null;
  points: number;
  image: string | null;
  isOnboardingComplete: boolean;
}

/** JWT payload structure (must match backend token signing) */
export interface JwtPayload {
  userId: string;
  role: Role;
  email: string;
  academicLevel: AcademicLevel | null;
  department: string | null;
  isOnboardingComplete: boolean;
  iat?: number;
  exp?: number;
  sub?: string;
}

// ── API Response Types ──

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ── Dashboard Types ──

export interface DashboardOverview {
  profile: SessionUser;
  totalPoints: number;
  badgeCount: number;
  activeCourses: CourseCard[];
  recentActivity: ActivityItem[];
}

export interface CourseCard {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  moduleCount: number;
  lessonCount: number;
  progress: number; // 0.0 to 1.0
  estimatedMinutes: number;
}

export interface ActivityItem {
  id: string;
  type: 'lesson_completed' | 'quiz_passed' | 'quiz_failed' | 'badge_earned' | 'course_enrolled';
  title: string;
  timestamp: string; // ISO string for serialization safety
  metadata?: Record<string, string | number>;
}

// ── Course Types ──

export interface CourseDetail {
  id: string;
  title: string;
  description: string;
  academicLevel: AcademicLevel;
  department: string;
  thumbnailUrl: string | null;
  published: boolean;
  modules: ModuleDetail[];
  isEnrolled: boolean;
  progress: number;
}

export interface ModuleDetail {
  id: string;
  title: string;
  order: number;
  lessons: LessonSummary[];
}

export interface LessonSummary {
  id: string;
  title: string;
  contentType: ContentType;
  estimatedMinutes: number;
  order: number;
  isCompleted: boolean;
}

export interface LessonDetail {
  id: string;
  title: string;
  contentType: ContentType;
  content: string | null;
  mediaUrl: string | null;
  estimatedMinutes: number;
  order: number;
  isCompleted: boolean;
  nextLessonId: string | null;
  prevLessonId: string | null;
  module: { id: string; title: string };
  allLessonsCount: number;
  currentIndex: number;
}

// ── Quiz Types ──

export interface QuizQuestion {
  id: string;
  text: string;
  choices: QuizChoice[];
  order: number;
}

export interface QuizChoice {
  id: string;
  text: string;
  order: number;
}

export interface QuizSubmission {
  quizId: string;
  answers: Record<string, string>; // { questionId: choiceId }
  startedAt: string; // ISO timestamp
}

export interface QuizResult {
  score: number;
  totalRight: number;
  totalWrong: number;
  passed: boolean;
  pointsEarned: number;
  badgeEarned: BadgeType | null;
  timeTakenSec: number;
}
