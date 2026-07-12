// ─────────────────────────────────────────────────
// GIREAPP — Shared Zod Validation Schemas
// Used on both frontend (forms) and backend (controllers)
// ─────────────────────────────────────────────────
import { z } from 'zod';
import { ACADEMIC_LEVELS, MOOD_THEMES, DEPARTMENTS } from '../types';
// ── Auth Schemas ──
export const registerSchema = z.object({
    name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must be under 100 characters')
        .trim(),
    email: z
        .string()
        .email('Please enter a valid email address')
        .max(255, 'Email must be under 255 characters')
        .transform((e) => e.toLowerCase().trim()),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password must be under 128 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    confirmPassword: z.string(),
    track: z.string().optional(),
    department: z.string().optional(),
    level: z.string().optional(),
    focusArea: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
export const loginSchema = z.object({
    email: z
        .string()
        .email('Please enter a valid email address')
        .transform((e) => e.toLowerCase().trim()),
    password: z.string().min(1, 'Password is required'),
});
export const forgotPasswordSchema = z.object({
    email: z
        .string()
        .email('Please enter a valid email address')
        .transform((e) => e.toLowerCase().trim()),
});
export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password must be under 128 characters')
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
// ── Onboarding Schemas ──
export const onboardingSchema = z.object({
    academicLevel: z.enum(ACADEMIC_LEVELS, {
        errorMap: () => ({ message: 'Please select your academic level' }),
    }),
    department: z.string().min(1, 'Please select your department'),
    moodTheme: z.enum(MOOD_THEMES).default('calm'),
}).refine((data) => {
    const validDepartments = DEPARTMENTS[data.academicLevel];
    return validDepartments?.includes(data.department) ?? false;
}, {
    message: 'Selected department does not match your academic level',
    path: ['department'],
});
// ── Course Schemas ──
export const createCourseSchema = z.object({
    title: z
        .string()
        .min(3, 'Title must be at least 3 characters')
        .max(200, 'Title must be under 200 characters')
        .trim(),
    description: z
        .string()
        .min(10, 'Description must be at least 10 characters')
        .max(2000, 'Description must be under 2000 characters')
        .trim(),
    academicLevel: z.enum(ACADEMIC_LEVELS),
    department: z.string().min(1, 'Department is required'),
    thumbnailUrl: z.string().url().optional().nullable(),
    published: z.boolean().default(false),
    modules: z.array(z.object({
        title: z.string().min(1, 'Module title is required').max(200).trim(),
        order: z.number().int().min(0),
        lessons: z.array(z.object({
            title: z.string().min(1, 'Lesson title is required').max(200).trim(),
            contentType: z.enum(['TEXT', 'PDF', 'MARKDOWN', 'VIDEO']),
            content: z.string().optional().nullable(),
            mediaUrl: z.string().url().optional().nullable(),
            order: z.number().int().min(0),
            estimatedMinutes: z.number().int().min(1).max(300).default(10),
        })).min(1, 'Each module must have at least one lesson'),
    })).min(1, 'Course must have at least one module'),
});
// ── Quiz Schemas ──
export const createQuizSchema = z.object({
    courseId: z.string().cuid('Invalid course ID'),
    title: z
        .string()
        .min(3, 'Title must be at least 3 characters')
        .max(200, 'Title must be under 200 characters')
        .trim(),
    description: z.string().max(500).optional().nullable(),
    timeLimitMin: z.number().int().min(1).max(180).default(30),
    passingScore: z.number().int().min(1).max(100).default(70),
    questions: z.array(z.object({
        text: z.string().min(5, 'Question text too short').max(1000).trim(),
        explanation: z.string().max(500).optional().nullable(),
        order: z.number().int().min(0),
        choices: z.array(z.object({
            text: z.string().min(1, 'Choice text is required').max(500).trim(),
            isCorrect: z.boolean(),
            order: z.number().int().min(0),
        })).min(2, 'Each question must have at least 2 choices')
            .refine((choices) => choices.filter((c) => c.isCorrect).length === 1, 'Each question must have exactly one correct answer'),
    })).min(1, 'Quiz must have at least one question'),
});
export const submitQuizSchema = z.object({
    quizId: z.string().cuid('Invalid quiz ID'),
    answers: z.record(z.string().cuid('Invalid question ID'), z.string().cuid('Invalid choice ID')),
    startedAt: z.string().datetime('Invalid timestamp'),
});
// ── Mentorship / Contact Form ──
export const contactFormSchema = z.object({
    subject: z
        .string()
        .min(3, 'Subject must be at least 3 characters')
        .max(200, 'Subject must be under 200 characters')
        .trim(),
    message: z
        .string()
        .min(20, 'Please provide more detail (at least 20 characters)')
        .max(2000, 'Message must be under 2000 characters')
        .trim(),
    urgency: z.enum(['low', 'medium', 'high']).default('medium'),
});
// ── Progress ──
export const updateProgressSchema = z.object({
    courseId: z.string().cuid('Invalid course ID'),
    lessonId: z.string().cuid('Invalid lesson ID'),
});
// ── Upload ──
export const uploadRequestSchema = z.object({
    fileName: z
        .string()
        .min(1, 'File name is required')
        .max(255, 'File name too long'),
    contentType: z.string().min(1, 'Content type is required'),
    fileSize: z
        .number()
        .int()
        .positive('File size must be positive')
        .max(100 * 1024 * 1024, 'File size must be under 100 MB'),
});
//# sourceMappingURL=index.js.map