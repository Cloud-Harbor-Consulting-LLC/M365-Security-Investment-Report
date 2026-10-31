/**
 * The interaction pass's new pictures, held to the figures they draw.
 *
 * A chart is a second way of stating a number, so what is guarded is that it states the
 * same one: the split adds up to the commitment and its first part is the headline, it is
 * absent whenever that headline is withheld, and the progress bar says in words what it
 * shows in colour.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { CommitmentSplit } from './CommitmentSplit';
import { CollectionProgress } from './Connect';
import { Dashboard } from './Dashboard';
import { analyze, clearOverrides } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';
import { money } from '@/format';

const run = (raw: unknown, edit?: (s: any) => void) => {
  const s = structuredClone(raw) as any;
  edit?.(s);
  const parsed = parseSnapshot(s);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('where the commitment goes', () => {
  const model = run(premiumSnapshot);
  const shown = text(render(<CommitmentSplit model={model} />));

  it('leads with the spend realized figure, in the same rounding', () => {
    const headline = Math.round(model.realization.composite.ratio! * 100);
    expect(shown).toContain(`${headline}% realized`);
    expect(shown).toContain(`(${headline}%)`);
  });

  it('splits the whole commitment, with labels that add up to 100%', () => {
    expect(shown).toContain(`Where the ${money(model.spend.annualCommitment, model.spend.currency)} goes`);
    const percents = [...shown.matchAll(/\((\d+)%\)/g)].map((m) => Number(m[1]));
    expect(percents).toHaveLength(3);
    expect(percents.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shown).toContain(`${money(model.spend.unassignedSeatCost, model.spend.currency)} idle seats`);
  });

  it('is not drawn when spend realized is withheld', () => {
    expect(render(<CommitmentSplit model={run(unpricedSnapshot)} />)).toBe('');
    const noScore = run(premiumSnapshot, (s) => delete s.Collectors.secureScore);
    expect(noScore.realization.composite.available).toBe(false);
    expect(render(<CommitmentSplit model={noScore} />)).toBe('');
  });
});

describe('the collection progress bar', () => {
  it('counts a read in flight as half, and says in words how far it is', () => {
    const html = render(<CollectionProgress states={['done', 'done', 'running', 'pending', 'pending']} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuetext="2 of 5 reads finished"');
  });

  it('treats a read that came back degraded or failed as finished', () => {
    const html = render(<CollectionProgress states={['done', 'degraded', 'failed', 'done', 'done']} />);
    expect(html).toContain('aria-valuenow="100"');
  });
});

describe('the missing-price notice', () => {
  const noop = () => null;
  const dashboard = (raw: unknown) =>
    text(
      render(
        <Dashboard
          model={run(raw)}
          sourceLabel="sample.json"
          overrides={clearOverrides()}
          onPriceChange={noop}
          onResetOverrides={noop}
          onSaveSession={() => null}
          session={() => ({}) as any}
          onReset={noop}
        />,
      ),
    );

  it('names how many SKUs have no price and offers to add them', () => {
    expect(dashboard(premiumSnapshot)).toMatch(/1 SKU has seats but no price\. Add a price/);
  });

  it('stays away when every SKU is priced', () => {
    const allPriced = run(premiumSnapshot);
    expect(allPriced.spend.skuCountUnpriced).toBeGreaterThan(0);
    const priced = structuredClone(premiumSnapshot) as any;
    priced.Collectors.subscribedSkus.Data = priced.Collectors.subscribedSkus.Data.filter(
      (s: any) => s.SkuPartNumber !== 'CONTOSO_CUSTOM_ADDON',
    );
    expect(run(priced).spend.skuCountUnpriced).toBe(0);
    expect(dashboard(priced)).not.toContain('seats but no price');
  });
});
