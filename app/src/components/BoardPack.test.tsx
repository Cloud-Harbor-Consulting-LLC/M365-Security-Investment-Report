/**
 * The board pack, tested for the things that lose a CFO's trust.
 *
 * This is the only artifact that is read without the tool around it, by people who
 * cannot ask a follow-up question. So the assertions here are not about layout — they
 * are about the claims the page makes: that an unknown figure is never printed as zero,
 * that a total which is a floor says so, and that the qualifications which live in
 * popovers on screen survive as words on the page.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { BoardPack } from './BoardPack';
import { analyze } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const modelOf = (raw: unknown) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({
    snapshot: parsed.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
  });
};

const premium = modelOf(premiumSnapshot);
const unpriced = modelOf(unpricedSnapshot);

const html = (m: ReturnType<typeof modelOf>) => render(<BoardPack model={m} sourceLabel="test" />);
/** Markup stripped, so an assertion cannot be satisfied by a class name or an attribute. */
const text = (m: ReturnType<typeof modelOf>) =>
  html(m)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, '’')
    .replace(/\s+/g, ' ');

describe('the pack a board actually receives', () => {
  it('is six pages', () => {
    expect(html(premium).match(/class="pack-page/g)).toHaveLength(6);
  });

  it('leads with the tenant and when it was collected', () => {
    const t = text(premium);
    expect(t).toContain(premium.tenant.DisplayName);
    expect(t).toMatch(/Collected/);
  });

  it('answers the six questions in the order they get asked', () => {
    const t = text(premium);
    for (const heading of [
      'The position',
      'Wasted spend',
      'Paid for, not switched on',
      'What to do first',
      'How these numbers were made',
    ]) {
      expect(t, heading).toContain(heading);
    }
  });
});

describe('an unknown figure is never printed as zero', () => {
  it('says "Not available" on a tenant nothing could be priced for', () => {
    expect(unpriced.spend.anyPriced, 'the unpriced fixture must stay unpriced').toBe(false);
    const t = text(unpriced);
    expect(t).toContain('Not available');
    // The specific failure this guards: a board reading that this tenant spends nothing.
    expect(t).not.toMatch(/\$0\b/);
  });

  it('says so, in words, when nothing could be priced', () => {
    expect(text(unpriced)).toMatch(/reads not available rather than zero/i);
  });

  it('never prints a bare $0 for the priced tenant either', () => {
    expect(text(premium)).not.toMatch(/\$0\b/);
  });
});

describe('a qualified figure stays qualified on paper', () => {
  it('warns that the per-control cost column does not sum', () => {
    // The single most dangerous number in this tool: several controls can depend on one
    // licence, so adding them invents money. On screen that lives in a note; here it has
    // to be on the page.
    expect(premium.features.available, 'the fixture must produce a feature analysis').toBe(true);
    const t = text(premium);
    expect(t).toMatch(/do not sum/i);
    expect(t).toMatch(/additive view/i);
  });

  it('says the roadmap figures must not be added together', () => {
    expect(premium.roadmap.length, 'the fixture must produce a roadmap').toBeGreaterThan(0);
    expect(text(premium)).toMatch(/must not be added together/i);
  });

  it('names the pricing as list rather than contract', () => {
    // Nothing was overridden in the fixture, so the pack must say the figures are list
    // prices and overstate cost — not present them as the tenant's actual spend.
    expect(premium.spend.pricingProvenance).toBe('list');
    const t = text(premium);
    expect(t).toMatch(/does not expose contract pricing/i);
    expect(t).toMatch(/public list prices/i);
    expect(t).toMatch(/overstate cost/i);
  });

  it('calls the risk figures assumptions rather than forecasts', () => {
    expect(premium.risk.available, 'the fixture must produce risk figures').toBe(true);
    const t = text(premium);
    expect(t).toMatch(/assumed annual likelihood/i);
    expect(t).toMatch(/not as a forecast/i);
  });

  it('says how much of the tenant the risk figures rest on', () => {
    // A production tenant had threat tags on only 43 of 209 scored controls, so expected
    // loss there describes a fifth of the tenant. This fixture happens to tag everything,
    // which would leave the assertion passing without ever rendering the branch -- so the
    // count is set directly and the branch is exercised.
    expect(premium.risk.controlsWithoutThreatTag).toBe(0);
    expect(text(premium)).not.toMatch(/no threat tag/i);

    const partial = structuredClone(premium);
    partial.risk.controlsWithoutThreatTag = 166;
    const t = text(partial);
    expect(t).toMatch(/no threat tag/i);
    expect(t).toContain('166');
    expect(t).toMatch(/rests on part of the tenant/i);
  });

  it('marks a floor as a floor', () => {
    expect(
      premium.seatWaste.incomplete || premium.seatWaste.totalIsFloor,
      'the fixture must exercise the floor path',
    ).toBe(true);
    expect(text(premium)).toMatch(/This is a floor/i);
  });
});

describe('what could not be measured says why', () => {
  it('gives a reason for every unmeasured waste category', () => {
    const unmeasured = premium.seatWaste.categories.filter((c) => !c.available);
    const t = text(premium);
    expect(unmeasured.length, 'the fixture must exercise this path').toBeGreaterThan(0);
    for (const c of unmeasured) {
      expect(t, c.label).toContain(c.label);
      expect(c.unavailableReason, c.label).toBeTruthy();
    }
    expect(t).toMatch(/unmeasured rather than as zero/i);
  });

  it('does not both promise a list of failed collectors and say there were none', () => {
    // It printed "The collectors that did not return complete data for this run:"
    // immediately followed by "Every collector returned complete data" — a contradiction
    // on the page that decides whether the other five are believed.
    const t = text(premium);
    const promisesList = /collectors that did not return complete data/i.test(t);
    const claimsNone = /Every collector returned complete data/i.test(t);
    expect(promisesList && claimsNone).toBe(false);
  });
});

describe('tenant text cannot inject markup into the pack', () => {
  it('escapes a hostile display name', () => {
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const hostile = structuredClone(parsed.snapshot);
    hostile.Collectors.organization!.Data!.DisplayName = '<img src=x onerror=alert(1)>';

    const out = render(
      <BoardPack
        model={analyze({
          snapshot: hostile,
          config: cloneConfig(),
          catalog,
          priceList: listPriceList,
          featureMap,
          riskModel,
        })}
        sourceLabel="test"
      />,
    );

    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });
});
