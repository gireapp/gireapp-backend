/** Academic level segments — maps to user onboarding selection */
export declare const ACADEMIC_LEVELS: readonly ["SECONDARY", "TERTIARY", "PROFESSIONAL"];
export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];
/** User roles for RBAC */
export declare const ROLES: readonly ["STUDENT", "TUTOR", "ADMIN"];
export type Role = (typeof ROLES)[number];
/** Content types supported in lessons */
export declare const CONTENT_TYPES: readonly ["TEXT", "PDF", "MARKDOWN", "VIDEO"];
export type ContentType = (typeof CONTENT_TYPES)[number];
/** Gamification badge tiers */
export declare const BADGE_TYPES: readonly ["BRONZE", "SILVER", "GOLD", "CURRENT_MASTER"];
export type BadgeType = (typeof BADGE_TYPES)[number];
/** Mood themes for UI personalization */
export declare const MOOD_THEMES: readonly ["calm", "focused", "energized", "relaxed"];
export type MoodTheme = (typeof MOOD_THEMES)[number];
/** Department options per academic level */
export declare const DEPARTMENTS: Record<AcademicLevel, readonly string[]>;
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
    progress: number;
    estimatedMinutes: number;
}
export interface ActivityItem {
    id: string;
    type: 'lesson_completed' | 'quiz_passed' | 'quiz_failed' | 'badge_earned' | 'course_enrolled';
    title: string;
    timestamp: string;
    metadata?: Record<string, string | number>;
}
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
    module: {
        id: string;
        title: string;
    };
    allLessonsCount: number;
    currentIndex: number;
}
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
    answers: Record<string, string>;
    startedAt: string;
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
//# sourceMappingURL=index.d.ts.map