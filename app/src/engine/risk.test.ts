/**
 * Expected loss, and the order to work in.
 *
 * The model is deliberately simple and deliberately labelled: likelihood times impact,
 * per threat, with both inputs stated as assumptions. What the tests guard is that the
 * arithmetic stays honest about which parts are Microsoft's and which are ours.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze } from './index';
import { describeScale, effortWeight, estimateHeadcount, riskScale, threatKey } from './risk';
import type { InventoryRow } from './inventory';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type TenantUser } from '@/model/snapshot';

const run = (raw: unknown) => {
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

describe('expected loss rests on Microsoft threat tags', () => {
  const model = run(premiumSnapshot);

  it('covers every scored control, not the curated handful', () => {
    // The trap this avoids is the one the feature map fell into: a headline resting on
    // three hand-written entries. Microsoft tags each control with the threats it
    // mitigates, so the linkage is theirs and it covers the whole scored set.
    expect(model.risk.available).toBe(true);
    expect(model.risk.threats.length).toBeGreaterThan(3);
    const covered = model.risk.threats.reduce((s, t) => s + t.controls, 0);
    expect(covered).toBeGreaterThan(model.features.rows.length / 2);
  });

  it('computes expected loss as likelihood times impact, and nothing cleverer', () => {
    for (const t of model.risk.threats) {
      expect(t.expectedLoss).toBeCloseTo(t.annualLikelihood * t.impactUsd, 6);
    }
  });

  it('splits each threat into avoided and retained by the points actually earned', () => {
    for (const t of model.risk.threats) {
      expect(t.coverage).toBeCloseTo(t.score / t.maxScore, 6);
      expect(t.avoided).toBeCloseTo(t.expectedLoss * t.coverage, 6);
      expect(t.avoided + t.retained).toBeCloseTo(t.expectedLoss, 6);
    }
    expect(model.risk.avoidedAnnual + model.risk.retainedAnnual).toBeCloseTo(
      model.risk.expectedLossAnnual,
      4,
    );
  });

  it('leads with the threat carrying the most retained loss', () => {
    const retained = model.risk.threats.map((t) => t.retained);
    expect(retained).toEqual([...retained].sort((a, b) => b - a));
  });

  it('withholds the estimate rather than inventing a linkage', () => {
    // A tenant whose controls carry no threat tags gets no expected-loss figure. An
    // expected loss with no threat behind it is a number with no argument.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const s = structuredClone(parsed.snapshot);
    for (const p of s.Collectors.secureScore!.Data!.ControlProfiles) p.Threats = [];

    const m = analyze({
      snapshot: s,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      riskModel,
    });
    expect(m.risk.available).toBe(false);
    expect(m.risk.unavailableReason).toMatch(/tagged none/i);
    expect(m.risk.expectedLossAnnual).toBe(0);
    // The spend analysis is untouched: risk being unavailable is not a reason to
    // withhold what the licences cost.
    expect(m.features.rows.length).toBeGreaterThan(0);
  });

  it('says so when Secure Score itself is missing', () => {
    const m = run(unpricedSnapshot);
    expect(m.risk.available).toBe(false);
    expect(m.roadmap).toEqual([]);
  });
});

describe('the roadmap ranks value against effort', () => {
  const model = run(premiumSnapshot);

  it('lists only what is not already deployed', () => {
    for (const s of model.roadmap) {
      const r = model.features.rows.find((x) => x.controlName === s.controlName)!;
      expect(r.state).not.toBe('deployed');
    }
  });

  it('orders by value per unit of effort, descending', () => {
    const ratios = model.roadmap.map((s) => s.ratio);
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
  });

  it('counts both risk retired and spend unlocked as value', () => {
    // A customer weighs them together, so the ranking does too.
    for (const s of model.roadmap) {
      expect(s.ratio).toBeCloseTo((s.riskRetired + (s.spendUnlocked ?? 0)) / s.effort, 6);
    }
  });

  it('does not let an unrated control look cheap', () => {
    // Microsoft leaves implementationCost null on some controls. Treating unknown as low
    // would float them to the top of a plan on no evidence.
    expect(effortWeight('Low', 'Low')).toBeLessThan(effortWeight(null, null));
    expect(effortWeight(null, null)).toBeLessThan(effortWeight('High', 'High'));
    expect(effortWeight(null, null)).toBe(effortWeight('Moderate', 'Moderate'));
  });

  it('carries the guidance and the link needed to act on a step', () => {
    const withGuidance = model.roadmap.filter((s) => s.remediation);
    expect(withGuidance.length).toBeGreaterThan(0);
    expect(withGuidance[0]!.actionUrl).toBeTruthy();
  });
});

describe('threat names as Graph actually returns them', () => {
  it('matches the documented spelling to the shipped one', () => {
    // Graph documents accountBreach and returns "Account breach". Matching on the
    // documented spelling found none of the nine values a production tenant returned,
    // and the failure was silent: every control would have fallen back to the default
    // likelihood and impact while the page looked entirely healthy.
    expect(threatKey('Account breach')).toBe(threatKey('accountBreach'));
    expect(threatKey('Elevation of Privilege')).toBe(threatKey('elevationOfPrivilege'));
    expect(threatKey('Data Exfiltration')).toBe(threatKey('dataExfiltration'));
    expect(threatKey('Password Cracking')).toBe(threatKey('passwordCracking'));
  });

  it('treats Microsoft own inconsistent casing as one threat', () => {
    // A single production response carried both spellings of the same threat, 108 times
    // and 14 times. Two buckets would have split one threat's exposure in half.
    expect(threatKey('Account breach')).toBe(threatKey('Account Breach'));
    expect(threatKey('Password cracking')).toBe(threatKey('Password Cracking'));
  });

  it('resolves every threat a real tenant returned to a modelled assumption', () => {
    // The nine distinct values observed across two live tenants.
    const observed = [
      'Account Breach',
      'Account breach',
      'Data Deletion',
      'Data Exfiltration',
      'Data Spillage',
      'Elevation of Privilege',
      'Malicious Insider',
      'Password Cracking',
      'Password cracking',
    ];
    const modelled = new Set(riskModel.threats.map((t) => threatKey(t.threat)));
    for (const raw of observed) {
      expect(modelled.has(threatKey(raw)), `${raw} has no assumption`).toBe(true);
    }
  });
});

describe('impact is sized to the tenant', () => {
  const model = run(premiumSnapshot);
  const user = (enabled: boolean, skus: string[]): TenantUser => ({
    Id: crypto.randomUUID(),
    DisplayName: null,
    UserPrincipalName: null,
    AccountEnabled: enabled,
    UserType: 'Member',
    CreatedDateTime: null,
    Department: null,
    AssignedSkuIds: skus,
    LastSignIn: null,
    LastNonInteractiveSignIn: null,
  });
  const seats = (consumedUnits: number, flags: Partial<InventoryRow> = {}) =>
    ({ consumedUnits, isFreeSku: false, excluded: false, ...flags }) as InventoryRow;

  it('scales every shipped impact by one factor, and keeps the shipped figure beside it', () => {
    // The sample's user list is 11 accounts against 288 assigned E3 seats, so the seats win.
    expect(model.risk.scale).toEqual({
      headcount: 288,
      basis: 'assignedSeats',
      referenceHeadcount: 500,
      exponent: 0.5,
      factor: Math.sqrt(288 / 500),
    });
    for (const t of model.risk.threats) {
      const shipped = riskModel.threats.find((a) => threatKey(a.threat) === t.threat)?.impactUsd;
      expect(t.baseImpactUsd).toBe(shipped ?? riskModel.defaults.impactUsd);
      expect(t.impactUsd).toBeCloseTo(t.baseImpactUsd * model.risk.scale.factor, 6);
      expect(t.expectedLoss).toBeCloseTo(t.annualLikelihood * t.impactUsd, 6);
    }
  });

  it('grows more slowly than headcount', () => {
    // 10 times the people is about 3 times the impact, not 10.
    const at = (count: number) => riskScale(riskModel, { count, basis: 'licensedAccounts' }).factor;
    expect(at(500)).toBe(1);
    expect(at(50)).toBeCloseTo(0.3162, 4);
    expect(at(5000)).toBeCloseTo(3.1623, 4);
  });

  it('counts enabled accounts holding a licence', () => {
    const users = [user(true, ['a']), user(true, ['a', 'b']), user(false, ['a']), user(true, [])];
    expect(estimateHeadcount(users, [seats(2)])).toEqual({ count: 2, basis: 'licensedAccounts' });
  });

  it('never counts fewer people than one paid licence has seats assigned', () => {
    expect(estimateHeadcount([user(true, ['a'])], [seats(40), seats(12)])).toEqual({
      count: 40,
      basis: 'assignedSeats',
    });
    expect(estimateHeadcount(null, [seats(40)])).toEqual({ count: 40, basis: 'assignedSeats' });
  });

  it('does not let a free or excluded licence set the floor', () => {
    // Free Power BI and Power Automate seats go to anyone who clicks a trial, guests included.
    const inventory = [seats(3), seats(900, { isFreeSku: true }), seats(700, { excluded: true })];
    expect(estimateHeadcount(null, inventory)).toEqual({ count: 3, basis: 'assignedSeats' });
  });

  it('leaves impacts as shipped, and says so, when it cannot tell the size', () => {
    expect(estimateHeadcount(null, [])).toBeNull();
    const unsized = riskScale(riskModel, null);
    expect(unsized.factor).toBe(1);
    expect(describeScale(unsized)).toBe(
      'No headcount could be established, so impacts stand as the risk model states them, for an organisation of 500 people.',
    );
  });

  it('applies a risk model written before sizing existed as it always did', () => {
    const { sizeScaling: _, ...older } = riskModel;
    expect(riskScale(older, { count: 5000, basis: 'licensedAccounts' }).factor).toBe(1);
  });

  it('says how the figures were sized, in words', () => {
    expect(describeScale(model.risk.scale)).toBe(
      "Impact is sized to 288 people, the most seats assigned on any one paid licence, which is a floor on headcount. The risk model's impacts describe an organisation of 500, so each is multiplied by 0.76.",
    );
    expect(describeScale(riskScale(riskModel, { count: 2000, basis: 'licensedAccounts' }))).toBe(
      "Impact is sized to 2,000 people, the enabled accounts holding a licence. The risk model's impacts describe an organisation of 500, so each is multiplied by 2.00.",
    );
  });
});
