import { z } from 'zod';
export declare const registerSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
    confirmPassword: z.ZodString;
    track: z.ZodOptional<z.ZodString>;
    department: z.ZodOptional<z.ZodString>;
    level: z.ZodOptional<z.ZodString>;
    focusArea: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    track?: string | undefined;
    department?: string | undefined;
    level?: string | undefined;
    focusArea?: string | undefined;
}, {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    track?: string | undefined;
    department?: string | undefined;
    level?: string | undefined;
    focusArea?: string | undefined;
}>, {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    track?: string | undefined;
    department?: string | undefined;
    level?: string | undefined;
    focusArea?: string | undefined;
}, {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    track?: string | undefined;
    department?: string | undefined;
    level?: string | undefined;
    focusArea?: string | undefined;
}>;
export type RegisterInput = z.infer<typeof registerSchema>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type LoginInput = z.infer<typeof loginSchema>;
export declare const forgotPasswordSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export declare const resetPasswordSchema: z.ZodEffects<z.ZodObject<{
    token: z.ZodString;
    password: z.ZodString;
    confirmPassword: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
    confirmPassword: string;
    token: string;
}, {
    password: string;
    confirmPassword: string;
    token: string;
}>, {
    password: string;
    confirmPassword: string;
    token: string;
}, {
    password: string;
    confirmPassword: string;
    token: string;
}>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export declare const onboardingSchema: z.ZodEffects<z.ZodObject<{
    academicLevel: z.ZodEnum<["SECONDARY", "TERTIARY", "PROFESSIONAL"]>;
    department: z.ZodString;
    moodTheme: z.ZodDefault<z.ZodEnum<["calm", "focused", "energized", "relaxed"]>>;
}, "strip", z.ZodTypeAny, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    moodTheme: "calm" | "focused" | "energized" | "relaxed";
}, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    moodTheme?: "calm" | "focused" | "energized" | "relaxed" | undefined;
}>, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    moodTheme: "calm" | "focused" | "energized" | "relaxed";
}, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    moodTheme?: "calm" | "focused" | "energized" | "relaxed" | undefined;
}>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export declare const createCourseSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
    academicLevel: z.ZodEnum<["SECONDARY", "TERTIARY", "PROFESSIONAL"]>;
    department: z.ZodString;
    thumbnailUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    published: z.ZodDefault<z.ZodBoolean>;
    modules: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        order: z.ZodNumber;
        lessons: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            contentType: z.ZodEnum<["TEXT", "PDF", "MARKDOWN", "VIDEO"]>;
            content: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            mediaUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
            order: z.ZodNumber;
            estimatedMinutes: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            estimatedMinutes: number;
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
        }, {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
            estimatedMinutes?: number | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        title: string;
        order: number;
        lessons: {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            estimatedMinutes: number;
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
        }[];
    }, {
        title: string;
        order: number;
        lessons: {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
            estimatedMinutes?: number | undefined;
        }[];
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    title: string;
    description: string;
    published: boolean;
    modules: {
        title: string;
        order: number;
        lessons: {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            estimatedMinutes: number;
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
        }[];
    }[];
    thumbnailUrl?: string | null | undefined;
}, {
    department: string;
    academicLevel: "SECONDARY" | "TERTIARY" | "PROFESSIONAL";
    title: string;
    description: string;
    modules: {
        title: string;
        order: number;
        lessons: {
            title: string;
            order: number;
            contentType: "TEXT" | "PDF" | "MARKDOWN" | "VIDEO";
            content?: string | null | undefined;
            mediaUrl?: string | null | undefined;
            estimatedMinutes?: number | undefined;
        }[];
    }[];
    thumbnailUrl?: string | null | undefined;
    published?: boolean | undefined;
}>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export declare const createQuizSchema: z.ZodObject<{
    courseId: z.ZodString;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    timeLimitMin: z.ZodDefault<z.ZodNumber>;
    passingScore: z.ZodDefault<z.ZodNumber>;
    questions: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        explanation: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        order: z.ZodNumber;
        choices: z.ZodEffects<z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            isCorrect: z.ZodBoolean;
            order: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            order: number;
            text: string;
            isCorrect: boolean;
        }, {
            order: number;
            text: string;
            isCorrect: boolean;
        }>, "many">, {
            order: number;
            text: string;
            isCorrect: boolean;
        }[], {
            order: number;
            text: string;
            isCorrect: boolean;
        }[]>;
    }, "strip", z.ZodTypeAny, {
        order: number;
        text: string;
        choices: {
            order: number;
            text: string;
            isCorrect: boolean;
        }[];
        explanation?: string | null | undefined;
    }, {
        order: number;
        text: string;
        choices: {
            order: number;
            text: string;
            isCorrect: boolean;
        }[];
        explanation?: string | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    title: string;
    courseId: string;
    timeLimitMin: number;
    passingScore: number;
    questions: {
        order: number;
        text: string;
        choices: {
            order: number;
            text: string;
            isCorrect: boolean;
        }[];
        explanation?: string | null | undefined;
    }[];
    description?: string | null | undefined;
}, {
    title: string;
    courseId: string;
    questions: {
        order: number;
        text: string;
        choices: {
            order: number;
            text: string;
            isCorrect: boolean;
        }[];
        explanation?: string | null | undefined;
    }[];
    description?: string | null | undefined;
    timeLimitMin?: number | undefined;
    passingScore?: number | undefined;
}>;
export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export declare const submitQuizSchema: z.ZodObject<{
    quizId: z.ZodString;
    answers: z.ZodRecord<z.ZodString, z.ZodString>;
    startedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    quizId: string;
    answers: Record<string, string>;
    startedAt: string;
}, {
    quizId: string;
    answers: Record<string, string>;
    startedAt: string;
}>;
export type SubmitQuizInput = z.infer<typeof submitQuizSchema>;
export declare const contactFormSchema: z.ZodObject<{
    subject: z.ZodString;
    message: z.ZodString;
    urgency: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    subject: string;
    urgency: "low" | "medium" | "high";
}, {
    message: string;
    subject: string;
    urgency?: "low" | "medium" | "high" | undefined;
}>;
export type ContactFormInput = z.infer<typeof contactFormSchema>;
export declare const updateProgressSchema: z.ZodObject<{
    courseId: z.ZodString;
    lessonId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    courseId: string;
    lessonId: string;
}, {
    courseId: string;
    lessonId: string;
}>;
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export declare const uploadRequestSchema: z.ZodObject<{
    fileName: z.ZodString;
    contentType: z.ZodString;
    fileSize: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    contentType: string;
    fileName: string;
    fileSize: number;
}, {
    contentType: string;
    fileName: string;
    fileSize: number;
}>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
//# sourceMappingURL=index.d.ts.map