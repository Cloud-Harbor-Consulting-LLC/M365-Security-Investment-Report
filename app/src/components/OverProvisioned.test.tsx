/**
 * Over-provisioning, as a reader sees it.
 *
 * What is guarded is that an account counted and not priced says why, that a count which
 * is a floor says so, and that a tenant hiding names in usage reports is never told to
 * stop. That setting is the tenant's, and the tool works either way.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';

import { BoardPack } from './BoardPack';
import { NotMeasuredView, WasteView } from './views';
import { analyze } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const run = (edit?: (s: any) => void) => {
  const s = structuredClone(premiumSnapshot) as any;
  edit?.(s);
  const parsed = parseSnapshot(s);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
};

/** Markup stripped and whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');

const named = run();
const concealed = run((s) => {
  s.Collectors.appUsage.Data.Concealed = true;
  s.Collectors.appUsage.Data.Users.forEach((u: any, i: number) => (u.UserPrincipalName = `3F8A1C0E9B7D2A4C6E1F0B3D5A7C9E2${i}`));
});
const noUsage = run((s) => delete s.Collectors.appUsage);

describe('wasted spend', () => {
  it('lists the accounts, and says they are counted and not priced', () => {
    const screen = text(render(<WasteView model={named} />));
    expect(screen).toContain('Over-provisioned (desktop apps not used on a desktop) 2 Not priced measured');
    expect(screen).toContain(
      'Over-provisioned (desktop apps not used on a desktop). 2 of these accounts hold a licence whose cheaper sibling drops a security plan, so they are counted and not priced.',
    );
    expect(screen).toContain('Used the apps only on a phone or tablet and the web in 90 days.');
  });

  it('does not blame a missing price when the gap is a licence it chose not to price', () => {
    // Every other category fully priced, so the only reason the total is a floor is
    // over-provisioning's unpriced accounts. Telling the reader to add a price would not fix it.
    const m = structuredClone(named);
    for (const c of m.seatWaste.categories) if (c.id !== 'overProvisioned') c.costIsFloor = false;
    const screen = text(render(<WasteView model={m} />));
    expect(screen).toContain('Some accounts counted above are on licences this tool does not price');
    expect(screen).not.toContain('Give those SKUs a price');
    // A missing price is still blamed when it is the cause.
    const unpricedSeat = structuredClone(named);
    unpricedSeat.seatWaste.categories.find((c) => c.id === 'unassigned')!.costIsFloor = true;
    expect(text(render(<WasteView model={unpricedSeat} />))).toContain('Give those SKUs a price');
  });

  it('says a count from a tenant that hides names is a floor, and lists nobody', () => {
    const screen = text(render(<WasteView model={concealed} />));
    expect(screen).toContain('Over-provisioned (desktop apps not used on a desktop) at least 2 Not priced measured');
    // No over-provisioning drill-down. Alan may still appear under a category that reads
    // the directory rather than the usage report, which is the only thing hiding names.
    expect(screen).not.toContain('Over-provisioned (desktop apps not used on a desktop), ');
    expect(concealed.seatWaste.categories.find((c) => c.id === 'overProvisioned')!.accounts).toEqual([]);
  });
});

describe('not measured', () => {
  it('names the permission and the role that would measure it', () => {
    const screen = text(render(<NotMeasuredView model={noUsage} />));
    expect(screen).toContain('This snapshot was collected before Microsoft 365 apps usage was read.');
    expect(screen).toContain('Reports.Read.All, plus the Reports Reader role');
  });

  it('says the accounts are counted without being listed, and leaves the setting alone', () => {
    const screen = text(render(<NotMeasuredView model={concealed} />));
    expect(screen).toContain('Which accounts are over-provisioned');
    expect(screen).toContain("Nothing: the tenant's privacy setting is respected");
  });
});

describe('the board pack', () => {
  it('carries the same qualification beside the figure', () => {
    const pack = text(render(<BoardPack model={concealed} sourceLabel="test" />));
    expect(pack).toContain("This tenant hides names in Microsoft's usage reports, so the accounts cannot be listed.");
    expect(pack).toContain('at least 2');
  });
});

describe('a tenant that hides names is never told to stop', () => {
  it('on any surface', () => {
    const everything = [
      render(<WasteView model={concealed} />),
      render(<NotMeasuredView model={concealed} />),
      render(<BoardPack model={concealed} sourceLabel="test" />),
    ]
      .map(text)
      .join(' ');
    expect(everything).not.toMatch(/turn (it |this )?off|uncheck|show user|display concealed|conceal user/i);
  });
});
