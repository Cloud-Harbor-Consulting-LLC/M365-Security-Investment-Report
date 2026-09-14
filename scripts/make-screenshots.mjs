/**
 * Regenerates the README screenshots from the sample tenant.
 *
 * Committed because screenshots go stale silently. The sample report in samples/ sat
 * showing a figure that had moved, and nobody noticed until a price changed. A screenshot
 * is worse: it is an image, so no grep will ever find the stale number in it. Being able
 * to run one command after a UI change is the only thing that keeps them honest.
 *
 * Uses Microsoft Edge in headless mode, which ships on every Windows machine, so this adds
 * no dependency to a project that counts its dependencies.
 *
 * The app has no URL state for the selected view, so each shot is taken from a copy of the
 * one-file report with a small script appended that clicks the view and then signals it is
 * ready. That script exists only in a temporary file and never in anything shipped.
 *
 * Every figure visible in these images comes from tests/fixtures/premium-snapshot.json,
 * which is synthetic. No real tenant appears in the repository, images included.
 *
 *   node scripts/make-screenshots.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'docs', 'images');
const tmpDir = join(root, 'app', '.screenshots');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error('Microsoft Edge was not found. Looked in:\n  ' + EDGE_CANDIDATES.join('\n  '));
  process.exit(1);
}

const template = join(root, 'app', 'src', 'standalone', 'template.html');
if (!existsSync(template)) {
  console.error('No standalone template. Run "npm --prefix app run build:standalone" first.');
  process.exit(1);
}

/**
 * The shots, and what each one has to show.
 *
 * Deliberately few. A README with 12 screenshots is one nobody looks at, and each of these
 * answers a question a reader actually has before they will try the tool.
 */
const SHOTS = [
  { file: 'board.png', view: 'Board', height: 760, what: 'the headline figures a CFO sees first' },
  { file: 'features.png', view: 'Security features', height: 1180, what: 'entitled versus deployed, the differentiator' },
  { file: 'waste.png', view: 'Wasted spend', height: 860, what: 'the 5 waste categories and what could not be measured' },
  { file: 'roadmap.png', view: 'Roadmap', height: 980, what: 'what to fix first, ranked by value against effort' },
];

/** Clicks a view, then marks the document so the capture knows the render finished. */
const injection = (view) => `
<script>
(function () {
  var tries = 0;
  function go() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button.nav'));
    var target = buttons.filter(function (b) { return b.textContent.trim() === ${JSON.stringify(view)}; })[0];
    if (!target) {
      if (++tries < 200) return setTimeout(go, 25);
      document.title = 'SCREENSHOT-FAILED';
      return;
    }
    target.click();
    setTimeout(function () { document.documentElement.setAttribute('data-shot-ready', '1'); }, 120);
  }
  go();
})();
</script>
`;

function buildReport() {
  // The same code path the Export button uses, so the screenshots show what a customer
  // would actually receive rather than a dev-server rendering of it.
  const script = `
import { readFileSync, writeFileSync } from 'node:fs';
import premium from '@fixtures/premium-snapshot.json';
import template from '@/standalone/template.html?raw';
import { analyze } from '@/engine';
import { buildSession } from '@/engine/session';
import { buildStandalone } from '@/engine/standalone';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';
import { it } from 'vitest';
it('emit', () => {
  const p = parseSnapshot(premium);
  if (!p.ok) throw new Error(p.reason);
  const m = analyze({ snapshot: p.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
  const built = buildStandalone(template, m, buildSession(p.snapshot, { prices: {} }, 'sample tenant'), 'sample tenant');
  writeFileSync(process.env.SHOT_OUT, built.html, 'utf8');
});
`;
  const probe = join(root, 'app', 'src', 'engine', 'shot-emit.test.ts');
  writeFileSync(probe, script, 'utf8');
  const out = join(tmpDir, 'report.html');
  // Vitest's own entry, run by this node, rather than "npx" through a shell. Spawning a
  // shell here needs shell: true, which Node deprecated for exactly the reason that
  // matters on this platform: the arguments stop being escaped and start being
  // concatenated, and the repository path contains spaces.
  const vitest = join(root, 'app', 'node_modules', 'vitest', 'vitest.mjs');
  try {
    execFileSync(process.execPath, [vitest, 'run', 'src/engine/shot-emit.test.ts'], {
      cwd: join(root, 'app'),
      env: { ...process.env, SHOT_OUT: out },
      stdio: 'pipe',
    });
  } finally {
    rmSync(probe, { force: true });
  }
  return readFileSync(out, 'utf8');
}

function capture(html, shot) {
  const page = join(tmpDir, shot.file.replace('.png', '.html'));
  writeFileSync(page, html.replace('</body>', injection(shot.view) + '</body>'), 'utf8');
  const target = join(outDir, shot.file);
  execFileSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--virtual-time-budget=15000',
      `--window-size=1440,${shot.height}`,
      `--screenshot=${target.replace(/\\/g, '/')}`,
      `file:///${page.replace(/\\/g, '/')}`,
    ],
    { stdio: 'pipe' },
  );
  return statSync(target).size;
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

console.log('Building the one-file report from the sample tenant...');
const html = buildReport();

for (const shot of SHOTS) {
  const bytes = capture(html, shot);
  console.log(`  ${shot.file.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(5)} kB  ${shot.what}`);
}

rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${SHOTS.length} screenshots written to docs/images/`);
