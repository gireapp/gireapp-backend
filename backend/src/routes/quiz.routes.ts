import { Router } from 'express';
import { getQuizIntro, startQuiz, submitQuiz } from '../controllers/quiz.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// /api/quizzes/:quizId — intro only; questions arrive with the start ticket
router.get('/:quizId', requireAuth, getQuizIntro);

// /api/quizzes/:quizId/start — starts the clock, returns questions without answers
router.post('/:quizId/start', requireAuth, startQuiz);

// /api/quizzes/:quizId/submit — grades on the server, pays out points and badges
router.post('/:quizId/submit', requireAuth, submitQuiz);

export default router;
