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
import { effortWeight } from './risk';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
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
