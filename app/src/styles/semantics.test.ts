/**
 * The accessibility decisions that live in markup and CSS rather than in behaviour.
 *
 * These are cheap assertions guarding expensive mistakes. Each one corresponds to
 * something that was actually wrong in this codebase, so none of them is hypothetical:
 * a panel that was off-screen but still in the tab order, tables with no headers a screen
 * reader could use, and a focus ring the brand colour was too pale to draw.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appCss = read('./app.css');
const tokensCss = read('./tokens.css');

const componentsDir = fileURLToPath(new URL('../components', import.meta.url));
const components = readdirSync(componentsDir)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => ({ name: f, source: readFileSync(`${componentsDir}/${f}`, 'utf8') }));

describe('a closed panel is out of the keyboard\'s way', () => {
  it('hides the overlay rather than only sliding it off-screen', () => {
    // translateX(100%) moves a panel out of sight and leaves every control inside it in
    // the tab order. A keyboard user tabbing through the report fell into invisible price
    // inputs with no way of knowing where they were.
    // Anchored to the start of a line: ".dropzone.over {" also contains ".over {" and
    // matched first, so the assertion was reading a completely different rule.
    const closed = /^\.over\s*\{[^}]*\}/m.exec(appCss)?.[0] ?? '';
    expect(closed).toMatch(/visibility:\s*hidden/);
    const open = /^\.over\.on\s*\{[^}]*\}/m.exec(appCss)?.[0] ?? '';
    expect(open).toMatch(/visibility:\s*visible/);
  });

  it('marks both overlays as modal dialogs', () => {
    for (const name of ['Exports.tsx', 'Assumptions.tsx']) {
      const c = components.find((x) => x.name === name);
      expect(c, name).toBeTruthy();
      expect(c!.source, name).toMatch(/role="dialog"/);
      expect(c!.source, name).toMatch(/aria-modal="true"/);
      // The behaviour, not just the label: escape, focus trap, focus restore.
      expect(c!.source, name).toMatch(/useDialog\(/);
    }
  });
});

describe('every table can be navigated by a screen reader', () => {
  it('gives each column header a scope', () => {
    // Without scope, a screen reader cannot associate a cell with its column, and a
    // fifteen-column capability table becomes an unlabelled list of values.
    const offenders: string[] = [];
    for (const { name, source } of components) {
      for (const m of source.matchAll(/<th(\s[^>]*)?>/g)) {
        if (!/scope=/.test(m[0])) offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives each table a caption naming it', () => {
    const offenders: string[] = [];
    for (const { name, source } of components) {
      const tables = [...source.matchAll(/<table[\s>]/g)].length;
      const captions = [...source.matchAll(/<caption>/g)].length;
      // BoardPack is print-only and aria-hidden; its tables sit directly under their own
      // page headings, so a caption would name them twice and reach no one.
      if (name === 'BoardPack.tsx') continue;
      if (tables !== captions) offenders.push(`${name}: ${tables} tables, ${captions} captions`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the report has the landmarks a screen reader navigates by', () => {
  it('marks the view area as main', () => {
    const dash = components.find((c) => c.name === 'Dashboard.tsx')!.source;
    expect(dash).toMatch(/<main[\s>]/);
    // Named by the heading that changes with the view, so the landmark says which view.
    expect(dash).toMatch(/aria-labelledby="view-heading"/);
    expect(dash).toMatch(/id="view-heading"/);
  });

  it('announces the view when it changes', () => {
    // Sighted users see the panel swap. Without this, pressing a navigation button gives
    // a screen-reader user nothing at all.
    expect(components.find((c) => c.name === 'Dashboard.tsx')!.source).toMatch(/useAnnounce\(/);
  });
});

describe('the focus ring is its own colour', () => {
  it('does not draw focus in the brand blue', () => {
    // Cumulus Blue is 2.8:1 on the page background — below the 3:1 a focus indicator
    // needs. The brand colour stays the brand colour; the ring gets a derived shade.
    expect(tokensCss).toMatch(/--focus:/);
    const focusRules = [...appCss.matchAll(/[^{}]*:focus[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(focusRules.length).toBeGreaterThan(0);
    for (const rule of focusRules) {
      if (/outline:\s*none/.test(rule)) {
        // Removing the outline is only acceptable if something else marks focus.
        expect(rule, rule).toMatch(/border-color:\s*var\(--focus\)/);
        continue;
      }
      if (/outline:/.test(rule) || /border-color:/.test(rule)) {
        expect(rule, rule).toMatch(/var\(--focus\)/);
      }
    }
  });

  it('keeps control borders on their own token', () => {
    // --line-strong is decorative: table rules, dashed dividers. The boundary that
    // identifies a control has a 3:1 requirement and therefore a separate token, and the
    // contrast test holds it there.
    expect(tokensCss).toMatch(/--control-border:/);
    for (const selector of ['.btn', '.chip', '.formrow input', '.presenter-nav button', '.x']) {
      // The stray leading backslash made this "\\.btn", a literal backslash followed by
      // any character, which matched nothing and reported every selector as missing.
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`^${escaped}\\s*\\{[^}]*\\}`, 'm');
      const rule = rx.exec(appCss)?.[0];
      expect(rule, `${selector} should exist in app.css`).toBeTruthy();
      if (/border:/.test(rule!)) {
        expect(rule!, selector).not.toMatch(/border:[^;]*var\(--line-strong\)/);
      }
    }
  });
});
