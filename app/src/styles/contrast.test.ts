/**
 * Contrast, checked in CI against the real token file.
 *
 * The palette is the identity, so this is not a check that can be satisfied by tweaking a
 * colour in one component. It holds the tokens themselves to WCAG AA, in both themes, and
 * fails with the name of what a reader would actually be looking at.
 *
 * The file is read from disk rather than imported: Vite's CSS pipeline intercepts a `.css`
 * import and `?raw` came back empty, which would have made every assertion here pass
 * against nothing at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { auditContrast, contrast, luminance, parseHex, readTokens, resolve } from './contrast';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

describe('the arithmetic', () => {
  it('agrees with the WCAG reference values', () => {
    const white = parseHex('#ffffff')!;
    const black = parseHex('#000000')!;
    expect(contrast(white, black)).toBeCloseTo(21, 5);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.5:1 boundary.
    expect(contrast(parseHex('#767676')!, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseHex('#777777')!, white)).toBeLessThan(4.54);
    expect(luminance(black)).toBe(0);
    expect(luminance(white)).toBeCloseTo(1, 5);
  });

  it('reads shorthand hex', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('not a colour')).toBeNull();
  });
});

describe('the token file is actually being read', () => {
  // Guards the failure mode that made the first version of this file worthless: an empty
  // stylesheet produces no pairings to check and a green run that proves nothing.
  it('finds a full palette in both themes', () => {
    expect(css.length).toBeGreaterThan(500);
    const themes = readTokens(css);
    expect(Object.keys(themes.light).length).toBeGreaterThan(15);
    expect(Object.keys(themes.dark).length).toBeGreaterThan(15);
    expect(resolve(themes.light, '--ink')).not.toBeNull();
    // Dark must genuinely differ, or it is light being tested twice.
    expect(themes.dark['--ground']).not.toBe(themes.light['--ground']);
  });

  it('follows a token that points at another token', () => {
    const themes = readTokens(css);
    // --accent is defined as var(--cumulus); an unresolved indirection would read as null
    // and quietly drop the focus-ring pairings.
    expect(resolve(themes.light, '--accent')).toEqual(resolve(themes.light, '--cumulus'));
  });
});

describe('every pairing on screen meets WCAG AA', () => {
  const results = auditContrast(css);

  it('checks something in both themes', () => {
    expect(results.filter((r) => r.theme === 'light').length).toBeGreaterThan(10);
    expect(results.filter((r) => r.theme === 'dark').length).toBeGreaterThan(10);
  });

  for (const r of auditContrast(css)) {
    it(`${r.theme}: ${r.what}`, () => {
      expect(
        r.ratio,
        `${r.foreground} on ${r.background} is ${r.ratio.toFixed(2)}:1, below the ${r.minimum}:1 needed`,
      ).toBeGreaterThanOrEqual(r.minimum);
    });
  }
});
