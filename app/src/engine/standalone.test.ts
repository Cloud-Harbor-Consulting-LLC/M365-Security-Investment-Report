/**
 * The one-file report, tested against the artifact rather than against a fixture.
 *
 * These assertions run over the template the standalone build actually produced, which
 * is the only way they mean anything. The two promises this file makes, that it reaches no
 * network and shows the board figures without JavaScript, are properties of the
 * built bundle, not of the code that assembles it.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';
import template from '@/standalone/template.html?raw';

import { analyze } from './index';
import { buildSession } from './session';
import {
  SESSION_SLOT,
  STATIC_SLOT,
  TITLE_SLOT,
  buildStandalone,
  escapeHtml,
  escapeJsonForScript,
  externalOrigins,
  standaloneFileName,
  staticBoardHtml,
} from './standalone';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';
import { money } from '@/format';

const snapshotOf = (raw: unknown): Snapshot => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};

const modelOf = (raw: unknown) =>
  analyze({
    snapshot: snapshotOf(raw),
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
  });

const premium = modelOf(premiumSnapshot);
const unpriced = modelOf(unpricedSnapshot);

const exported = (raw: unknown, model = modelOf(raw)) =>
  buildStandalone(template, model, buildSession(snapshotOf(raw), { prices: {} }, 'test'), 'test').html;

describe('the built template', () => {
  it('carries exactly one of each placeholder', () => {
    // Not "at least one". A token appearing twice means it also exists inside the
    // inlined bundle, and the substitution would then rewrite the report's own
    // JavaScript with a tenant's JSON. That happened: the placeholder constants were
    // reachable from the engine barrel, so the standalone bundle compiled them in.
    for (const slot of [SESSION_SLOT, STATIC_SLOT, TITLE_SLOT]) {
      expect(template.split(slot).length - 1, slot).toBe(1);
    }
  });

  it('reaches no external origin', () => {
    // The whole claim of the deliverable. Opening it must tell nobody it was opened.
    expect(externalOrigins(template)).toEqual([]);
  });

  it('leaves nothing to fetch', () => {
    // Any surviving src=/href= means an asset did not get folded in, which on a
    // customer's disk is a broken report rather than a slow one.
    expect(template).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(template).not.toMatch(/<link[^>]+rel="stylesheet"/i);
  });

  it('carries its fonts as data, not as a path beside the file', () => {
    // Asserting that *some* data: URI exists proved nothing: the fonts were left as
    // ../assets/fonts/Lato-Regular.ttf while an unrelated data: URI kept the test green.
    // A relative path is not an external origin, so the origin scan missed it too, and
    // the delivered file would have rendered in a fallback face. So: every url() in the
    // document must be inline, and the faces must be among them.
    // Scoped to the stylesheet: a case-insensitive scan of the whole document also
    // matches URL( in the minified JavaScript, which is not a stylesheet reference.
    const css = [...template.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n');
    expect(css.length).toBeGreaterThan(0);
    const urls = [...css.matchAll(/url\(\s*["']?([^)"']+)/gi)].map((m) => m[1]!.trim());
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith('data:') && !u.startsWith('#'))).toEqual([]);
    expect(template).toMatch(/@font-face\{font-family:Lato;src:url\(data:/);
  });

  it('is a classic script, because module scripts do not run from file://', () => {
    expect(template).not.toMatch(/<script[^>]*type="module"/i);
  });

  it('forbids every origin in its own policy', () => {
    expect(template).toMatch(/default-src 'none'/);
  });
});

describe('the exported report', () => {
  it('replaces every placeholder', () => {
    const html = exported(premiumSnapshot);
    for (const slot of [SESSION_SLOT, STATIC_SLOT, TITLE_SLOT]) {
      expect(html).not.toContain(slot);
    }
  });

  it('still reaches no external origin once a tenant is in it', () => {
    expect(externalOrigins(exported(premiumSnapshot))).toEqual([]);
  });

  it('refuses to build from a template that has not been rebuilt', () => {
    expect(() =>
      buildStandalone('<html></html>', premium, buildSession(snapshotOf(premiumSnapshot), { prices: {} }, 't'), 't'),
    ).toThrow(/build:standalone/);
  });

  it('names the file after the tenant and the collection date', () => {
    expect(standaloneFileName('Contoso Ltd.', new Date('2026-09-09T10:00:00Z'))).toBe(
      'm365-security-investment-contoso-ltd-2026-09-09.html',
    );
    expect(standaloneFileName('///')).toMatch(/^m365-security-investment-tenant-/);
  });
});

describe('the board figures survive with JavaScript disabled', () => {
  it('writes the headline figures into the document as text', () => {
    const html = staticBoardHtml(premium, 'test');
    expect(html).toContain(premium.tenant.DisplayName);
    // The same formatter the dashboard uses, so the printed page and the screen agree.
    expect(premium.spend.annualCommitment, 'the premium fixture must stay priced').not.toBeNull();
    expect(html).toContain(money(premium.spend.annualCommitment, premium.spend.currency));
  });

  it('says "Not available" rather than zero when nothing could be priced', () => {
    // The rule the whole report is built on. A CFO reading the no-JS fallback must not
    // be told this tenant spends nothing.
    expect(unpriced.spend.anyPriced, 'the unpriced fixture must stay unpriced').toBe(false);
    const html = staticBoardHtml(unpriced, 'test');
    expect(html).toContain('Not available');
    expect(html).not.toMatch(/s-tile-value">\$0</);
  });

  it('is present in the document before any script runs', () => {
    const html = exported(premiumSnapshot);
    const staticAt = html.indexOf('<section class="s-board">');
    // The bundle, not the inert JSON data block.
    const scriptAt = html.lastIndexOf('<script>');
    expect(staticAt).toBeGreaterThan(-1);
    expect(staticAt).toBeLessThan(scriptAt);
  });

  it('tells the reader why they are seeing a summary rather than the report', () => {
    expect(staticBoardHtml(premium, 'test')).toMatch(/scripting disabled/i);
  });
});

describe('a tenant string cannot break out of the document', () => {
  it('closes no element from a display name', () => {
    const nasty = '</script><script>fetch("http://evil.example")</script>';
    const hostile = structuredClone(snapshotOf(premiumSnapshot));
    hostile.Collectors.organization!.Data!.DisplayName = nasty;

    const model = analyze({
      snapshot: hostile,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      riskModel,
    });
    const html = buildStandalone(template, model, buildSession(hostile, { prices: {} }, 't'), 't').html;

    // Not one live script tag beyond the bundle's own, and no origin reachable.
    expect(html).not.toContain('<script>fetch');
    expect(externalOrigins(html)).toEqual([]);
    // The name is still readable, escaped rather than discarded.
    expect(html).toContain('&lt;/script&gt;');
  });

  it('escapes the sequence that ends a script element', () => {
    const out = escapeJsonForScript({ name: '</script><img src=x>' });
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain('<');
    // And still parses back to exactly what went in.
    expect(JSON.parse(out)).toEqual({ name: '</script><img src=x>' });
  });

  it('escapes the line terminators that are legal in JSON but not in JavaScript', () => {
    const sep = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    const out = escapeJsonForScript({ a: sep });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toEqual({ a: sep });
  });

  it('escapes markup in text', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('the origin scanner', () => {
  // It is the guard for everything above, so it is tested rather than trusted.
  it('finds what it is meant to find', () => {
    expect(externalOrigins('<img src="https://evil.example/x.png">')).toHaveLength(1);
    expect(externalOrigins('<script src="//cdn.example/x.js"></script>')).toHaveLength(1);
    expect(externalOrigins('a { background: url(https://fonts.example/f.woff) }')).toHaveLength(1);
    expect(externalOrigins('@import "https://x.example/a.css";')).toHaveLength(1);
    expect(externalOrigins('//# sourceMappingURL=https://x.example/a.map')).toHaveLength(1);
  });

  it('does not flag what belongs in the file', () => {
    expect(externalOrigins('<img src="data:image/png;base64,AAAA">')).toEqual([]);
    expect(externalOrigins('a { src: url(data:font/ttf;base64,AAAA) }')).toEqual([]);
    expect(externalOrigins('<a href="#board">Board</a>')).toEqual([]);
  });
});
