/**
 * Entitled versus deployed.
 *
 * The distinction the whole tool exists to make: owning a licence and having the
 * capability switched on are different things, and only the gap between them is worth
 * money to close.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze } from './index';
import { catalog, cloneConfig, featureMap, listPriceList } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const run = (raw: unknown) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({
    snapshot: parsed.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
  });
};

const gap = (model: ReturnType<typeof run>, id: string) =>
  model.features.gaps.find((g) => g.id === id)!;

describe('entitlement comes from the service plans a tenant owns', () => {
  const model = run(premiumSnapshot);

  it('finds a capability granted through a suite service plan', () => {
    // Safe Links arrives via THREAT_INTELLIGENCE inside E5, not a standalone SKU.
    const safeLinks = gap(model, 'mdo-safe-links');
    expect(safeLinks.entitled).toBe(true);
    expect(safeLinks.entitledBy).toContain('SPE_E5');
  });

  it('finds one granted through a standalone SKU whose part number is the plan name', () => {
    const safeLinks = gap(model, 'mdo-safe-links');
    expect(safeLinks.entitledBy).toContain('ATP_ENTERPRISE');
  });

  it('counts every SKU that grants a capability, not just the first', () => {
    const mfa = gap(model, 'entra-mfa-admins');
    expect(mfa.entitledBy.sort()).toEqual(['AAD_PREMIUM', 'SPE_E3', 'SPE_E5']);
  });
});

describe('deployment comes from Secure Score', () => {
  const model = run(premiumSnapshot);

  it('reads a control at zero as not deployed', () => {
    const legacy = gap(model, 'entra-block-legacy-auth');
    expect(legacy.state).toBe('notDeployed');
    expect(legacy.scoreRatio).toBe(0);
    expect(legacy.gap).toBe(1);
  });

  it('reads a partially scored control as partial, and prorates the gap', () => {
    // AdminMFAV2 scores 4.5 of 10.
    const mfa = gap(model, 'entra-mfa-admins');
    expect(mfa.state).toBe('partial');
    expect(mfa.scoreRatio).toBeCloseTo(0.45, 4);
    expect(mfa.gap).toBeCloseTo(0.55, 4);
  });

  it('carries the remediation guidance Graph supplies', () => {
    const legacy = gap(model, 'entra-block-legacy-auth');
    expect(legacy.remediation).toMatch(/Conditional Access/);
    expect(legacy.implementationCost).toBe('Low');
    expect(legacy.actionUrl).toBeTruthy();
  });

  it('surfaces the score, peer benchmark and history', () => {
    expect(model.features.currentScore).toBe(214);
    expect(model.features.maxScore).toBe(468);
    expect(model.features.scorePercent).toBeCloseTo(214 / 468, 4);
    expect(model.features.comparative.find((c) => c.basis === 'TotalSeats')?.averageScore).toBe(201.2);
    expect(model.features.history.length).toBe(9);
  });

  it('returns history oldest-first, so a trend line reads left to right', () => {
    const dates = model.features.history.map((h) => new Date(h.date).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });
});

describe('dollarization', () => {
  const model = run(premiumSnapshot);

  it('attributes spend only to capabilities the tenant is entitled to', () => {
    for (const g of model.features.gaps) {
      if (!g.entitled) expect(g.attributedSpend).toBeNull();
    }
  });

  it('splits a SKU security budget across its capabilities by weight', () => {
    // E5 spend in use is 96 x $684 = $65,664, of which 40% is the security share:
    // $26,265.60 across admin-mfa (5), block-legacy (4) and safe-links (3) = weight 12.
    const safeLinks = gap(model, 'mdo-safe-links');
    const e5Share = 65664 * 0.4;
    expect(safeLinks.attributedSpend).toBeGreaterThan((e5Share * 3) / 12 - 1);
  });

  it('charges idle spend only against the part that is not deployed', () => {
    const mfa = gap(model, 'entra-mfa-admins');
    // 55% of the capability is not in use, so 55% of its attributed spend is idle.
    expect(mfa.idleSpend).toBeCloseTo((mfa.attributedSpend ?? 0) * 0.55, 2);

    const legacy = gap(model, 'entra-block-legacy-auth');
    expect(legacy.idleSpend).toBeCloseTo(legacy.attributedSpend ?? 0, 2);
  });

  it('produces a feature realization the board tile can use', () => {
    const { featureRealization, idleSpend, attributedSpend } = model.features;
    expect(featureRealization).not.toBeNull();
    expect(featureRealization!).toBeGreaterThan(0);
    expect(featureRealization!).toBeLessThan(1);
    expect(idleSpend!).toBeLessThan(attributedSpend!);
  });
});

describe('a tenant without Security Reader', () => {
  const model = run(unpricedSnapshot);

  it('reports the analysis as unavailable rather than as no gaps found', () => {
    expect(model.features.available).toBe(false);
    expect(model.features.unavailableReason).toMatch(/SecurityEvents\.Read\.All/);
    expect(model.features.idleSpend).toBeNull();
    expect(model.features.featureRealization).toBeNull();
  });

  it('still says what the tenant is entitled to, which needs no Secure Score', () => {
    // "You own this and we cannot tell whether it is on" beats silence.
    expect(model.features.gaps.length).toBeGreaterThan(0);
    for (const g of model.features.gaps) {
      expect(g.state).toBe('unknown');
    }
  });
});

describe('controls Secure Score does not report', () => {
  it('are left unknown rather than assumed off', () => {
    // Claiming "not deployed" for a workload the tenant may not even have would invent
    // a gap, and an invented gap in a board pack is worse than an admitted unknown.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);

    const stripped = structuredClone(parsed.snapshot);
    stripped.Collectors.secureScore!.Data!.ControlScores =
      stripped.Collectors.secureScore!.Data!.ControlScores.filter(
        (c) => c.ControlName !== 'MDO_SafeLinksForOfficeApps',
      );

    const model = analyze({
      snapshot: stripped,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });

    const safeLinks = model.features.gaps.find((g) => g.id === 'mdo-safe-links')!;
    expect(safeLinks.state).toBe('unknown');
    expect(safeLinks.idleSpend).toBeNull();
  });
});

describe('spend realized', () => {
  it('is the product of both halves, because either alone overstates the tenant', () => {
    const model = run(premiumSnapshot);
    const { spend, realization } = model;
    const { feature, composite } = realization;

    const spendRatio = spend.annualSpendConsumed! / spend.annualCommitment!;
    expect(composite.available).toBe(true);
    expect(composite.ratio).toBeCloseTo(spendRatio * feature.ratio!, 6);
    // The whole point: it must be no kinder than the weaker of the two.
    expect(composite.ratio!).toBeLessThanOrEqual(Math.min(spendRatio, feature.ratio!) + 1e-9);
  });

  it('weighs the seat half by money, not by seat count', () => {
    // A tenant holding 25 free trial seats beside one paid seat assigns 4% of its seats
    // and 100% of its commitment. Calling that "4% of spend realized" reads as a crisis
    // on a tenant whose every dollar is on an assigned seat — the live demo tenant
    // reported exactly 2% while the idle-spend tile beside it correctly read $0.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);

    // Give one SKU a huge unassigned seat count at a price of zero.
    const free = s.Collectors.subscribedSkus.Data!.find((k) => k.SkuPartNumber === 'AAD_PREMIUM')!;
    free.PrepaidEnabled = 5000;
    free.ConsumedUnits = 0;

    const model = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: { ...listPriceList, prices: listPriceList.prices.map((p) => (p.skuPartNumber === 'AAD_PREMIUM' ? { ...p, unitPriceMonthly: 0 } : p)) },
      featureMap,
    });

    const seatRatio = model.spend.seatsConsumed / model.spend.seatsPurchased;
    const spendRatio = model.spend.annualSpendConsumed! / model.spend.annualCommitment!;
    expect(spendRatio).toBeGreaterThan(seatRatio);
    expect(model.realization.composite.ratio).toBeCloseTo(
      spendRatio * model.realization.feature.ratio!,
      6,
    );
  });

  it('is withheld, not estimated, when Secure Score was refused', () => {
    const model = run(unpricedSnapshot);
    expect(model.realization.composite.available).toBe(false);
    expect(model.realization.composite.ratio).toBeNull();
    // Seat realization is still measurable and still reported.
    expect(model.realization.seat.available).toBe(true);
  });
});
