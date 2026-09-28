import { Router } from 'express';
import {
  createCourse,
  getUploadUrl,
  attachLessonMedia,
  listStudents,
  listCourseOptions,
} from '../controllers/admin.controller';
import { getAdminOverview } from '../controllers/admin-overview.controller';
import { getAdminAnalytics } from '../controllers/admin-analytics.controller';
import { requireAuth, requireStaff } from '../middlewares/auth.middleware';

const router = Router();

// Every /api/admin/* route is JWT-guarded and staff-only (BE-ADMIN-001).
router.use(requireAuth, requireStaff);

// /api/admin/overview
router.get('/overview', getAdminOverview);

// /api/admin/analytics?rangeDays=&academicLevel=&courseId=&groupBy=
router.get('/analytics', getAdminAnalytics);

// /api/admin/courses
router.post('/courses', createCourse);
router.get('/courses', listCourseOptions);

// /api/admin/students?search=&courseId=&academicLevel=&status=&page=&limit=
router.get('/students', listStudents);

// /api/admin/upload-url?filename=notes.pdf
router.get('/upload-url', getUploadUrl);

// /api/admin/lessons/:lessonId/media
router.post('/lessons/:lessonId/media', attachLessonMedia);

export default router;
