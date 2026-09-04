import { Router } from 'express';
import { getLesson } from '../controllers/course.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// /api/courses/:courseId/lessons/:lessonId
router.get('/:courseId/lessons/:lessonId', requireAuth, getLesson);

export default router;
