// ─────────────────────────────────────────────────
// GIREAPP — Transactional email smoke test
// Sends the real templates through Resend, no database and no signup flow.
// ─────────────────────────────────────────────────
//
//   npm run email:test -- you@example.com
//   npm run email:test -- you@example.com --only=verification
//
// Tokens are fake, so the links in the delivered mail will not verify anything.
// This checks the part that was failing: whether Resend accepts and delivers.

import dotenv from 'dotenv';

// Loaded before the email service, which reads RESEND_API_KEY at call time.
// Same precedence as the server: .env.local wins over .env.
dotenv.config({ path: ['.env.local', '.env'] });

import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendGuardianConsentEmail,
} from '../src/services/email';

const FAKE_TOKEN = 'smoke-test-token-not-valid-for-verification';
const RECIPIENT_NAME = 'Test Learner';

type Template = 'verification' | 'reset' | 'guardian';

const TEMPLATES: Record<Template, (to: string) => Promise<void>> = {
  verification: (to) => sendVerificationEmail(to, RECIPIENT_NAME, FAKE_TOKEN),
  reset: (to) => sendPasswordResetEmail(to, RECIPIENT_NAME, FAKE_TOKEN),
  guardian: (to) => sendGuardianConsentEmail(to, RECIPIENT_NAME, FAKE_TOKEN),
};

/** Show enough of the key to tell two keys apart, never enough to use one. */
function maskKey(key: string | undefined): string {
  if (!key) return 'NOT SET';
  if (key.length < 12) return `${key} (too short to be real)`;
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`;
}

function parseRequestedTemplates(): Template[] {
  const flag = process.argv.find((arg) => arg.startsWith('--only='));
  if (!flag) return Object.keys(TEMPLATES) as Template[];

  const requested = flag.slice('--only='.length) as Template;
  if (!(requested in TEMPLATES)) {
    throw new Error(
      `Unknown template "${requested}". Expected one of: ${Object.keys(TEMPLATES).join(', ')}`
    );
  }
  return [requested];
}

async function main(): Promise<void> {
  const recipient = process.argv[2];

  if (!recipient || recipient.startsWith('--')) {
    console.error('Usage: npm run email:test -- <recipient@example.com> [--only=verification]');
    process.exitCode = 1;
    return;
  }

  const appUrl =
    process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  console.log('\nResolved email configuration');
  console.log(`  RESEND_API_KEY  ${maskKey(process.env.RESEND_API_KEY)}`);
  console.log(`  EMAIL_FROM      ${process.env.EMAIL_FROM ?? '(default) GIREAPP <noreply@gireapp.com>'}`);
  console.log(`  Link base URL   ${appUrl}`);
  console.log(`  Recipient       ${recipient}\n`);

  const templates = parseRequestedTemplates();
  const failures: string[] = [];

  for (const template of templates) {
    process.stdout.write(`  ${template.padEnd(13)} `);
    try {
      await TEMPLATES[template](recipient);
      console.log('sent');
    } catch (error) {
      console.log('FAILED');
      console.log(`                ${(error as Error).message}`);
      failures.push(template);
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length}/${templates.length} failed: ${failures.join(', ')}`);
    console.log('\nMost common causes:');
    console.log('  invalid_api_Key       the key is wrong, revoked, or still the placeholder');
    console.log('  invalid_from_address  EMAIL_FROM uses a domain not verified in Resend');
    console.log('  validation_error      on a test key, Resend only delivers to your own address');
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${templates.length} sent. Check the inbox (and spam) for ${recipient}.`);
  console.log('Delivery status per message: https://resend.com/emails');
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
});
