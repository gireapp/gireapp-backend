import { Router } from 'express';
import {
  getLesson,
  getCourse,
  completeLesson,
  enrolInCourse,
  listCourses,
} from '../controllers/course.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// /api/courses?level=&department=
router.get('/', requireAuth, listCourses);

// /api/courses/:courseId
router.get('/:courseId', requireAuth, getCourse);

// /api/courses/:courseId/enrol
router.post('/:courseId/enrol', requireAuth, enrolInCourse);

// /api/courses/:courseId/lessons/:lessonId
router.get('/:courseId/lessons/:lessonId', requireAuth, getLesson);

// /api/courses/:courseId/lessons/:lessonId/complete
router.post('/:courseId/lessons/:lessonId/complete', requireAuth, completeLesson);

export default router;
