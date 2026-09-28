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

/**
 * Guardian-consent tiered access gate for minor accounts (NDPA 2023 / POPIA / Ghana Act 843).
 * 'not_required' — account is 18+. 'pending' — under 18, guardian confirmation email sent,
 * Mentorship endpoints return 403 until confirmed. 'confirmed' — guardian clicked the
 * one-click link. Academic access (courses/assessments/gamification) is never gated by this.
 */
export const GUARDIAN_CONSENT_STATUSES = ['not_required', 'pending', 'confirmed'] as const;
export type GuardianConsentStatus = (typeof GUARDIAN_CONSENT_STATUSES)[number];

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
  isMinor: boolean;
  guardianConsentStatus: GuardianConsentStatus;
}

/** JWT payload structure (must match backend token signing) */
export interface JwtPayload {
  userId: string;
  role: Role;
  email: string;
  academicLevel: AcademicLevel | null;
  department: string | null;
  isOnboardingComplete: boolean;
  isMinor: boolean;
  guardianConsentStatus: GuardianConsentStatus;
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

export interface DashboardStats {
  /** Every attempt ever, not the truncated `recentActivity` slice. */
  quizzesTaken: number;
  /** Mean score across all attempts, 0–100. `null` until the first attempt. */
  averageScore: number | null;
  /** Points earned in the last 7 days, derived from attempts in that window. */
  weeklyPoints: number;
  /**
   * Standing among learners at the same academic level, as a percentage —
   * 10 means "top 10%". `null` when the learner has no points or has too few
   * peers for a ranking to mean anything.
   */
  rankPercentile: number | null;
}

/** The next quiz in an enrolled course that the learner hasn't attempted. */
export interface NextQuiz {
  id: string;
  courseId: string;
  title: string;
  /** Always null for now — quizzes carry no due date in the schema. */
  dueDate: string | null;
}

export interface DashboardOverview {
  profile: SessionUser;
  totalPoints: number;
  badgeCount: number;
  activeCourses: CourseCard[];
  /** Published courses at the learner's level that they have not enrolled in. */
  recommendedCourses: CourseCard[];
  recentActivity: ActivityItem[];
  stats: DashboardStats;
  nextQuiz: NextQuiz | null;
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

/**
 * A course as it appears in a listing: counts rather than the full module tree,
 * plus whether the caller has already joined. `CourseDetail` carries the tree.
 */
export interface CourseListItem extends CourseCard {
  department: string;
  academicLevel: AcademicLevel;
  isEnrolled: boolean;
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

// ── Admin: Student Listing ──

/**
 * Lifecycle of a student account as the admin listing presents it. Derived on
 * read from `deletedAt` / `emailVerified` rather than stored, so it can never
 * disagree with the columns it is derived from.
 */
export const STUDENT_STATUSES = ['ACTIVE', 'PENDING', 'INACTIVE'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export interface StudentListItem {
  id: string;
  name: string;
  email: string;
  image: string | null;
  academicLevel: AcademicLevel | null;
  status: StudentStatus;
  /**
   * The listing shows one course per student — the most recently active
   * enrolment. Null when the student has not enrolled in anything yet, which
   * the UI omits rather than filling with a placeholder.
   */
  course: { id: string; title: string } | null;
  /** Percent complete (0-100) of `course`; null whenever `course` is null. */
  progress: number | null;
}

// ── Admin: Dashboard Overview ──

/** A headline count with the change over the trailing seven days. */
export interface AdminTotal {
  value: number;
  addedThisWeek: number;
}

/** One day of the 30-day growth chart. `date` is an ISO calendar date. */
export interface AdminGrowthPoint {
  date: string;
  registered: number;
  active: number;
}

export interface AdminTrackShare {
  academicLevel: AcademicLevel;
  count: number;
  /** Whole percent of students who have picked a track (untracked excluded). */
  percentage: number;
}

/**
 * Activity kinds the schema can actually attest to. The design also shows
 * "Mentor assigned", which has no model behind it and is therefore absent
 * rather than faked.
 */
export const ADMIN_ACTIVITY_TYPES = ['STUDENT_REGISTERED', 'QUIZ_CREATED'] as const;
export type AdminActivityType = (typeof ADMIN_ACTIVITY_TYPES)[number];

export interface AdminActivity {
  id: string;
  type: AdminActivityType;
  /** The line under the heading, e.g. "Ola Aina joined the Tertiary track". */
  detail: string;
  /** ISO timestamp; the client renders it as "2 mins ago". */
  at: string;
}

export interface AdminSubjectEnrolments {
  subject: string;
  enrolments: number;
}

export interface AdminOverview {
  students: AdminTotal;
  courses: AdminTotal;
  quizzes: AdminTotal;
  growth: AdminGrowthPoint[];
  trackDistribution: AdminTrackShare[];
  recentActivity: AdminActivity[];
  topSubjects: AdminSubjectEnrolments[];
  /** Whole percent of enrolments finished; null when nobody has enrolled. */
  courseCompletionRate: number | null;
}

// ── Admin: Analytics ──

/** Date-range choices on the analytics filter bar, in days. */
export const ANALYTICS_RANGE_DAYS = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGE_DAYS)[number];

/** How the registration chart buckets its points. */
export const ANALYTICS_GROUPINGS = ['DAILY', 'WEEKLY'] as const;
export type AnalyticsGrouping = (typeof ANALYTICS_GROUPINGS)[number];

/** How many weeks after sign-up the retention chart follows a cohort. */
export const RETENTION_WEEKS = 5;

export interface AdminRegistrationPoint {
  /** First day of the bucket, as an ISO calendar date. */
  date: string;
  byTrack: Record<AcademicLevel, number>;
}

/**
 * Share of quiz attempts that met the quiz's pass mark. The design calls this
 * "completion", but an attempt is only recorded once it is submitted — there is
 * no row for a quiz started and abandoned — so completion would always be 100%.
 */
export interface AdminSubjectPassRate {
  subject: string;
  attempts: number;
  /** Whole percent. */
  passRate: number;
}

/**
 * Of the students who signed up in the period, the share active during their
 * Nth week after signing up. `rate` is null until at least one of them has been
 * signed up long enough for that week to have finished.
 */
export interface AdminRetentionWeek {
  week: number;
  /** Students whose Nth week has fully elapsed. */
  eligible: number;
  /** Whole percent of `eligible`; null when nobody is eligible yet. */
  rate: number | null;
}

export interface AdminTopStudent {
  id: string;
  name: string;
  image: string | null;
  academicLevel: AcademicLevel | null;
  points: number;
  quizzesTaken: number;
}

export interface AdminAnalytics {
  period: {
    /** ISO timestamps bounding the date-range filter. */
    from: string;
    to: string;
    rangeDays: AnalyticsRangeDays;
    groupBy: AnalyticsGrouping;
  };
  students: AdminTotal;
  courses: AdminTotal;
  quizzes: AdminTotal;
  registrations: AdminRegistrationPoint[];
  trackDistribution: AdminTrackShare[];
  quizPassRates: AdminSubjectPassRate[];
  retention: AdminRetentionWeek[];
  topStudents: AdminTopStudent[];
  topSubjects: AdminSubjectEnrolments[];
  courseCompletionRate: number | null;
}
