/**
 * Attribution, checked rather than remembered.
 *
 * Preact and MSAL are MIT, and MIT requires the copyright notice to travel with the
 * software. Adding a third runtime dependency without a notice would put this project in
 * breach of a licence quietly, in a commit that looked like a feature.
 *
 * Only runtime dependencies are checked. Build and test packages do not reach a user, so
 * no notice is owed for them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const pkg = JSON.parse(read('../package.json')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const noticesRaw = read('../../THIRD-PARTY-NOTICES.md');
// Collapsed to one line before matching. A phrase that wraps across a line break is
// still present, and an attribution check that depends on where the text wrapped would
// fail on a reflow and teach everyone to ignore it.
const notices = noticesRaw.replace(/\s+/g, ' ');

describe('every dependency that ships is attributed', () => {
  it('names each runtime dependency', () => {
    const runtime = Object.keys(pkg.dependencies ?? {});
    expect(runtime.length, 'there should be runtime dependencies to check').toBeGreaterThan(0);
    for (const name of runtime) {
      expect(notices, `${name} ships to users and is not in THIRD-PARTY-NOTICES.md`).toContain(name);
    }
  });

  it('keeps the runtime list short enough to audit', () => {
    // Not a style preference. Each package here is code running in a browser that has just
    // read a customer's directory, and the count is the first thing a security reviewer
    // counts. Raising this deliberately is fine; raising it by accident is not.
    expect(Object.keys(pkg.dependencies ?? {}).length).toBeLessThanOrEqual(3);
  });

  it('attributes the font that is embedded in every report', () => {
    expect(notices).toMatch(/SIL Open Font License/i);
    expect(notices).toMatch(/Lato/);
  });

  it('says where the catalogue data came from and under what terms', () => {
    // 568 of 619 entries are Microsoft's. The redistribution basis is the MIT-licensed
    // documentation repository, not the CSV, which states no terms.
    expect(notices).toMatch(/entra-docs/);
    expect(notices).toMatch(/MIT/);
  });

  it('carries a trademark statement and a disclaimer of affiliation', () => {
    expect(notices).toMatch(/trademarks of the Microsoft group of companies/i);
    expect(notices).toMatch(/not affiliated with, endorsed by, or sponsored by Microsoft/i);
  });
});
