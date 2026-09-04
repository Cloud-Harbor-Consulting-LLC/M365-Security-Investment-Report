/**
 * Copies shared binary assets from the PowerShell module into the app before a build.
 *
 * The module is the canonical home for the fonts because it has to ship them inside a
 * self-contained report. Copying at build time rather than committing a second copy
 * keeps one set of bytes under version control.
 *
 * Text assets (the SKU catalog, price list, config defaults) are NOT copied — they are
 * imported directly through the @data alias, so both tiers read the same file.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const fontSource = join(repoRoot, 'src', 'CloudHarbor.M365SecurityInvestment', 'Assets', 'Fonts');
const fontTarget = join(here, '..', 'src', 'assets', 'fonts');

const FONTS = ['Lato-Regular.ttf', 'Lato-Bold.ttf', 'OFL.txt'];

await mkdir(fontTarget, { recursive: true });

let copied = 0;
for (const name of FONTS) {
  const from = join(fontSource, name);
  if (!existsSync(from)) {
    console.error(`sync-assets: missing ${from}`);
    process.exitCode = 1;
    continue;
  }
  await copyFile(from, join(fontTarget, name));
  copied += 1;
}

console.log(`sync-assets: ${copied} file(s) -> src/assets/fonts`);
