/**
 * Microsoft 365 E7, which has broken this tool twice in two different ways.
 *
 * First its agent service plans disqualified it from entitling anything, because the rule
 * that keeps Agent 365 licences from entitling human controls matched on plan names and
 * E7 carries AGENT_365 and twelve *_FOR_AGENTS plans among its 124. A demo tenant read
 * 251 of 263 controls as not licensed.
 *
 * Then, with that fixed, E7 turned out to carry no price. A tenant whose only paid licence
 * is E7 produced a report with no dollar figure anywhere: no commitment, no attribution, no
 * spend realized, and an empty licence rollup. The entitlement was right and the report was
 * still useless.
 *
 * Both failures came from the same shape, a single modern suite doing everything, so the
 * fixture is that shape and these tests hold both ends of it.
 */
import { describe, expect, it } from 'vitest';

import e7Snapshot from '@fixtures/e7-snapshot.json';

import { analyze } from './index';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const model = (() => {
  const parsed = parseSnapshot(e7Snapshot);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({
    snapshot: parsed.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
  });
})();

describe('E7 is priced', () => {
  it('appears in the shipped price list', () => {
    // Its absence is what made an E7 tenant unpriceable, and nothing else in the file
    // would have caught it: the list is a flat array and a missing entry is silent.
    const entry = listPriceList.prices.find((p) => p.skuPartNumber === 'MICROSOFT_365_E7');
    expect(entry, 'MICROSOFT_365_E7 must have a price').toBeTruthy();
    expect(entry!.monthlyPerSeat).toBeGreaterThan(0);
  });

  it('produces real figures for a tenant that owns nothing else', () => {
    expect(model.spend.anyPriced).toBe(true);
    expect(model.spend.skuCountUnpriced).toBe(0);

    // 50 purchased and 40 assigned, so the arithmetic is checkable by hand.
    const rate = listPriceList.prices.find((p) => p.skuPartNumber === 'MICROSOFT_365_E7')!.monthlyPerSeat;
    expect(model.spend.seatsPurchased).toBe(50);
    expect(model.spend.seatsConsumed).toBe(40);
    expect(model.spend.annualCommitment).toBeCloseTo(50 * rate * 12, 2);
    expect(model.spend.annualSpendConsumed).toBeCloseTo(40 * rate * 12, 2);
    expect(model.spend.unassignedSeatCost).toBeCloseTo(10 * rate * 12, 2);
  });

  it('withholds nothing on the board', () => {
    // The composite was withheld for an E7 tenant, because the spend half of it had no
    // number to work with. A suite this expensive reporting no realization at all is the
    // failure a customer notices first.
    expect(model.realization.composite.available).toBe(true);
    expect(model.realization.composite.ratio).toBeGreaterThan(0);
  });
});

describe('E7 entitles the controls it carries', () => {
  it('is not mistaken for an agent licence', () => {
    // The regression: E7 bundles Agent 365, so plan-name markers alone disqualified it.
    // A part number is what separates a suite that includes agents from a licence for them.
    const rows = model.features.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.entitlementBasis === 'notEntitled')).toEqual([]);
  });

  it('attributes controls to E7 by service plan', () => {
    const byPlan = model.features.rows.filter((r) => r.entitlementBasis === 'servicePlans');
    expect(byPlan.length).toBeGreaterThan(0);
    for (const row of byPlan) {
      expect(row.entitledBy, row.controlName).toContain('MICROSOFT_365_E7');
    }
  });

  it('carries the Entra ID Premium plans that entitle MFA', () => {
    // A spot check with a control whose requirement is unambiguous, so a future change to
    // the plan list cannot quietly stop E7 entitling identity controls.
    const mfa = model.features.rows.find((r) => r.controlName === 'AdminMFAV2');
    expect(mfa, 'the fixture must score AdminMFAV2').toBeTruthy();
    expect(mfa!.requiredPlans).toContain('AAD_PREMIUM');
    expect(mfa!.entitledBy).toContain('MICROSOFT_365_E7');
  });

  it('names the product rather than the part number', () => {
    const rollup = model.features.licences.find((l) => l.skuPartNumber === 'MICROSOFT_365_E7');
    expect(rollup, 'E7 must appear in the additive rollup').toBeTruthy();
    expect(rollup!.displayName).toBe('Microsoft 365 E7');
    expect(rollup!.annualCost).toBeGreaterThan(0);
    expect(rollup!.controls).toBeGreaterThan(0);
  });

  it('attributes spend across the controls it entitles', () => {
    // Every control the suite entitles should carry a cost, which is what was null for all
    // 263 of them on the unpriced tenant.
    const entitled = model.features.rows.filter((r) => r.entitlementBasis === 'servicePlans');
    expect(entitled.every((r) => r.costSku === 'MICROSOFT_365_E7')).toBe(true);
    expect(model.features.attributedSpend).toBeGreaterThan(0);
  });
});
