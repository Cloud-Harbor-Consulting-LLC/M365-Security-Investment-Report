/**
 * Entitled versus deployed.
 *
 * The distinction the whole tool exists to make: owning a licence and having the
 * capability switched on are different things, and the gap between them is what the
 * customer is paying for and not receiving.
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

const row = (model: ReturnType<typeof run>, controlName: string) =>
  model.features.rows.find((r) => r.controlName === controlName)!;

describe('the table is the tenant, not our JSON file', () => {
  const model = run(premiumSnapshot);

  it('carries one row per control Microsoft scores for this tenant', () => {
    // The complaint that produced this: two tenants with different SKUs and different
    // configurations showed an identical three-row table, because the table was the
    // feature map rather than the tenant.
    expect(model.features.rows.length).toBeGreaterThan(featureMap.features.length);
    const names = model.features.rows.map((r) => r.controlName);
    expect(names).toContain('PrivilegedIdentityManagement');
    expect(names).toContain('SPExternalSharing');
  });

  it('includes a control the tenant has never started, rather than omitting it', () => {
    // No score row means zero, not absent. Omitting those would hide the gaps most
    // worth closing.
    const pim = row(model, 'PrivilegedIdentityManagement');
    expect(pim.state).toBe('notDeployed');
    expect(pim.score).toBe(0);
    expect(pim.maxScore).toBeGreaterThan(0);
  });

  it('leads with the most money on the table', () => {
    const unlockable = model.features.rows.map((r) => r.unlockableSpend ?? 0);
    expect(unlockable).toEqual([...unlockable].sort((a, b) => b - a));
  });
});

describe('entitled by', () => {
  const model = run(premiumSnapshot);

  it('names the SKUs whose service plans actually unlock the control', () => {
    // Safe Links is unlocked by Defender for Office, which the tenant holds through E5's
    // THREAT_INTELLIGENCE plan and through the standalone ATP_ENTERPRISE SKU.
    const safeLinks = row(model, 'MDO_SafeLinksForOfficeApps');
    expect(safeLinks.entitlementBasis).toBe('servicePlans');
    expect(safeLinks.entitledBy.length).toBeGreaterThan(0);
    expect(safeLinks.requiredPlans).toContain('ATP_ENTERPRISE');
  });

  it('counts every SKU that unlocks a capability, not just the first', () => {
    const mfa = row(model, 'AdminMFAV2');
    expect(mfa.entitledBy).toContain('AAD_PREMIUM');
    expect(mfa.entitledBy.length).toBeGreaterThan(1);
  });

  it('separates a control needing no licence from one nobody has mapped', () => {
    // Collapsing these would let a gap in our own research read as a fact about the
    // tenant. "Free" and "not yet checked" are different claims.
    const free = row(model, 'OneAdmin');
    expect(free.entitlementBasis).toBe('noLicenceRequired');
    expect(free.attributedSpend).toBeNull();
  });

  it('flags a control the tenant is scored on but holds no licence for', () => {
    // The opposite of idle spend: closing it costs new money rather than releasing money
    // already committed, so it carries no idle figure.
    for (const r of model.features.rows.filter((x) => x.entitlementBasis === 'notEntitled')) {
      expect(r.entitledBy).toEqual([]);
      expect(r.attributedSpend).toBeNull();
      expect(r.requiredPlans.length).toBeGreaterThan(0);
    }
  });
});

describe('deployment comes from Secure Score', () => {
  const model = run(premiumSnapshot);

  it('reads a control at zero as not deployed', () => {
    expect(row(model, 'BlockLegacyAuthentication').state).toBe('notDeployed');
    expect(row(model, 'BlockLegacyAuthentication').scoreRatio).toBe(0);
  });

  it('reads a partially scored control as partial', () => {
    const mfa = row(model, 'AdminMFAV2'); // 4.5 of 10
    expect(mfa.state).toBe('partial');
    expect(mfa.scoreRatio).toBeCloseTo(0.45, 4);
  });

  it('carries the remediation guidance Graph supplies', () => {
    const legacy = row(model, 'BlockLegacyAuthentication');
    expect(legacy.remediation).toMatch(/Conditional Access/);
    expect(legacy.implementationCost).toBe('Low');
    expect(legacy.actionUrl).toBeTruthy();
  });

  it('surfaces the score, peer benchmark and history', () => {
    expect(model.features.currentScore).toBe(213.5);
    expect(model.features.maxScore).toBe(488);
    expect(model.features.comparative.find((c) => c.basis === 'TotalSeats')?.averageScore).toBe(201.2);
    expect(model.features.history.length).toBe(9);
  });

  it('returns history oldest-first, so a trend line reads left to right', () => {
    const dates = model.features.history.map((h) => new Date(h.date).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });
});

describe('a control costs what its enabling licence costs', () => {
  const model = run(premiumSnapshot);

  it('carries the whole cost of the licence that enables it, not a share', () => {
    // The clarification that produced this model: mailbox auditing is off, and Exchange
    // Online Plan 1 is what you pay to have it. Dividing that SKU across the nine
    // controls it enables produced figures under a dollar and answered nothing.
    const mfa = row(model, 'AdminMFAV2');
    expect(mfa.costSku).toBeTruthy();
    const sku = model.inventory.find((i) => i.skuPartNumber === mfa.costSku)!;
    expect(mfa.attributedSpend).toBeCloseTo(sku.annualSpendConsumed!, 6);
  });

  it('picks the cheaper product by seat price, not the smaller total', () => {
    // A tenant holding both E5 and Exchange Online Plan 1 is not spending E5 money to
    // audit mailboxes. Ranked per seat, because a total scales with seat count: one seat
    // of E5 has a smaller total than fifty seats of Business Basic without being cheaper.
    for (const r of model.features.rows.filter((x) => x.costBasis === 'owned')) {
      const candidates = model.inventory.filter(
        (i) =>
          r.entitledBy.includes(i.skuPartNumber) && i.consumedUnits > 0 && i.unitPriceMonthly !== null,
      );
      const cheapestSeat = Math.min(...candidates.map((c) => c.unitPriceMonthly!));
      const chosen = model.inventory.find((i) => i.skuPartNumber === r.costSku)!;
      expect(chosen.unitPriceMonthly).toBeCloseTo(cheapestSeat, 6);
    }
  });

  it('never prices a control off a licence nobody is assigned', () => {
    // The defect this replaced: a SKU with zero assigned seats costs zero, so ranking by
    // total annual cost made it the "cheapest" qualifying licence every single time. One
    // unassigned trial SKU zeroed 60 controls on a live tenant, and the whole Security
    // features page read $0. A licence nobody holds does not enable anything for the
    // people who do — that is unassigned spend, which the waste analysis covers.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);

    // A free-looking trial carrying the same plans as the real Entra licence, assigned to
    // nobody — exactly the shape that broke the live tenant.
    const donor = s.Collectors.subscribedSkus.Data!.find((k) => k.SkuPartNumber === 'AAD_PREMIUM')!;
    s.Collectors.subscribedSkus.Data!.push({
      ...structuredClone(donor),
      SkuId: 'trial-0000',
      SkuPartNumber: 'UNASSIGNED_TRIAL',
      ConsumedUnits: 0,
      PrepaidEnabled: 25,
    });

    const m = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: { ...listPriceList, prices: [...listPriceList.prices, { skuPartNumber: 'UNASSIGNED_TRIAL', monthlyPerSeat: 0 }] },
      featureMap,
    });

    expect(m.features.licences.map((l) => l.skuPartNumber)).not.toContain('UNASSIGNED_TRIAL');
    for (const r of m.features.rows.filter((x) => x.costBasis === 'owned')) {
      expect(r.costSku).not.toBe('UNASSIGNED_TRIAL');
      expect(r.attributedSpend).toBeGreaterThan(0);
    }
  });

  it('allocates no cost to a control that needs no paid licence', () => {
    const free = row(model, 'OneAdmin');
    expect(free.entitlementBasis).toBe('noLicenceRequired');
    expect(free.attributedSpend).toBeNull();
  });

  it('rolls totals up per licence, because the column is not additive', () => {
    // Several controls can name one SKU and each carries its full cost, so summing the
    // column would multiply one licence by the number of controls depending on it.
    const { features } = model;
    for (const l of features.licences) {
      expect(l.controls).toBeGreaterThan(0);
      expect(l.deployed).toBeLessThanOrEqual(l.controls);
    }
    const skus = features.licences.map((l) => l.skuPartNumber);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('earns a licence in proportion to the controls it enables that are in place', () => {
    // All-or-nothing was the first attempt: it reported zero earned on a tenant with 134
    // of 162 controls deployed, which overstates the problem in the one direction a
    // spend-realization report must not.
    const { features } = model;
    const owned = features.licences.filter((l) => l.basis === 'owned');
    const expected = owned.reduce((t, l) => t + (l.annualCost * l.deployed) / l.controls, 0);
    expect(features.realizedSpend).toBeCloseTo(expected, 4);
    expect(features.realizedSpend! + features.unlockableSpend!).toBeCloseTo(
      features.attributedSpend!,
      4,
    );
  });
});

describe('the numbers in this report agree with each other', () => {
  it('splits every attributed dollar into exactly realized plus unlockable', () => {
    const { features } = run(premiumSnapshot);
    expect(features.realizedSpend! + features.unlockableSpend!).toBeCloseTo(
      features.attributedSpend!,
      4,
    );
  });

  it('keeps spend realized the product of the two halves it claims to be', () => {
    const { features, realization, spend } = run(premiumSnapshot);
    const spendRatio = spend.annualSpendConsumed! / spend.annualCommitment!;
    expect(realization.composite.ratio).toBeCloseTo(spendRatio * features.featureRealization!, 6);
  });


  it('rests feature realization on the tenant, not on the curated subset', () => {
    const model = run(premiumSnapshot);
    expect(model.features.featureRealization).toBeCloseTo(
      model.features.currentScore! / model.features.maxScore!,
      6,
    );
  });
});

describe('a tenant without Security Reader', () => {
  const model = run(unpricedSnapshot);

  it('reports the analysis as unavailable rather than as no gaps found', () => {
    expect(model.features.available).toBe(false);
    expect(model.features.unavailableReason).toMatch(/SecurityEvents\.Read\.All/);
    expect(model.features.rows).toEqual([]);
    expect(model.features.unlockableSpend).toBeNull();
    expect(model.features.featureRealization).toBeNull();
  });

  it('withholds spend realized rather than estimating it from seats alone', () => {
    expect(model.realization.composite.available).toBe(false);
    expect(model.realization.composite.ratio).toBeNull();
    expect(model.realization.seat.available).toBe(true);
  });
});

describe('a tenant where nothing could be priced', () => {
  it('still says what is deployed, and leaves every dollar figure null', () => {
    // "We can see this is off, and we cannot tell you what it costs" is a useful
    // sentence. A zero in its place would not be.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);

    const model = analyze({
      snapshot: parsed.snapshot,
      config: cloneConfig(),
      catalog,
      priceList: { ...listPriceList, prices: [] },
      featureMap,
    });

    expect(model.features.rows.length).toBeGreaterThan(0);
    expect(model.features.attributedSpend).toBeNull();
    for (const r of model.features.rows) {
      expect(r.attributedSpend).toBeNull();
      expect(r.unlockableSpend).toBeNull();
      expect(r.state).not.toBe('unknown');
    }
  });
});

describe('spend realized', () => {
  it('weighs the seat half by money, not by seat count', () => {
    // A tenant holding free trial seats beside one paid seat assigns a small share of
    // its seats and all of its commitment. Calling that "4% of spend realized" reads as
    // a crisis on a tenant whose every dollar is on an assigned seat — the live demo
    // tenant reported 2% while the idle-spend tile beside it correctly read $0.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);

    const free = s.Collectors.subscribedSkus.Data!.find((k) => k.SkuPartNumber === 'AAD_PREMIUM')!;
    free.PrepaidEnabled = 5000;
    free.ConsumedUnits = 0;

    const model = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: {
        ...listPriceList,
        prices: listPriceList.prices.map((p) =>
          p.skuPartNumber === 'AAD_PREMIUM' ? { ...p, unitPriceMonthly: 0 } : p,
        ),
      },
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
});

describe('the scored control set is checked against the tenant Secure Score', () => {
  it('reports agreement when the profiles account for the maximum', () => {
    const model = run(premiumSnapshot);
    expect(model.features.profileMaxTotal).toBe(model.features.maxScore);
    expect(model.features.reconciles).toBe(true);
  });

  it('reports disagreement when the profile list is wider than what is scored', () => {
    // A live tenant returned 460 control profiles summing to roughly 4,600 points
    // against a stated maximum of 1,215. That inflates the attribution denominator and
    // makes every per-control figure too small, while still looking plausible. The
    // report must notice on its own rather than wait for someone to check the
    // arithmetic by hand.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);
    s.Collectors.secureScore!.Data!.MaxScore = 120; // profiles sum to 488

    const model = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });

    expect(model.features.reconciles).toBe(false);
    expect(model.features.profileMaxTotal).toBeGreaterThan(model.features.maxScore!);
  });
});

describe('Microsoft service codes are shown as product names', () => {
  const label = (raw: string | null) => {
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);
    s.Collectors.secureScore!.Data!.ControlProfiles[0]!.Service = raw;
    const m = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });
    return m.features.rows.find(
      (r) => r.controlName === s.Collectors.secureScore!.Data!.ControlProfiles[0]!.ControlName,
    )!.service;
  };

  it('maps the retired product names Graph still emits', () => {
    // These are what a real tenant returned. A customer reading "MDATP" or "Azure ATP"
    // in a report they are being asked to act on will not recognise their own products.
    expect(label('MDATP')).toBe('Microsoft Defender for Endpoint');
    expect(label('Azure ATP')).toBe('Microsoft Defender for Identity');
    expect(label('AzureAD')).toBe('Microsoft Entra ID');
    expect(label('OATP')).toBe('Microsoft Defender for Office 365');
    expect(label('MCAS')).toBe('Microsoft Defender for Cloud Apps');
  });

  it('resolves spelling variants to one entry rather than one fix per variant', () => {
    for (const variant of ['Azure AD', 'AzureAD', 'azure_ad', 'AZURE-AD', ' azure ad ']) {
      expect(label(variant)).toBe('Microsoft Entra ID');
    }
  });

  it('passes an unmapped code through instead of guessing a product name', () => {
    // Inventing a label Microsoft never used would be worse than showing their code.
    expect(label('SomeFutureService')).toBe('SomeFutureService');
  });

  it('says Other when Graph supplies nothing', () => {
    expect(label(null)).toBe('Other');
    expect(label('   ')).toBe('Other');
  });
});

describe('the row set is what Microsoft scores, not everything it publishes', () => {
  const model = run(premiumSnapshot);

  it('drops a control published but not scored for this tenant', () => {
    // A production tenant returned 460 profiles summing to 2,613 points against a stated
    // maximum of 1,215. The 250 unscored ones were capabilities the tenant does not have,
    // and including them more than doubled the attribution denominator — every per-control
    // figure came out in pennies while the table filled with irrelevant rows.
    expect(model.features.rows.map((r) => r.controlName)).not.toContain('UnscoredForThisTenant');
  });

  it('keeps the points it accounts for equal to the tenant Secure Score maximum', () => {
    expect(model.features.profileMaxTotal).toBe(model.features.maxScore);
    expect(model.features.reconciles).toBe(true);
  });

  it('keeps controls sitting at zero, which are the gaps worth finding', () => {
    // The risk in driving from score rows was that Microsoft might omit not-started
    // controls. It does not: 39 of the production tenant's 210 were at zero.
    expect(model.features.rows.filter((r) => r.state === 'notDeployed').length).toBeGreaterThan(0);
  });
});

describe('a licence bought but assigned to nobody', () => {
  const unassigned = () => {
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);
    // Bought, rolled out to nobody yet — the shape a live tenant was in.
    for (const k of s.Collectors.subscribedSkus.Data!) {
      if (k.SkuPartNumber === 'AAD_PREMIUM') {
        k.ConsumedUnits = 0;
        k.PrepaidEnabled = 10;
      }
    }
    return analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });
  };

  it('still carries a figure, because it is still being invoiced', () => {
    // Excluding zero-seat licences outright was the first fix for the zero-cost defect,
    // and it left 118 Defender for Endpoint controls and 3 Entra ID controls with no
    // figure at all on a tenant that had bought both and not yet rolled them out.
    const model = unassigned();
    const priced = model.features.rows.filter(
      (r) => !r.baseline && r.entitlementBasis === 'servicePlans' && r.attributedSpend === null,
    );
    expect(priced).toEqual([]);
  });

  it('reports the annual commitment, and says the seats are unassigned', () => {
    const model = unassigned();
    const row = model.features.rows.find((r) => r.costSku === 'AAD_PREMIUM');
    if (row) {
      expect(row.costBasis).toBe('unassigned');
      const sku = model.inventory.find((i) => i.skuPartNumber === 'AAD_PREMIUM')!;
      // Commitment, not spend in use: nobody is assigned, so spend in use is zero and
      // reporting that as the cost of the capability would read as free.
      expect(row.attributedSpend).toBeCloseTo(sku.annualCommitment!, 6);
    }
  });

  it('still prefers an assigned licence when one qualifies', () => {
    // The original defect must stay fixed: a zero-seat licence is a fallback, never a
    // winner. Ranking by per-seat price is what keeps it from being chosen on cost.
    const model = unassigned();
    for (const r of model.features.rows.filter((x) => x.costBasis === 'owned')) {
      const sku = model.inventory.find((i) => i.skuPartNumber === r.costSku)!;
      expect(sku.consumedUnits).toBeGreaterThan(0);
    }
  });
});
