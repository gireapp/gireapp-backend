// ─────────────────────────────────────────────────
// GIREAPP — Shared Types & Enums
// Single source of truth for TypeScript types
// Used by both frontend and backend
// ─────────────────────────────────────────────────
/** Academic level segments — maps to user onboarding selection */
export const ACADEMIC_LEVELS = ['SECONDARY', 'TERTIARY', 'PROFESSIONAL'];
/** User roles for RBAC */
export const ROLES = ['STUDENT', 'TUTOR', 'ADMIN'];
/** Content types supported in lessons */
export const CONTENT_TYPES = ['TEXT', 'PDF', 'MARKDOWN', 'VIDEO'];
/** Gamification badge tiers */
export const BADGE_TYPES = ['BRONZE', 'SILVER', 'GOLD', 'CURRENT_MASTER'];
/** Mood themes for UI personalization */
export const MOOD_THEMES = ['calm', 'focused', 'energized', 'relaxed'];
/** Department options per academic level */
export const DEPARTMENTS = {
    SECONDARY: ['Science', 'Business', 'Arts'],
    TERTIARY: ['Undergraduate', 'Postgraduate'],
    PROFESSIONAL: ['Data Analytics', 'Project Management', 'Digital Marketing', 'Software Engineering'],
};
//# sourceMappingURL=index.js.map