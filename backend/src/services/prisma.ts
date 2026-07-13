// ─────────────────────────────────────────────────
// GIREAPP — Prisma Client Singleton
// Prevents multiple instances in development
// ─────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 'query' is intentionally excluded — it logs raw SQL with bound
    // parameter values (emails, tokens, etc.) in plaintext.
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
