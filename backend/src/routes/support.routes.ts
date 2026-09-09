// ─────────────────────────────────────────────────
// GIREAPP — Support Routes
// ─────────────────────────────────────────────────

import { Router } from 'express';
import { contactSupport } from '../controllers/support.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { authLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// @route   POST /api/support/contact
// @desc    Raise a support request, delivered to the support inbox by email
// @access  Private
router.post('/contact', authLimiter, requireAuth, contactSupport);

export default router;
