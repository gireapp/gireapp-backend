// ─────────────────────────────────────────────────
// GIREAPP — Support
// Contact form from inside the account
// ─────────────────────────────────────────────────

import { Request, Response } from 'express';
import { contactFormSchema } from '@gireapp/shared';
import { prisma } from '../services/prisma';
import { sanitizeObject, detectThreatsInBody } from '../utils/sanitize';
import { sendSupportRequestEmail } from '../services/email';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

/**
 * Raise a support request. The learner's name and address come from their own
 * row rather than the request body, so a request can never be made to look as
 * though it came from somebody else.
 */
export const contactSupport = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = (req as AuthenticatedRequest).user;

    const threats = detectThreatsInBody(req.body);
    if (threats.length > 0) {
      logger.security('Contact-support blocked — threat detected', {
        threats,
        ip: req.ip,
      });
      res.status(400).json({ error: 'Request blocked due to suspicious input.' });
      return;
    }

    const result = contactFormSchema.safeParse(sanitizeObject(req.body));
    if (!result.success) {
      res.status(422).json({
        error: 'Validation failed.',
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    const { subject, message, urgency } = result.data;

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, deletedAt: null },
      select: { name: true, email: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account not found.' });
      return;
    }

    // Awaited, unlike the fire-and-forget notices elsewhere: nothing is stored
    // here, so if the mail does not leave, the request simply did not happen
    // and the learner has to be told rather than thanked.
    await sendSupportRequestEmail(user.name, user.email, subject, message, urgency);

    logger.info('Support request sent', { userId: payload.userId, urgency });

    res.status(200).json({
      success: true,
      data: { message: 'Message sent successfully! Our team will reply by email.' },
    });
  } catch (error) {
    logger.error('Contact-support error', {
      errorMessage: (error as Error).message,
      ip: req.ip,
    });
    res.status(500).json({ error: 'Could not send your message. Please try again.' });
  }
};
