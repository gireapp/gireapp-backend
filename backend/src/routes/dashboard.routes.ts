import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// /api/dashboard
router.get('/', requireAuth, getDashboard);

export default router;
