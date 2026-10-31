// @vitest-environment jsdom
/**
 * The layout and keyboard fixes from the interaction pass.
 *
 * Each guards a defect that was measured on screen: tables 22px and 51px wider than their
 * column at about 950px, 4 headline tiles wrapping 3 and 1, a file picker the keyboard
 * could not reach, and boxes that scroll with no way in for a keyboard.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import { markScrollableRegions } from './a11y';
import { Landing } from './components/Landing';

// Not import.meta.url: under jsdom it is not a file URL. Vitest runs from the app folder.
const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\s*\\{[^}]*\\}`, 'm').exec(css)?.[0] ?? '';
};

describe('tables fit their column', () => {
  it('sets no minimum width on a table', () => {
    // The 620px floor was wider than the report column beside the sidebar.
    expect(rule('table')).toBeTruthy();
    expect(rule('table')).not.toMatch(/min-width/);
  });

  it('folds the sidebar into tabs before the column gets that narrow', () => {
    expect(css).toMatch(/@media \(max-width: 1040px\) \{\s*\.shell \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});

describe('4 headline tiles never leave an orphan', () => {
  it('lays them 4 across, or 2 by 2 in a narrow report column', () => {
    expect(css).toContain('.tiles:has(> :nth-child(4):last-child) { grid-template-columns: repeat(4, minmax(0, 1fr)); }');
    expect(css).toMatch(
      /@container canvas \(max-width: 820px\) \{\s*\.tiles:has\(> :nth-child\(4\):last-child\) \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/,
    );
  });
});

describe('the file picker on the landing page', () => {
  it('is a button, so the keyboard reaches it', () => {
    const html = render(<Landing onSnapshot={() => null} onFiles={() => null} onConnect={() => null} error={null} />);
    expect(html).toMatch(/<button type="button" class="linkbtn pick">\s*choose files\s*<\/button>/);
    expect(html).not.toMatch(/<label[^>]*>\s*choose files/);
  });
});

describe('a box that scrolls can be reached and is named', () => {
  const box = (scroll: { w: number; cw: number; h?: number; ch?: number }, caption = 'Licence inventory') => {
    document.body.innerHTML = `<div class="tw"><table><caption>${caption}</caption></table></div>`;
    const el = document.querySelector<HTMLElement>('.tw')!;
    Object.defineProperties(el, {
      scrollWidth: { configurable: true, get: () => scroll.w },
      clientWidth: { configurable: true, get: () => scroll.cw },
      scrollHeight: { configurable: true, get: () => scroll.h ?? 100 },
      clientHeight: { configurable: true, get: () => scroll.ch ?? 100 },
    });
    return el;
  };

  it('makes an overflowing box a focusable region named after its table', () => {
    const el = box({ w: 900, cw: 700 });
    markScrollableRegions(document);
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Licence inventory');
  });

  it('counts a box that scrolls down, too', () => {
    const el = box({ w: 700, cw: 700, h: 1800, ch: 480 });
    markScrollableRegions(document);
    expect(el.tabIndex).toBe(0);
  });

  it('adds no tab stop for a table that fits, and removes one when it stops scrolling', () => {
    const el = box({ w: 700, cw: 700 });
    markScrollableRegions(document);
    expect(el.hasAttribute('tabindex')).toBe(false);

    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 900 });
    markScrollableRegions(document);
    expect(el.tabIndex).toBe(0);
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 700 });
    markScrollableRegions(document);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });
});
