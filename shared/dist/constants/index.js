// ─────────────────────────────────────────────────
// GIREAPP — Shared Constants
// Gamification, points, badge thresholds
// ─────────────────────────────────────────────────
// ── Gamification Constants ──
export const POINTS = {
    QUIZ_PASS: 50,
    QUIZ_FAIL: 10,
};
export const BADGE_THRESHOLDS = {
    BRONZE: { label: 'Bronze', minScore: 50, color: '#CD7F32' },
    SILVER: { label: 'Silver', minScore: 70, color: '#C0C0C0' },
    GOLD: { label: 'Gold', minScore: 90, color: '#FFD700' },
    CURRENT_MASTER: { label: 'Current Master', minScore: 95, color: '#3730A3' },
};
// ── Pagination defaults ──
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
};
// ── API paths (relative, without base URL) ──
export const API_PATHS = {
    AUTH: {
        REGISTER: '/api/auth/register',
        LOGIN: '/api/auth/login',
        LOGOUT: '/api/auth/logout',
        ME: '/api/auth/me',
        FORGOT_PASSWORD: '/api/auth/forgot-password',
        RESET_PASSWORD: '/api/auth/reset-password',
        VERIFY_EMAIL: '/api/auth/verify-email',
        RESEND_VERIFICATION: '/api/auth/resend-verification',
        ONBOARDING: '/api/auth/onboarding',
    },
    COURSES: {
        LIST: '/api/courses',
        DETAIL: (courseId) => `/api/courses/${courseId}`,
        ENROL: (courseId) => `/api/courses/${courseId}/enrol`,
        LESSON: (courseId, lessonId) => `/api/courses/${courseId}/lessons/${lessonId}`,
        COMPLETE_LESSON: (courseId, lessonId) => `/api/courses/${courseId}/lessons/${lessonId}/complete`,
    },
    DASHBOARD: {
        OVERVIEW: '/api/dashboard',
    },
    QUIZZES: {
        DETAIL: (quizId) => `/api/quizzes/${quizId}`,
        SUBMIT: (quizId) => `/api/quizzes/${quizId}/submit`,
    },
    ADMIN: {
        COURSES: '/api/admin/courses',
        USERS: '/api/admin/users',
    },
    HEALTH: '/api/health',
};
//# sourceMappingURL=index.js.map