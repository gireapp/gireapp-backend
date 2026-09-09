// ─────────────────────────────────────────────────
// GIREAPP — Shared Zod Validation Schemas
// Used on both frontend (forms) and backend (controllers)
// ─────────────────────────────────────────────────

import { z } from 'zod';
import { ACADEMIC_LEVELS, MOOD_THEMES, DEPARTMENTS, STUDENT_STATUSES } from '../types/index.js';
import { PAGINATION } from '../constants/index.js';

// ── Auth Schemas ──

/**
 * Age in whole years as of `reference` (defaults to now). The single definition of
 * "minor" for both sides of the system: the backend derives `isMinor` from the
 * stored `dateOfBirth` with this function on read rather than persisting a flag, so
 * it cannot go stale as a learner turns 18.
 *
 * A Postgres generated column was considered and is not possible — `CURRENT_DATE`
 * is not immutable, so it cannot appear in a `GENERATED ALWAYS AS` expression.
 */
export function calculateAge(dob: Date, reference: Date = new Date()): number {
  let age = reference.getFullYear() - dob.getFullYear();
  const monthDiff = reference.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}


export const registerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters')
    .trim(),
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .max(255, 'Email must be under 255 characters')
    .transform((e) => e.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be under 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    ),
  confirmPassword: z.string(),
  dateOfBirth: z
    .string()
    .min(1, 'Date of birth is required')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Please enter a valid date')
    .refine((v) => new Date(v) <= new Date(), 'Date of birth cannot be in the future')
    .refine((v) => calculateAge(new Date(v)) <= 120, 'Please enter a valid date of birth'),
  // Only required for under-18 accounts, enforced by the whole-object refine below.
  guardianEmail: z
    .union([z.string().trim().email('Please enter a valid guardian email address'), z.literal('')])
    .optional()
    .transform((v) => (v ? v : undefined)),
  track: z.string().optional(),
  department: z.string().optional(),
  level: z.string().optional(),
  focusArea: z.string().optional(),
})
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => {
      const dob = new Date(data.dateOfBirth);
      if (Number.isNaN(dob.getTime())) return true; // dateOfBirth's own validation already reports this
      return calculateAge(dob) >= 18 || !!data.guardianEmail;
    },
    {
      message: 'A guardian email is required for accounts under 18',
      path: ['guardianEmail'],
    }
  );

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .transform((e) => e.toLowerCase()),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address')
    .transform((e) => e.toLowerCase()),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be under 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    ),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Changing a password from inside the account, where the current password is
 * the proof of identity — unlike the reset flow, which proves it by email.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Please enter your current password'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be under 128 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.password, {
    message: 'Your new password must be different from your current one',
    path: ['password'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Changing the account's email from inside the account. The address is typed
 * twice because a typo here is unrecoverable — the confirmation link goes to
 * the new address, and nobody would ever receive it. The current password is
 * required because a live session alone is not proof of ownership: whoever holds
 * one could otherwise move the account to an inbox the real owner cannot reach.
 */
export const updateEmailSchema = z
  .object({
    // Trimmed before the address is judged: a trailing space survives a
    // copy-paste far more often than a typo does.
    newEmail: z
      .string()
      .trim()
      .email('Please enter a valid email address')
      .max(255, 'Email must be under 255 characters')
      .transform((e) => e.toLowerCase()),
    confirmEmail: z
      .string()
      .trim()
      .min(1, 'Please confirm your new email address')
      .transform((e) => e.toLowerCase()),
    currentPassword: z
      .string()
      .min(1, 'Please enter your current password'),
  })
  .refine((data) => data.newEmail === data.confirmEmail, {
    message: 'Email addresses do not match',
    path: ['confirmEmail'],
  });

export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;

/**
 * Saving a profile photo. The browser uploads straight to storage and reports
 * the key back, so `key` arrives as untrusted input — the server checks it is
 * one it minted before writing it to the row.
 */
export const updateAvatarSchema = z.object({
  key: z.string().min(1, 'Please choose a photo to upload'),
});

export type UpdateAvatarInput = z.infer<typeof updateAvatarSchema>;

/**
 * Changing the display name. Trimmed before it is measured, so surrounding
 * spaces cannot pad a one-character name past the minimum.
 */
export const updateNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters'),
});

export type UpdateNameInput = z.infer<typeof updateNameSchema>;

// ── Onboarding Schemas ──

export const onboardingSchema = z.object({
  academicLevel: z.enum(ACADEMIC_LEVELS, {
    errorMap: () => ({ message: 'Please select your academic level' }),
  }),
  department: z.string().min(1, 'Please select your department'),
  moodTheme: z.enum(MOOD_THEMES).default('calm'),
}).refine(
  (data) => {
    const validDepartments = DEPARTMENTS[data.academicLevel];
    return validDepartments?.includes(data.department) ?? false;
  },
  {
    message: 'Selected department does not match your academic level',
    path: ['department'],
  }
);

export type OnboardingInput = z.infer<typeof onboardingSchema>;

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
  modules: z.array(
    z.object({
      title: z.string().min(1, 'Module title is required').max(200).trim(),
      order: z.number().int().min(0),
      lessons: z.array(
        z.object({
          title: z.string().min(1, 'Lesson title is required').max(200).trim(),
          contentType: z.enum(['TEXT', 'PDF', 'MARKDOWN', 'VIDEO']),
          content: z.string().optional().nullable(),
          mediaUrl: z.string().url().optional().nullable(),
          order: z.number().int().min(0),
          estimatedMinutes: z.number().int().min(1).max(300).default(10),
        })
      ).min(1, 'Each module must have at least one lesson'),
    })
  ).min(1, 'Course must have at least one module'),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;

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
  questions: z.array(
    z.object({
      text: z.string().min(5, 'Question text too short').max(1000).trim(),
      explanation: z.string().max(500).optional().nullable(),
      order: z.number().int().min(0),
      choices: z.array(
        z.object({
          text: z.string().min(1, 'Choice text is required').max(500).trim(),
          isCorrect: z.boolean(),
          order: z.number().int().min(0),
        })
      ).min(2, 'Each question must have at least 2 choices')
       .refine(
         (choices) => choices.filter((c) => c.isCorrect).length === 1,
         'Each question must have exactly one correct answer'
       ),
    })
  ).min(1, 'Quiz must have at least one question'),
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>;

export const submitQuizSchema = z.object({
  quizId: z.string().cuid('Invalid quiz ID'),
  answers: z.record(
    z.string().cuid('Invalid question ID'),
    z.string().cuid('Invalid choice ID')
  ),
  startedAt: z.string().datetime('Invalid timestamp'),
});

export type SubmitQuizInput = z.infer<typeof submitQuizSchema>;

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

export type ContactFormInput = z.infer<typeof contactFormSchema>;

// ── Progress ──

export const updateProgressSchema = z.object({
  courseId: z.string().cuid('Invalid course ID'),
  lessonId: z.string().cuid('Invalid lesson ID'),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;

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

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

// ── Admin: Student Listing ──

export const studentListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  courseId: z.string().cuid('Invalid course ID').optional(),
  academicLevel: z.enum(ACADEMIC_LEVELS).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
});

export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
