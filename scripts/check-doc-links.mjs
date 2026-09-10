/**
 * Checks that every relative link and in-page anchor in the Markdown actually resolves.
 *
 * Only local targets. External URLs are deliberately not fetched: a network check makes CI
 * fail for reasons that have nothing to do with the commit, and a flaky gate is one people
 * learn to ignore.
 *
 * This exists because the docs now cross-reference each other heavily, and a link that
 * 404s in a security or privacy document costs more trust than the paragraph it sits in
 * was worth.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const root = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.standalone-build']);

function markdownFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, found);
    else if (entry.endsWith('.md')) found.push(full);
  }
  return found;
}

/** GitHub's anchor rule: lowercase, drop anything but word characters, spaces and hyphens. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

function headingsOf(text) {
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])),
  );
}

const failures = [];

for (const file of markdownFiles(root)) {
  const text = readFileSync(file, 'utf8');
  // Strip fenced code so an example link is not treated as a real one.
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const anchors = headingsOf(text);

  for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|tel:)/i.test(target)) continue;

    const [pathPart, hash] = target.split('#');

    if (!pathPart) {
      if (hash && !anchors.has(hash.toLowerCase())) {
        failures.push(`${relative(root, file)} -> #${hash} (no such heading)`);
      }
      continue;
    }

    const resolved = resolve(dirname(file), pathPart);

    // A target that escapes the repository is a GitHub web path, not a file: links like
    // ../../commits/main/... or ../../issues resolve against the repo URL in GitHub's
    // renderer and have no on-disk equivalent to check.
    if (relative(root, resolved).startsWith('..')) continue;

    let exists = true;
    try {
      statSync(resolved);
    } catch {
      exists = false;
    }
    if (!exists) {
      failures.push(`${relative(root, file)} -> ${target} (missing)`);
      continue;
    }

    if (hash && resolved.endsWith('.md')) {
      const targetAnchors = headingsOf(readFileSync(resolved, 'utf8'));
      if (!targetAnchors.has(hash.toLowerCase())) {
        failures.push(`${relative(root, file)} -> ${target} (no such heading)`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local links: ${failures.length}\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('Doc links: every local target resolves');
