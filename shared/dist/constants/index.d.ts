import type { BadgeType } from '../types/index.js';
export declare const POINTS: {
    readonly QUIZ_PASS: 50;
    readonly QUIZ_FAIL: 10;
};
export declare const BADGE_THRESHOLDS: Record<BadgeType, {
    label: string;
    minScore: number;
    color: string;
}>;
export declare const PAGINATION: {
    readonly DEFAULT_PAGE: 1;
    readonly DEFAULT_LIMIT: 20;
    readonly MAX_LIMIT: 100;
};
export declare const API_PATHS: {
    readonly AUTH: {
        readonly REGISTER: "/api/auth/register";
        readonly LOGIN: "/api/auth/login";
        readonly LOGOUT: "/api/auth/logout";
        readonly ME: "/api/auth/me";
        readonly FORGOT_PASSWORD: "/api/auth/forgot-password";
        readonly RESET_PASSWORD: "/api/auth/reset-password";
        readonly VERIFY_EMAIL: "/api/auth/verify-email";
        readonly RESEND_VERIFICATION: "/api/auth/resend-verification";
        readonly ONBOARDING: "/api/auth/onboarding";
    };
    readonly COURSES: {
        readonly LIST: "/api/courses";
        readonly DETAIL: (courseId: string) => string;
        readonly ENROL: (courseId: string) => string;
        readonly LESSON: (courseId: string, lessonId: string) => string;
        readonly COMPLETE_LESSON: (courseId: string, lessonId: string) => string;
    };
    readonly DASHBOARD: {
        readonly OVERVIEW: "/api/dashboard";
    };
    readonly QUIZZES: {
        readonly DETAIL: (quizId: string) => string;
        readonly SUBMIT: (quizId: string) => string;
    };
    readonly ADMIN: {
        readonly COURSES: "/api/admin/courses";
        readonly USERS: "/api/admin/users";
    };
    readonly HEALTH: "/api/health";
};
//# sourceMappingURL=index.d.ts.map