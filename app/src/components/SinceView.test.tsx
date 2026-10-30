/**
 * "Since last review", on screen and in the board pack.
 *
 * Asserted against rendered text rather than markup, so a test cannot pass on a class name.
 * What is guarded is what a quarterly review relies on: the sentence the room repeats, the
 * regressions shown before the good news, and nothing unmeasured rendered as no change.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import baselineSnapshot from '@fixtures/premium-baseline-snapshot.json';

import { SinceView } from './SinceView';
import { BoardPack } from './BoardPack';
import { analyze } from '@/engine';
import { compareSnapshots, type RunComparison } from '@/engine/compare';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const snap = (raw: unknown): Snapshot => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};

const inputs = { config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel };
const model = analyze({ ...inputs, snapshot: snap(premiumSnapshot) });

const compare = (baseline: unknown): RunComparison => {
  const r = compareSnapshots({ ...inputs, baseline: snap(baseline), current: snap(premiumSnapshot) });
  if (!r.ok) throw new Error(r.reason);
  return r.comparison;
};

/**
 * Markup stripped and whitespace collapsed. Inline tags go without a trace, so
 * "<strong>38.5%</strong>." reads "38.5%."; block and cell tags become a space, so
 * neighbouring cells do not run together.
 */
const text = (html: string) =>
  html
    .replace(/<\/?(strong|em|b|i|span|code)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const june = compare(baselineSnapshot);
const screen = text(render(<SinceView model={model} comparison={june} note={null} />));

describe('the view', () => {
  it('opens with the sentence a review repeats', () => {
    // 0.8514 x 0.3550 = 30.2% in June; 0.8801 x 0.4375 = 38.5% in September.
    expect(screen).toContain('Since 3 Jun 2026, spend realized rose from 30.2% to 38.5%.');
    expect(screen).toContain('2 controls closed, 2 improved and 2 regressed.');
    expect(screen).toContain('Idle seat spend fell by $5,544 a year.');
  });

  it('carries the figures behind it', () => {
    expect(screen).toContain('+8.3 percentage points');
    expect(screen).toContain('was 169 of 476');
    expect(screen).toContain('−$5,544');
    expect(screen).toContain('+$8,640');
  });

  it('shows regressions before closures', () => {
    expect(screen.indexOf('AntiPhishPolicy')).toBeGreaterThan(-1);
    expect(screen.indexOf('AntiPhishPolicy')).toBeLessThan(screen.indexOf('MailboxAuditing'));
    expect(screen).toContain('14 other scored controls are unchanged');
  });

  it('shows the licence that was dropped', () => {
    expect(screen).toMatch(/Enterprise Mobility \+ Security E3 EMS removed 40 → 0 40 → 0 −\$5,760/);
  });

  it('marks a category measured in neither run as not comparable, never as no change', () => {
    const strip = (raw: unknown): Snapshot => {
      const s = structuredClone(snap(raw));
      delete s.Collectors.appUsage;
      return s;
    };
    const neither = compareSnapshots({ ...inputs, baseline: strip(baselineSnapshot), current: strip(premiumSnapshot) });
    if (!neither.ok) throw new Error(neither.reason);
    const current = analyze({ ...inputs, snapshot: strip(premiumSnapshot) });
    const shown = text(render(<SinceView model={current} comparison={neither.comparison} note={null} />));
    expect(shown).toMatch(/Over-provisioned[^|]*?n\/a n\/a n\/a not comparable/);
  });

  it('says how the 2 runs were compared', () => {
    expect(screen).toContain('priced at the prices this report uses now');
  });
});

describe('a run that could not measure something', () => {
  const noScore = (() => {
    const s = structuredClone(premiumSnapshot) as any;
    const back = (iso: string) => new Date(Date.parse(iso) - 30 * 86_400_000).toISOString();
    s.GeneratedAt = back(s.GeneratedAt);
    for (const c of Object.values(s.Collectors) as any[]) c.CollectedAt = back(c.CollectedAt);
    s.Collectors.secureScore.Available = false;
    s.Collectors.secureScore.Data = null;
    s.Collectors.secureScore.Reason = 'SecurityEvents.Read.All was not granted.';
    return s;
  })();
  const view = text(render(<SinceView model={model} comparison={compare(noScore)} note={null} />));

  it('says what could not be compared, and why', () => {
    expect(view).toContain('Not everything could be compared');
    expect(view).toContain('Secure Score was not collected in the earlier run');
    expect(view).toContain('control changes cannot be shown');
  });

  it('shows today’s figure, and no change where there is nothing to compare it with', () => {
    // Today's figures are real and are shown as such. Only the change is unavailable,
    // and it is said to be, never rendered as zero.
    expect(view).toContain('38.5%');
    expect(view).toContain('No earlier figure to compare with');
    expect(view).not.toMatch(/\+0\b|\+\$0\b/);
    // The spend realized tile in particular: 38.5% today, and no change claimed.
    expect(view).toMatch(/Spend realized 38\.5% No earlier figure to compare with/);
    // Spend realized needs Secure Score, so it is not compared, and the lead sentence
    // does not invent a movement for it.
    expect(view).not.toContain('spend realized rose');
  });
});

describe('the board pack', () => {
  const pages = (c: RunComparison | null) =>
    render(<BoardPack model={model} sourceLabel="test" comparison={c} />).match(/class="pack-page/g) ?? [];

  it('adds a page for the comparison, and only while there is one', () => {
    expect(pages(null)).toHaveLength(6);
    expect(pages(june)).toHaveLength(7);
  });

  it('puts the review question second, after the position', () => {
    const pack = text(render(<BoardPack model={model} sourceLabel="test" comparison={june} />));
    expect(pack.indexOf('Since last review')).toBeGreaterThan(pack.indexOf('The position'));
    expect(pack.indexOf('Since last review')).toBeLessThan(pack.indexOf('Wasted spend'));
    expect(pack).toContain('spend realized rose from 30.2% to 38.5%');
    expect(pack).toContain('Enterprise Mobility + Security E3 dropped');
  });
});
