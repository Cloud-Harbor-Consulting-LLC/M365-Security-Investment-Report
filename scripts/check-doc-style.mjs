/**
 * Checks the prose against the one writing rule that can be checked mechanically.
 *
 * The house style bans the em dash. That is binary, so it is worth a gate, and it covers
 * documentation, source comments and the strings a customer reads.
 *
 * The rules that need judgment are deliberately not automated. Rejecting a frame before
 * asserting one, unnecessary analogies, inflated vocabulary: a regex flags legitimate
 * technical contrast alongside the real thing, and a check that cries wolf is one people
 * learn to switch off. Those stay a review job.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', '.standalone-build']);
const EM_DASH = '\u2014';

// Prose, wherever it lives. Comments and the strings a customer reads are held to the
// same rule as the Markdown, because a reader does not care which file it came from.
const CHECKED = /\.(md|ts|tsx|mjs|ps1|psm1|psd1)$/;

function docs(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) docs(full, found);
    else if (CHECKED.test(entry)) found.push(full);
  }
  return found;
}

const failures = [];
for (const file of docs(root)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(EM_DASH)) {
      failures.push(`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}

if (failures.length > 0) {
  console.error(`Em dashes found: ${failures.length}\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\n  House style uses periods, commas, colons, semicolons or parentheses.');
  process.exit(1);
}
console.log('Style: no em dashes in prose, comments or UI strings');
