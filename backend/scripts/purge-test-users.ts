// ─────────────────────────────────────────────────
// GIREAPP — Purge test accounts
// Dry run by default. Pass --delete to actually remove.
// ─────────────────────────────────────────────────
//
//   npm run db:purge-test-users            # list what would go
//   npm run db:purge-test-users -- --delete
//
// Matches @example.com, which RFC 2606 reserves for documentation and testing —
// no real learner can hold one, so the filter cannot catch a genuine account.

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Loaded here rather than via config/env, which also asserts auth secrets this
// script has no use for. Same precedence as the server: .env.local wins.
dotenv.config({ path: ['.env.local', '.env'] });

const prisma = new PrismaClient();

const TEST_EMAIL_SUFFIX = '@example.com';

async function main(): Promise<void> {
  const shouldDelete = process.argv.includes('--delete');

  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log(`No accounts matching *${TEST_EMAIL_SUFFIX}.`);
    return;
  }

  console.log(`${users.length} test account(s) matching *${TEST_EMAIL_SUFFIX}:\n`);
  for (const user of users) {
    console.log(`  ${user.createdAt.toISOString().slice(0, 10)}  ${user.email}  (${user.name})`);
  }

  if (!shouldDelete) {
    console.log('\nDry run — nothing deleted. Re-run with --delete to remove them.');
    return;
  }

  // Every owned row (enrolments, attempts, badges, progress) cascades from User.
  const { count } = await prisma.user.deleteMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
  });

  console.log(`\nDeleted ${count} account(s) and their cascaded records.`);
}

main()
  .catch((error) => {
    console.error('[purge-test-users] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
