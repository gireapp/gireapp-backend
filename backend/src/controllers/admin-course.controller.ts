import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  issuesByPath,
  isWrittenContentType,
  saveCourseSchema,
  type AdminCourse,
  type AdminCourseSummary,
  type SaveCourseInput,
} from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { extensionOf, isMintedObjectKey } from '../services/storage';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

/*
 * Course text is stored exactly as typed, as quiz text is — see
 * admin-quiz.controller.ts. The old create path ran the threat detector, which
 * rejects any lesson that quotes SQL, and HTML-escaped on the way in, which
 * shows "Ohm's law" to learners as "Ohm&#x27;s law". Prisma binds values as
 * parameters; lessons render through React and react-markdown without raw
 * HTML, so stored text cannot become markup.
 */

type StaffUser = AuthenticatedRequest['user'];

/**
 * Prisma's default 5s is too tight for a large restructure: each write is a
 * round trip to the database, and moving dozens of lessons is dozens of them.
 */
const SAVE_TRANSACTION_TIMEOUT_MS = 30_000;

/** Which file types each uploaded lesson type accepts. */
const MEDIA_EXTENSIONS: Record<string, readonly string[]> = {
  PDF: ['.pdf'],
  VIDEO: ['.mp4', '.webm', '.mov'],
};

/** Admins may manage any course; a tutor only the courses they wrote. */
function editableBy(user: StaffUser): Prisma.CourseWhereInput {
  return {
    deletedAt: null,
    ...(user.role === 'ADMIN' ? {} : { createdById: user.userId }),
  };
}

function canEdit(user: StaffUser, createdById: string | null): boolean {
  return user.role === 'ADMIN' || createdById === user.userId;
}

class CourseRuleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: Record<string, string[]>
  ) {
    super(message);
  }
}

// ── Validation beyond the shared schema ──

type ExistingLesson = { id: string; moduleId: string; title: string; mediaUrl: string | null; hasProgress: boolean };

/**
 * Lesson media must be a key this server minted for an upload, of a type that
 * matches the lesson. A lesson's existing link may also come back unchanged —
 * the seed data points at a static file, and editing a course must not reject
 * media it never touched.
 */
export function mediaProblem(
  lesson: SaveCourseInput['modules'][number]['lessons'][number],
  existing: ExistingLesson | undefined
): string | null {
  if (isWrittenContentType(lesson.contentType) || !lesson.mediaUrl) return null;
  if (existing && lesson.mediaUrl === existing.mediaUrl) return null;
  if (!isMintedObjectKey(lesson.mediaUrl)) return 'Upload the file again';

  const allowed = MEDIA_EXTENSIONS[lesson.contentType] ?? [];
  return allowed.includes(extensionOf(lesson.mediaUrl))
    ? null
    : `A ${lesson.contentType.toLowerCase()} lesson needs a ${allowed.join(', ')} file`;
}

function checkMedia(input: SaveCourseInput, existingById: Map<string, ExistingLesson>): void {
  const errors: Record<string, string[]> = {};

  input.modules.forEach((module, moduleIndex) =>
    module.lessons.forEach((lesson, lessonIndex) => {
      const problem = mediaProblem(lesson, lesson.id ? existingById.get(lesson.id) : undefined);
      if (problem) errors[`modules.${moduleIndex}.lessons.${lessonIndex}.mediaUrl`] = [problem];
    })
  );

  if (Object.keys(errors).length > 0) throw new CourseRuleError(422, 'Validation failed.', errors);
}

/**
 * Lessons a learner has completed cannot be removed: their progress row
 * points at the lesson, and deleting it would silently cut their progress.
 * Lesson and module ids must belong to this course, so a request cannot pull
 * another course's lesson in by id.
 */
export function checkStructure(
  input: SaveCourseInput,
  existingModuleIds: Set<string>,
  existingById: Map<string, ExistingLesson>
): void {
  const keptLessonIds = new Set<string>();

  for (const module of input.modules) {
    if (module.id && !existingModuleIds.has(module.id)) {
      throw new CourseRuleError(422, 'A module in this request does not belong to the course.');
    }
    for (const lesson of module.lessons) {
      if (!lesson.id) continue;
      if (!existingById.has(lesson.id) || keptLessonIds.has(lesson.id)) {
        throw new CourseRuleError(422, 'A lesson in this request does not belong to the course.');
      }
      keptLessonIds.add(lesson.id);
    }
  }

  const blocked = [...existingById.values()].filter(
    (lesson) => !keptLessonIds.has(lesson.id) && lesson.hasProgress
  );
  if (blocked.length > 0) {
    const names = blocked.map((lesson) => `"${lesson.title}"`).join(', ');
    throw new CourseRuleError(
      409,
      `Learners have completed ${names}, so ${blocked.length === 1 ? 'it' : 'they'} cannot be removed. ` +
        'Edit the lesson instead, or unpublish the course.'
    );
  }
}

// ── Persistence ──

function courseFields(input: SaveCourseInput) {
  return {
    title: input.title,
    description: input.description,
    academicLevel: input.academicLevel,
    department: input.department,
    published: input.publish,
  };
}

function lessonFields(lesson: SaveCourseInput['modules'][number]['lessons'][number], order: number) {
  const written = isWrittenContentType(lesson.contentType);
  return {
    title: lesson.title,
    contentType: lesson.contentType,
    // Only the field that matches the type is kept, so switching a lesson
    // from PDF to text does not leave an orphaned file link behind.
    content: written ? (lesson.content ?? '') : null,
    mediaUrl: written ? null : (lesson.mediaUrl ?? null),
    estimatedMinutes: lesson.estimatedMinutes,
    order,
  };
}

type LessonRow = ReturnType<typeof lessonFields> & { moduleId: string };

/** True when saving `next` over `stored` would change nothing. */
export function lessonUnchanged(stored: LessonRow, next: LessonRow): boolean {
  return (Object.keys(next) as (keyof LessonRow)[]).every((key) => stored[key] === next[key]);
}

/**
 * Every enrolment's stored progress is a fraction of the course's lessons, so
 * adding or removing a lesson changes it. Recomputed in one statement for the
 * whole course rather than left stale until each learner's next completion.
 */
function recomputeEnrolmentProgress(tx: Prisma.TransactionClient, courseId: string) {
  return tx.$executeRaw`
    UPDATE enrolments e
    SET progress = COALESCE(
      (
        SELECT COUNT(*)::float
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp."lessonId"
        JOIN modules m ON m.id = l."moduleId"
        WHERE m."courseId" = e."courseId" AND lp."userId" = e."userId" AND lp.completed
      ) / NULLIF(
        (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l."moduleId" WHERE m."courseId" = e."courseId"),
        0
      ),
      0
    )
    WHERE e."courseId" = ${courseId}
  `;
}

const COURSE_FOR_EDITING = {
  modules: {
    orderBy: { order: 'asc' },
    select: {
      id: true,
      title: true,
      order: true,
      lessons: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          contentType: true,
          content: true,
          mediaUrl: true,
          estimatedMinutes: true,
          order: true,
          _count: { select: { progress: true } },
        },
      },
    },
  },
  _count: { select: { enrolments: true } },
} satisfies Prisma.CourseInclude;

type CourseForEditing = Prisma.CourseGetPayload<{ include: typeof COURSE_FOR_EDITING }>;

function toAdminCourse(course: CourseForEditing): AdminCourse {
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    academicLevel: course.academicLevel,
    department: course.department,
    published: course.published,
    enrolmentCount: course._count.enrolments,
    updatedAt: course.updatedAt.toISOString(),
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: module.lessons.map(({ _count, order: _order, ...lesson }) => ({
        ...lesson,
        hasProgress: _count.progress > 0,
      })),
    })),
  };
}

function parseSave(req: Request, res: Response): SaveCourseInput | null {
  const result = saveCourseSchema.safeParse(req.body);
  if (result.success) return result.data;
  res.status(422).json({ error: 'Validation failed.', errors: issuesByPath(result.error) });
  return null;
}

function respondToFailure(res: Response, req: Request, message: string, error: unknown): void {
  if (error instanceof CourseRuleError) {
    res.status(error.status).json({ error: error.message, ...(error.errors ? { errors: error.errors } : {}) });
    return;
  }
  logger.error(message, {
    errorMessage: (error as Error).message,
    userId: (req as AuthenticatedRequest).user?.userId,
  });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
}

// ── Handlers ──

/**
 * Every course with its counts. Also the options behind the admin course
 * filters and the quiz builder's subject picker, which only read id, title and
 * track — so tutors see every course, and `canEdit` marks the ones they own.
 */
export const listCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const courses = await prisma.course.findMany({
      where: { deletedAt: null },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        academicLevel: true,
        department: true,
        published: true,
        createdById: true,
        updatedAt: true,
        modules: { select: { _count: { select: { lessons: true } } } },
        _count: { select: { modules: true, quizzes: true, enrolments: true } },
      },
    });

    const data: AdminCourseSummary[] = courses.map((course) => ({
      id: course.id,
      title: course.title,
      academicLevel: course.academicLevel,
      department: course.department,
      published: course.published,
      moduleCount: course._count.modules,
      lessonCount: course.modules.reduce((sum, module) => sum + module._count.lessons, 0),
      quizCount: course._count.quizzes,
      enrolmentCount: course._count.enrolments,
      canEdit: canEdit(user, course.createdById),
      updatedAt: course.updatedAt.toISOString(),
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    respondToFailure(res, req, 'List courses error', error);
  }
};

export const getCourseForEditing = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId } = req.params as { courseId: string };
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...editableBy((req as AuthenticatedRequest).user) },
      include: COURSE_FOR_EDITING,
    });

    // 404 for "not yours" too, so tutors cannot probe for other course ids.
    if (!course) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    res.status(200).json({ success: true, data: toAdminCourse(course) });
  } catch (error) {
    respondToFailure(res, req, 'Get course error', error);
  }
};

export const createCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = parseSave(req, res);
    if (!input) return;

    const user = (req as AuthenticatedRequest).user;
    if (input.modules.some((module) => module.id || module.lessons.some((lesson) => lesson.id))) {
      throw new CourseRuleError(422, 'A new course cannot reuse existing modules or lessons.');
    }
    checkMedia(input, new Map());

    const course = await prisma.course.create({
      data: {
        ...courseFields(input),
        createdById: user.userId,
        modules: {
          create: input.modules.map((module, moduleIndex) => ({
            title: module.title,
            order: moduleIndex,
            lessons: {
              create: module.lessons.map((lesson, lessonIndex) => lessonFields(lesson, lessonIndex)),
            },
          })),
        },
      },
      include: COURSE_FOR_EDITING,
    });

    logger.info('Course created', { courseId: course.id, published: course.published, userId: user.userId });
    res.status(201).json({ success: true, data: toAdminCourse(course) });
  } catch (error) {
    respondToFailure(res, req, 'Create course error', error);
  }
};

export const updateCourse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId } = req.params as { courseId: string };
    const input = parseSave(req, res);
    if (!input) return;

    const user = (req as AuthenticatedRequest).user;
    const existing = await prisma.course.findFirst({
      where: { id: courseId, ...editableBy(user) },
      include: COURSE_FOR_EDITING,
    });
    if (!existing) {
      res.status(404).json({ error: 'Course not found.' });
      return;
    }

    const existingById = new Map<string, ExistingLesson>(
      existing.modules.flatMap((module) =>
        module.lessons.map((lesson) => [
          lesson.id,
          {
            id: lesson.id,
            moduleId: module.id,
            title: lesson.title,
            mediaUrl: lesson.mediaUrl,
            hasProgress: lesson._count.progress > 0,
          },
        ])
      )
    );
    checkStructure(input, new Set(existing.modules.map((module) => module.id)), existingById);
    checkMedia(input, existingById);

    const keptModuleIds = new Set(input.modules.flatMap((module) => (module.id ? [module.id] : [])));
    const keptLessonIds = new Set(
      input.modules.flatMap((module) => module.lessons.flatMap((lesson) => (lesson.id ? [lesson.id] : [])))
    );

    const storedModules = new Map(existing.modules.map((module) => [module.id, module]));
    const storedLessons = new Map<string, LessonRow>(
      existing.modules.flatMap((module) =>
        module.lessons.map((lesson) => [
          lesson.id,
          {
            title: lesson.title,
            contentType: lesson.contentType,
            content: lesson.content,
            mediaUrl: lesson.mediaUrl,
            estimatedMinutes: lesson.estimatedMinutes,
            order: lesson.order,
            moduleId: module.id,
          },
        ])
      )
    );

    // Only rows that actually changed are written: each write is a round trip,
    // and rewriting every lesson of a large course on each save would outlast
    // the transaction for no reason.
    const course = await prisma.$transaction(async (tx) => {
      // Removed lessons go first, and removed modules last, once every kept
      // lesson has been moved out of them — so a module delete's cascade can
      // only ever reach lessons nobody asked to keep.
      await tx.lesson.deleteMany({
        where: { id: { in: [...existingById.keys()].filter((id) => !keptLessonIds.has(id)) } },
      });

      for (const [moduleIndex, module] of input.modules.entries()) {
        let moduleId: string;
        if (module.id) {
          moduleId = module.id;
          const stored = storedModules.get(module.id);
          if (stored?.title !== module.title || stored.order !== moduleIndex) {
            await tx.module.update({
              where: { id: module.id },
              data: { title: module.title, order: moduleIndex },
            });
          }
        } else {
          moduleId = (
            await tx.module.create({
              data: { courseId, title: module.title, order: moduleIndex },
              select: { id: true },
            })
          ).id;
        }

        for (const [lessonIndex, lesson] of module.lessons.entries()) {
          const fields: LessonRow = { ...lessonFields(lesson, lessonIndex), moduleId };
          if (!lesson.id) {
            await tx.lesson.create({ data: fields });
            continue;
          }
          const stored = storedLessons.get(lesson.id);
          if (!stored || !lessonUnchanged(stored, fields)) {
            await tx.lesson.update({ where: { id: lesson.id }, data: fields });
          }
        }
      }

      await tx.module.deleteMany({
        where: { courseId, id: { notIn: [...keptModuleIds] }, lessons: { none: {} } },
      });

      await recomputeEnrolmentProgress(tx, courseId);

      return tx.course.update({
        where: { id: courseId },
        data: courseFields(input),
        include: COURSE_FOR_EDITING,
      });
    }, { timeout: SAVE_TRANSACTION_TIMEOUT_MS });

    logger.info('Course updated', { courseId, published: course.published, userId: user.userId });
    res.status(200).json({ success: true, data: toAdminCourse(course) });
  } catch (error) {
    respondToFailure(res, req, 'Update course error', error);
  }
};
