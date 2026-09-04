/**
 * Parity with the PowerShell engine.
 *
 * The expected figures below are not derived from this code. They are the numbers the
 * shipped PowerShell implementation produces from the same two fixtures, asserted in
 * tests/EndToEnd.Offline.Tests.ps1 and tests/UnpricedTenant.Tests.ps1. If this engine
 * and that one ever disagree, this file fails — which is the entire justification for
 * porting the arithmetic rather than reimplementing it from the brief.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze } from './index';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const run = (raw: unknown) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(`Fixture rejected: ${parsed.reason}`);
  return analyze({
    snapshot: parsed.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
  });
};

describe('premium fixture — matches the PowerShell engine exactly', () => {
  const model = run(premiumSnapshot);

  it('counts seats across every billable SKU, priced or not', () => {
    expect(model.spend.seatsPurchased).toBe(635);
    expect(model.spend.seatsConsumed).toBe(461);
    expect(model.spend.seatsUnassigned).toBe(174);
  });

  it('totals annual commitment from priced SKUs only', () => {
    // E5 120x684 + E3 300x432 + P1 50x72 + MDO P1 100x24 + Business Standard 25x150
    expect(model.spend.annualCommitment).toBe(221430);
  });

  it('totals spend in use from assigned seats', () => {
    expect(model.spend.annualSpendConsumed).toBe(194694);
  });

  it('totals idle seat cost as the difference', () => {
    expect(model.spend.unassignedSeatCost).toBe(26736);
    expect((model.spend.annualCommitment ?? 0) - (model.spend.annualSpendConsumed ?? 0)).toBe(
      model.spend.unassignedSeatCost,
    );
  });

  it('excludes both unlimited-seat free SKUs', () => {
    expect(model.spend.skuCountExcluded).toBe(2);
    expect(model.inventory.filter((r) => r.excluded).map((r) => r.skuPartNumber)).toEqual([
      'POWER_BI_STANDARD',
      'FLOW_FREE',
    ]);
  });

  it('flags the one unpriced SKU and marks the totals incomplete', () => {
    expect(model.spend.skuCountUnpriced).toBe(1);
    expect(model.spend.complete).toBe(false);
    expect(model.spend.unpricedSkus.map((s) => s.skuPartNumber)).toEqual(['CONTOSO_CUSTOM_ADDON']);
  });

  it('computes seat realization as assigned over purchased', () => {
    expect(model.realization.seat.ratio).toBeCloseTo(0.726, 4);
  });

  it('resolves the Business Standard naming trap', () => {
    const row = model.inventory.find((r) => r.skuPartNumber === 'O365_BUSINESS_PREMIUM');
    expect(row?.displayName).toBe('Microsoft 365 Business Standard');
    expect(row?.namingTrap).toBeTruthy();
  });

  it('leaves unpriced money fields null rather than zero', () => {
    const row = model.inventory.find((r) => r.skuPartNumber === 'CONTOSO_CUSTOM_ADDON');
    expect(row?.priceKnown).toBe(false);
    expect(row?.annualCommitment).toBeNull();
    expect(row?.unassignedSeatCost).toBeNull();
    expect(row?.consumedUnits).toBe(40); // still counted in seats
  });
});

describe('unpriced fixture — the tenant where nothing can be priced', () => {
  const model = run(unpricedSnapshot);

  it('reports that no SKU was priced', () => {
    expect(model.spend.anyPriced).toBe(false);
    expect(model.spend.skuCountPriced).toBe(0);
    expect(model.spend.complete).toBe(false);
  });

  it('leaves every dollar total unknown instead of zero', () => {
    // $0 is a claim about the tenant. Null is the truth: we could not price it.
    expect(model.spend.annualCommitment).toBeNull();
    expect(model.spend.annualSpendConsumed).toBeNull();
    expect(model.spend.unassignedSeatCost).toBeNull();
    expect(model.spend.monthlySpendConsumed).toBeNull();
  });

  it('still counts seats accurately across billable SKUs', () => {
    expect(model.spend.seatsPurchased).toBe(26);
    expect(model.spend.seatsConsumed).toBe(1);
    expect(model.spend.seatsUnassigned).toBe(25);
  });

  it('excludes the free and unlimited-seat SKUs', () => {
    const excluded = model.inventory.filter((r) => r.excluded).map((r) => r.skuPartNumber);
    expect(excluded).toContain('FLOW_FREE');
    expect(excluded).toContain('TVM_Premium_Add_on');
    expect(excluded).toContain('RMSBASIC');
  });

  it('discloses session scopes beyond what the tool requests', () => {
    // The fixture carries no ScopeAssessment, so this is the empty-safe path.
    expect(Array.isArray(model.provenance.extraScopes)).toBe(true);
  });
});

describe('guards against the defects the live run exposed', () => {
  it('never claims seats are assigned based on a dollar figure', () => {
    const model = run(unpricedSnapshot);
    // 25 of 26 seats are idle while every cost is null. Any code branching on
    // unassignedSeatCost would wrongly conclude "every purchased seat assigned".
    expect(model.spend.unassignedSeatCost).toBeNull();
    expect(model.spend.seatsUnassigned).toBeGreaterThan(0);
  });

  it('returns null, not zero, when nothing was purchased', () => {
    const empty: Snapshot = {
      ...(unpricedSnapshot as unknown as Snapshot),
      Collectors: {
        ...(unpricedSnapshot as unknown as Snapshot).Collectors,
        subscribedSkus: {
          ...(unpricedSnapshot as unknown as Snapshot).Collectors.subscribedSkus,
          Data: [],
        },
      },
    };
    const model = analyze({ snapshot: empty, config: cloneConfig(), catalog, priceList: listPriceList });
    expect(model.realization.seat.ratio).toBeNull();
  });

  it('withholds the composite realization until features are measured', () => {
    const model = run(premiumSnapshot);
    expect(model.realization.seat.available).toBe(true);
    expect(model.realization.feature.available).toBe(false);
    expect(model.realization.composite.available).toBe(false);
    expect(model.realization.composite.ratio).toBeNull();
  });
});
