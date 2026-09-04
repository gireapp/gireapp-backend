#!/usr/bin/env node
/**
 * Fails the build on high/critical advisories, except ones explicitly accepted
 * in audit-exceptions.json.
 *
 * `npm audit --audit-level=high` alone cannot express "this one is a build-time
 * CLI with no request path", so the only ways to stay green are to lower the
 * bar for everything or to stop running it — both of which trade a real gate
 * for a quiet one. This keeps the gate strict and forces each exception to
 * carry a reason and an expiry date.
 *
 * An expired exception fails the build deliberately: an exception nobody
 * revisits is just a hole you stopped looking at.
 *
 * npm audit in a workspace always audits the whole hoisted tree — `--omit=dev`
 * and `--workspace` do not narrow it (npm 11.6) — which is why a devDependency
 * advisory reaches this script at all.
 *
 * Usage: node scripts/audit-gate.mjs [--dir <repoRoot>]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const here = dirname(fileURLToPath(import.meta.url));
const dirFlag = process.argv.indexOf('--dir');
const repoRoot = dirFlag === -1 ? join(here, '..', '..') : process.argv[dirFlag + 1];

const { exceptions } = JSON.parse(
  readFileSync(join(here, 'audit-exceptions.json'), 'utf8'),
);

// `npm audit` exits non-zero when it finds anything, so the throw carries the report.
const runAudit = () => {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch (error) {
    if (error.stdout?.length) return error.stdout.toString();
    throw error;
  }
};

const report = JSON.parse(runAudit());
const today = new Date().toISOString().slice(0, 10);

const expired = exceptions.filter((e) => e.expires < today);
const excused = new Map(exceptions.filter((e) => e.expires >= today).map((e) => [e.package, e]));

const blocking = [];
const waived = [];

for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING.has(vulnerability.severity)) continue;
  const exception = excused.get(name);
  if (exception) waived.push({ name, vulnerability, exception });
  else blocking.push({ name, vulnerability });
}

for (const { name, exception } of waived) {
  console.log(`· waived  ${name} — accepted until ${exception.expires}`);
}

const unused = [...excused.values()].filter(
  (e) => !waived.some((w) => w.name === e.package),
);
for (const exception of unused) {
  console.log(`· stale   ${exception.package} — no longer flagged; delete this exception`);
}

if (expired.length > 0) {
  console.error('\n✗ expired audit exception(s) — re-assess, then extend or remove:\n');
  for (const exception of expired) {
    console.error(`  ${exception.package} — expired ${exception.expires}\n    ${exception.reason}\n`);
  }
}

if (blocking.length > 0) {
  console.error(`\n✗ ${blocking.length} unaccepted high/critical advisory(ies):\n`);
  for (const { name, vulnerability } of blocking) {
    const titles = (vulnerability.via ?? [])
      .map((via) => (typeof via === 'object' ? via.title : via))
      .filter(Boolean);
    console.error(`  [${vulnerability.severity}] ${name}`);
    for (const title of titles.slice(0, 3)) console.error(`      - ${title}`);
  }
  console.error(
    '\nFix them, or add a dated exception with a reason to scripts/audit-exceptions.json.\n',
  );
}

if (blocking.length > 0 || expired.length > 0) process.exit(1);

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `\n✓ no unaccepted high/critical advisories ` +
    `(${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low remain, not blocking)`,
);
