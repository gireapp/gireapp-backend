#!/usr/bin/env node
/**
 * Scans tracked files for the shape of the August 2026 supply-chain attack,
 * where forged commits carrying obfuscated JS were force-pushed over every
 * branch and sat unnoticed for three weeks.
 *
 * This does not prevent a push — a compromised account can force-push whatever
 * it likes. It shortens discovery from weeks to minutes by failing CI loudly.
 *
 * Detects the delivery mechanics rather than any single payload's signature,
 * so a re-obfuscated variant still trips it:
 *   1. a build-time config file carrying an enormous single line (the payload
 *      was hidden past ~2,000 tab characters, invisible in a diff view)
 *   2. an editor task that auto-runs on folder open
 *   3. a font/asset file that is actually JavaScript
 *
 * Usage: node scripts/scan-injected-code.mjs [rootDir]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const root = process.argv[2] ?? process.cwd();

/** A config file is executed by the build; a long line there is never legitimate. */
const EXECUTED_CONFIG = /\.(config|conf)\.(js|cjs|mjs|ts)$|^(postcss|tailwind|next|vite|webpack|rollup|babel|jest|vitest|eslint)\./;
const MAX_CONFIG_LINE = 500;

/** Real fonts/images start with these; JavaScript does not. */
const MAGIC = {
  '.woff2': [0x77, 0x4f, 0x46, 0x32], // wOF2
  '.woff': [0x77, 0x4f, 0x46, 0x46], // wOFF
  '.ttf': [0x00, 0x01, 0x00, 0x00],
  '.eot': null, // no reliable magic; checked for JS tokens instead
};

const JS_TOKENS = /require\s*\(|child_process|global\[|=>|function\s*\(/;

const findings = [];
const report = (file, rule, detail) => findings.push({ file, rule, detail });

const trackedFiles = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
  maxBuffer: 64 * 1024 * 1024,
})
  .toString()
  .split('\0')
  .filter(Boolean);

for (const relative of trackedFiles) {
  const absolute = join(root, relative);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    continue; // listed but absent (submodule, broken link)
  }
  if (!stats.isFile()) continue;

  const name = basename(relative);
  const extension = extname(relative).toLowerCase();

  // 1. Oversized line in a file the build executes.
  if (EXECUTED_CONFIG.test(name)) {
    const lines = readFileSync(absolute, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.length > MAX_CONFIG_LINE) {
        report(
          relative,
          'oversized-config-line',
          `line ${index + 1} is ${line.length} chars (limit ${MAX_CONFIG_LINE}) — payloads hide past long whitespace runs`,
        );
      }
    });
  }

  // 2. Editor task that runs itself when the folder is opened.
  if (name === 'tasks.json' || name === 'settings.json') {
    const contents = readFileSync(absolute, 'utf8');
    if (/["']runOn["']\s*:\s*["']folderOpen["']/.test(contents)) {
      report(
        relative,
        'auto-run-editor-task',
        'runs on folderOpen — executes as soon as anyone opens the repo',
      );
    }
    if (/["']task\.allowAutomaticTasks["']\s*:\s*["']?on["']?/.test(contents)) {
      report(relative, 'auto-run-editor-task', 'enables automatic tasks repo-wide');
    }
  }

  // 3. An asset that is not the format its extension claims.
  if (extension in MAGIC) {
    const header = readFileSync(absolute).subarray(0, 512);
    const expected = MAGIC[extension];
    const mismatched =
      expected && !expected.every((byte, index) => header[index] === byte);
    const looksLikeCode = JS_TOKENS.test(header.toString('latin1'));

    if (mismatched || looksLikeCode) {
      report(
        relative,
        'asset-is-not-an-asset',
        `${extension} file does not look like a font${looksLikeCode ? ' and contains JavaScript' : ''}`,
      );
    }
  }
}

if (findings.length === 0) {
  console.log(`✓ scanned ${trackedFiles.length} tracked files — nothing suspicious`);
  process.exit(0);
}

console.error(`\n✗ ${findings.length} suspicious file(s):\n`);
for (const { file, rule, detail } of findings) {
  console.error(`  ${file}\n    [${rule}] ${detail}\n`);
}
console.error(
  'If this is a genuine change, adjust scripts/scan-injected-code.mjs deliberately.\n' +
    'Otherwise treat it as a compromise: do not build or open this checkout.\n',
);
process.exit(1);
