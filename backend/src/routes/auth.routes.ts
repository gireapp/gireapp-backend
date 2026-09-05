import { Router } from 'express';
import {
  register,
  login,
  logout,
  me,
  forgotPassword,
  resetPassword,
  verifyEmail,
  confirmGuardianConsent,
  resendVerification,
  onboarding,
  changePassword,
} from '../controllers/auth.controller';
import { authLimiter } from '../middlewares/rateLimit.middleware';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// /api/auth/register
router.post('/register', authLimiter, register);

// /api/auth/login
router.post('/login', authLimiter, login);

// /api/auth/logout
router.post('/logout', logout);

// /api/auth/me
router.get('/me', requireAuth, me);

// /api/auth/forgot-password
router.post('/forgot-password', authLimiter, forgotPassword);

// /api/auth/reset-password
router.post('/reset-password', authLimiter, resetPassword);

// /api/auth/verify-email
router.post('/verify-email', authLimiter, verifyEmail);

// /api/auth/guardian-consent — one-click confirmation from the guardian's email
router.post('/guardian-consent', authLimiter, confirmGuardianConsent);

// /api/auth/resend-verification
router.post('/resend-verification', authLimiter, resendVerification);

// /api/auth/onboarding
router.post('/onboarding', requireAuth, onboarding);

// /api/auth/change-password — authenticated; authLimiter also caps password guessing here
router.post('/change-password', authLimiter, requireAuth, changePassword);

export default router;
