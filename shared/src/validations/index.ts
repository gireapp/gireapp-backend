// ─────────────────────────────────────────────────
// GIREAPP — Shared Zod Validation Schemas
// Used on both frontend (forms) and backend (controllers)
// ─────────────────────────────────────────────────

import { z } from 'zod';
import {
  ACADEMIC_LEVELS,
  MOOD_THEMES,
  DEPARTMENTS,
  STUDENT_STATUSES,
  ANALYTICS_RANGE_DAYS,
  ANALYTICS_GROUPINGS,
  type AnalyticsRangeDays,
  QUIZ_DIFFICULTIES,
  QUESTION_POINT_OPTIONS,
  QUIZ_TIME_LIMIT_OPTIONS,
  QUIZ_PASS_MARK_OPTIONS,
  MIN_CHOICES,
  MAX_CHOICES,
  type QuestionPoints,
  type QuizTimeLimit,
  type QuizPassMark,
} from '../types/index.js';
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

const QUIZ_TITLE_MIN = 3;
const QUIZ_TITLE_MAX = 200;
const QUESTION_TEXT_MIN = 5;
const MAX_QUESTIONS = 100;

const quizChoiceSchema = z.object({
  text: z.string().trim().max(500, 'Answer must be under 500 characters'),
  isCorrect: z.boolean(),
});

const quizQuestionSchema = z.object({
  text: z.string().trim().max(1000, 'Question must be under 1000 characters'),
  explanation: z.string().trim().max(1000).optional().nullable(),
  points: z.number().int().refine(isQuestionPoints, {
    message: `Points must be one of ${QUESTION_POINT_OPTIONS.join(', ')}`,
  }),
  choices: z
    .array(quizChoiceSchema)
    .min(MIN_CHOICES, `Each question needs at least ${MIN_CHOICES} answers`)
    .max(MAX_CHOICES, `Each question can have at most ${MAX_CHOICES} answers`),
});

function isQuestionPoints(points: number): points is QuestionPoints {
  return (QUESTION_POINT_OPTIONS as readonly number[]).includes(points);
}

/**
 * One schema for both saving a draft and publishing. A draft may be
 * incomplete — empty questions, no correct answer yet — because the point of a
 * draft is to come back to it. Publishing is what puts a quiz in front of
 * learners, so only then is every question required to be answerable.
 *
 * Question order is the array order; there is no client-supplied `order`
 * field for a request to get wrong.
 */
export const saveQuizSchema = z
  .object({
    courseId: z.string().cuid('Choose a subject'),
    title: z
      .string()
      .trim()
      .min(QUIZ_TITLE_MIN, `Title must be at least ${QUIZ_TITLE_MIN} characters`)
      .max(QUIZ_TITLE_MAX, `Title must be under ${QUIZ_TITLE_MAX} characters`),
    description: z.string().trim().max(500, 'Description must be under 500 characters').optional().nullable(),
    difficulty: z.enum(QUIZ_DIFFICULTIES).optional().nullable(),
    timeLimitMin: z.number().int().refine(isTimeLimit, {
      message: `Time limit must be one of ${QUIZ_TIME_LIMIT_OPTIONS.join(', ')} minutes`,
    }),
    passingScore: z.number().int().refine(isPassMark, {
      message: `Pass mark must be one of ${QUIZ_PASS_MARK_OPTIONS.join(', ')}%`,
    }),
    publish: z.boolean(),
    questions: z.array(quizQuestionSchema).max(MAX_QUESTIONS, `A quiz can have at most ${MAX_QUESTIONS} questions`),
  })
  .superRefine((quiz, ctx) => {
    if (!quiz.publish) return;

    if (!quiz.difficulty) {
      ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'Choose a difficulty before publishing' });
    }
    if (quiz.questions.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Add at least one question before publishing' });
    }

    quiz.questions.forEach((question, index) => {
      if (question.text.length < QUESTION_TEXT_MIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', index, 'text'],
          message: `Question ${index + 1} needs at least ${QUESTION_TEXT_MIN} characters`,
        });
      }
      if (question.choices.some((choice) => choice.text.length === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', index, 'choices'],
          message: `Question ${index + 1} has an empty answer`,
        });
      }
      if (question.choices.filter((choice) => choice.isCorrect).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', index, 'choices'],
          message: `Mark exactly one correct answer for question ${index + 1}`,
        });
      }
    });
  });

function isTimeLimit(minutes: number): minutes is QuizTimeLimit {
  return (QUIZ_TIME_LIMIT_OPTIONS as readonly number[]).includes(minutes);
}

function isPassMark(percent: number): percent is QuizPassMark {
  return (QUIZ_PASS_MARK_OPTIONS as readonly number[]).includes(percent);
}

export type SaveQuizInput = z.infer<typeof saveQuizSchema>;

/**
 * What a client sends before validation. `SaveQuizInput` is the parsed result,
 * where points, time limit and pass mark are narrowed to their allowed values;
 * a form holding unvalidated state can only honestly promise plain numbers.
 */
export type SaveQuizRequest = z.input<typeof saveQuizSchema>;

/**
 * Validation issues keyed by dotted path ("questions.2.choices"). `flatten()`
 * only keeps top-level fields, which would lose every per-question message.
 */
export function issuesByPath(error: z.ZodError): Record<string, string[]> {
  const byPath: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (byPath[key] ??= []).push(issue.message);
  }
  return byPath;
}

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

// ── Admin: Analytics ──

const DEFAULT_ANALYTICS_RANGE_DAYS: AnalyticsRangeDays = 30;

function isAnalyticsRange(days: number): days is AnalyticsRangeDays {
  return (ANALYTICS_RANGE_DAYS as readonly number[]).includes(days);
}

export const analyticsQuerySchema = z.object({
  rangeDays: z.coerce
    .number()
    .refine(isAnalyticsRange, {
      message: `Range must be one of ${ANALYTICS_RANGE_DAYS.join(', ')} days`,
    })
    .default(DEFAULT_ANALYTICS_RANGE_DAYS),
  academicLevel: z.enum(ACADEMIC_LEVELS).optional(),
  courseId: z.string().cuid('Invalid course ID').optional(),
  groupBy: z.enum(ANALYTICS_GROUPINGS).default('DAILY'),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
