/**
 * Snapshot delta: the same tenant in June and September.
 *
 * premium-baseline-snapshot.json is generated from premium-snapshot.json by
 * tests/fixtures/make-premium-baseline.mjs, which lists every deliberate difference. The
 * expectations below are worked out by hand from those differences and the shipped prices,
 * not read back from the code, so a comparison that drifts fails here.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import baselineSnapshot from '@fixtures/premium-baseline-snapshot.json';

import { compareSnapshots, type ComparisonResult, type RunComparison } from './compare';
import { analyze, clearOverrides, setOverride, type Overrides } from './index';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const snap = (raw: unknown): Snapshot => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};

const compare = (baseline: unknown, current: unknown, overrides?: Overrides): ComparisonResult =>
  compareSnapshots({
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
    overrides,
    baseline: snap(baseline),
    current: snap(current),
  });

const ok = (result: ComparisonResult): RunComparison => {
  if (!result.ok) throw new Error(result.reason);
  return result.comparison;
};

/** A copy of a snapshot collected some days earlier, with every date moved with it. */
const earlier = (raw: unknown, days: number, edit?: (s: any) => void): unknown => {
  const s = structuredClone(raw) as any;
  const back = (iso: string | null) => (iso ? new Date(Date.parse(iso) - days * 86_400_000).toISOString() : iso);
  s.GeneratedAt = back(s.GeneratedAt);
  for (const c of Object.values(s.Collectors) as any[]) c.CollectedAt = back(c.CollectedAt);
  for (const u of s.Collectors.users.Data) {
    u.LastSignIn = back(u.LastSignIn);
    u.LastNonInteractiveSignIn = back(u.LastNonInteractiveSignIn);
  }
  edit?.(s);
  return s;
};

const delta = ok(compare(baselineSnapshot, premiumSnapshot));

describe('June against September, with the shipped prices', () => {
  it('knows the 2 runs are 92 days apart', () => {
    expect(delta.daysBetween).toBe(92);
    expect(delta.tenantName).toBe('Contoso Ltd');
  });

  it('prices both runs the same way, so spend moves only where the tenant changed', () => {
    // Annual price per seat: E5 720, E3 468, Entra P1 84, MDO P1 24, Business Standard
    // 168, EMS E3 144. June: E5 100 bought, 80 assigned; E3 300 and 270; EMS 40 and 40.
    //   commitment  72,000 + 140,400 + 4,200 + 2,400 + 4,200 + 5,760 = 228,960
    //   in use      57,600 + 126,360 + 1,008 +     0 + 4,200 + 5,760 = 194,928
    // September is the sample tenant: 237,600 committed, 209,112 in use.
    expect(delta.headline.annualCommitment).toEqual({ before: 228960, after: 237600, change: 8640 });
    expect(delta.headline.annualSpendConsumed).toEqual({ before: 194928, after: 209112, change: 14184 });
    expect(delta.headline.idleSeatCost).toEqual({ before: 34032, after: 28488, change: -5544 });
  });

  it('counts seats across every billable SKU', () => {
    // June adds EMS 40/40 and has E5 at 100/80 and E3 at 300/270, beside the same
    // Entra P1 50/12, MDO P1 100/0, Business Standard 25/25 and unpriced add-on 40/40.
    expect(delta.headline.seatsPurchased).toEqual({ before: 655, after: 635, change: -20 });
    expect(delta.headline.seatsAssigned).toEqual({ before: 467, after: 461, change: -6 });
    expect(delta.headline.seatsUnassigned).toEqual({ before: 188, after: 174, change: -14 });
  });

  it('tells the headline story: spend realized rose', () => {
    // Seat share x posture share. June 194,928/228,960 x 169/476 = 0.8514 x 0.3550 = 0.3023.
    // September 209,112/237,600 x 213.5/488 = 0.8801 x 0.4375 = 0.3850.
    expect(delta.headline.securePoints).toEqual({ before: 169, after: 213.5, change: 44.5 });
    expect(delta.headline.secureMax).toEqual({ before: 476, after: 488, change: 12 });
    expect(delta.headline.featureRealization.before).toBeCloseTo(169 / 476, 6);
    expect(delta.headline.featureRealization.after).toBeCloseTo(213.5 / 488, 6);
    expect(delta.headline.spendRealized.before).toBeCloseTo((194928 / 228960) * (169 / 476), 6);
    expect(delta.headline.spendRealized.after).toBeCloseTo((209112 / 237600) * (213.5 / 488), 6);
  });

  it('finds every control that moved, and how', () => {
    expect(delta.controlCounts).toEqual({
      regressed: 2,
      closed: 2,
      improved: 2,
      appeared: 1,
      retired: 1,
      unchanged: 14,
    });
    // Regressions first, because they are what a reader most needs to see, then the
    // biggest swing first within each group.
    expect(delta.controls.map((c) => `${c.movement} ${c.controlName} ${c.score.before}->${c.score.after}`)).toEqual([
      'regressed AntiPhishPolicy 40->32',
      'regressed SpamPolicyBlockList 20->15',
      'closed MailboxAuditing 0->20',
      'closed MFARegistrationV2 12->30',
      'improved DefenderForEndpointOnboarding 25->40',
      'improved AdminMFAV2 0->4.5',
      'appeared DLPPolicy null->10',
      'retired AuditLogSearch 10->null',
    ]);
  });

  it('records the state each control moved between', () => {
    const closed = delta.controls.find((c) => c.controlName === 'MFARegistrationV2')!;
    expect([closed.stateBefore, closed.stateAfter]).toEqual(['partial', 'deployed']);
    const regressed = delta.controls.find((c) => c.controlName === 'AntiPhishPolicy')!;
    expect([regressed.stateBefore, regressed.stateAfter]).toEqual(['deployed', 'partial']);
    const appeared = delta.controls.find((c) => c.controlName === 'DLPPolicy')!;
    expect([appeared.stateBefore, appeared.score.change]).toEqual([null, null]);
  });

  it('lists licences dropped and changed, not the ones that stayed put', () => {
    expect(
      delta.licences.map(
        (l) => `${l.movement} ${l.skuPartNumber} ${l.purchased.before}/${l.assigned.before}->${l.purchased.after}/${l.assigned.after} ${l.annualCommitment.change}`,
      ),
    ).toEqual([
      'removed EMS 40/40->0/0 -5760',
      'changed SPE_E5 100/80->120/96 14400',
      'changed SPE_E3 300/270->300/288 0',
    ]);
  });

  it('compares waste category by category', () => {
    const w = new Map(delta.waste.map((c) => [c.id, c]));
    expect(w.get('unassigned')!.seats).toEqual({ before: 188, after: 174, change: -14 });
    expect(w.get('unassigned')!.annualCost).toEqual({ before: 34032, after: 28488, change: -5544 });
    // Dorothy Vaughan's E5 was cleaned up: 720 + 720 + 468 in June, 720 + 468 now.
    expect(w.get('disabled')!.seats).toEqual({ before: 3, after: 2, change: -1 });
    expect(w.get('disabled')!.annualCost).toEqual({ before: 1908, after: 1188, change: -720 });
    // The same people, judged against their own collection dates.
    expect(w.get('neverSignedIn')!.seats!.change).toBe(0);
    expect(w.get('inactive')!.seats!.change).toBe(0);
  });

  it('compares the waste total over the same categories, and it agrees with them', () => {
    const sum = delta.waste.reduce((s, c) => s + (c.annualCost.change ?? 0), 0);
    expect(delta.headline.wasteTotal.change).toBe(sum);
    expect(delta.headline.wasteTotal.change).toBe(-5544 - 720);
  });

  it('says a category measured in neither run was measured in neither', () => {
    const strip = (raw: unknown) => {
      const s = structuredClone(raw) as any;
      delete s.Collectors.appUsage;
      return s;
    };
    const over = ok(compare(strip(baselineSnapshot), strip(premiumSnapshot))).waste.find(
      (c) => c.id === 'overProvisioned',
    )!;
    expect(over.comparable).toBe(false);
    expect(over.reason).toMatch(/^Not measured in either run\./);
    expect(over.seats).toEqual({ before: null, after: null, change: null });
  });

  it('has nothing it could not compare', () => {
    expect(delta.notComparable).toEqual([]);
  });
});

describe('a comparison invents nothing', () => {
  it('finds no change between 2 runs that differ only in date', () => {
    const same = ok(compare(earlier(premiumSnapshot, 30), premiumSnapshot));
    expect(same.daysBetween).toBe(30);
    expect(same.controls).toEqual([]);
    expect(same.controlCounts.unchanged).toBe(21);
    expect(same.licences).toEqual([]);
    for (const [name, c] of Object.entries(same.headline)) {
      expect(c.change, name).toBe(0);
    }
  });

  it('does not mistake Microsoft re-weighting a control for the tenant changing it', () => {
    // Anti-phishing is 32 of 40 in September. Make it 16 of 20 in the earlier run: the
    // same 80%, on a smaller scale. By points that reads as 16 gained; it is nothing.
    const reweighted = earlier(premiumSnapshot, 30, (s) => {
      const data = s.Collectors.secureScore.Data;
      data.ControlProfiles.find((p: any) => p.ControlName === 'AntiPhishPolicy').MaxScore = 20;
      data.ControlScores.find((c: any) => c.ControlName === 'AntiPhishPolicy').Score = 16;
    });
    const d = ok(compare(reweighted, premiumSnapshot));
    expect(d.controls.find((c) => c.controlName === 'AntiPhishPolicy')).toBeUndefined();
    expect(d.controlCounts.unchanged).toBe(21);
  });

  it('applies one set of prices to both runs, including the ones the consultant entered', () => {
    // E5 at 44 rather than 60, in both runs. The 20 extra E5 seats then add
    // 20 x 44 x 12 = 10,560 rather than 14,400; EMS still subtracts 5,760.
    const repriced = ok(compare(baselineSnapshot, premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 44)));
    expect(repriced.headline.annualCommitment.change).toBe(10560 - 5760);
  });
});

describe('what cannot be compared says so, and is never zero', () => {
  it('refuses 2 different tenants', () => {
    const other = earlier(premiumSnapshot, 30, (s) => {
      s.Context.TenantId = 'aaaaaaaa-0000-4000-8000-000000000000';
      s.Collectors.organization.Data.TenantId = 'aaaaaaaa-0000-4000-8000-000000000000';
      s.Collectors.organization.Data.DisplayName = 'Fabrikam';
    });
    const result = compare(other, premiumSnapshot);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/different tenant \(Fabrikam\)/);
  });

  it('refuses an earlier run that is not earlier', () => {
    const result = compare(premiumSnapshot, baselineSnapshot);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/Open the later run, then compare it with this one/);
  });

  it('refuses the same run twice', () => {
    const result = compare(premiumSnapshot, premiumSnapshot);
    expect(!result.ok && result.reason).toMatch(/same run/);
  });

  it('does not compare controls when the earlier run has no Secure Score', () => {
    const noScore = earlier(premiumSnapshot, 30, (s) => {
      s.Collectors.secureScore.Available = false;
      s.Collectors.secureScore.Data = null;
      s.Collectors.secureScore.Reason = 'SecurityEvents.Read.All was not granted.';
    });
    const d = ok(compare(noScore, premiumSnapshot));
    expect(d.controls).toEqual([]);
    expect(d.headline.featureRealization.change).toBeNull();
    expect(d.headline.securePoints).toEqual({ before: null, after: 213.5, change: null });
    expect(d.notComparable.join(' ')).toMatch(/Secure Score was not collected in the earlier run/);
  });

  it('does not compare sign-in categories, or the total, when the earlier run lacked sign-in data', () => {
    // Users collected without sign-in activity: the Entra ID P1 case.
    const noSignIns = earlier(premiumSnapshot, 30, (s) => {
      s.Collectors.users.Degraded = true;
    });
    const d = ok(compare(noSignIns, premiumSnapshot));
    const w = new Map(d.waste.map((c) => [c.id, c]));
    expect(w.get('inactive')!.comparable).toBe(false);
    expect(w.get('inactive')!.annualCost.change).toBeNull();
    expect(w.get('inactive')!.reason).toMatch(/^Not measured in the earlier run\./);
    expect(w.get('disabled')!.comparable).toBe(true);
    expect(d.headline.wasteTotal.change).toBeNull();
    expect(d.notComparable.join(' ')).toMatch(/measured different waste categories/);
  });
});

describe('retained risk is compared at one headcount', () => {
  it('does not count hiring as the controls getting worse', () => {
    // Same controls, 100 more E3 seats assigned since: a bigger tenant, an unchanged posture.
    const grown = structuredClone(premiumSnapshot) as any;
    grown.Collectors.subscribedSkus.Data.find((k: any) => k.SkuPartNumber === 'SPE_E3').ConsumedUnits = 388;
    const c = ok(compare(earlier(premiumSnapshot, 30), grown));
    expect(c.headline.riskRetained.before).toBeCloseTo(c.headline.riskRetained.after!, 4);
    expect(c.headline.riskRetained.change).toBeCloseTo(0, 4);
  });

  it('figures the earlier run at today’s headcount', () => {
    // June had 270 E3 seats assigned and September 288, so June is figured at 288.
    const june = analyze({
      snapshot: snap(baselineSnapshot),
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      riskModel,
    });
    expect(june.risk.scale.headcount).toBe(270);
    expect(delta.headline.riskRetained.before).toBeCloseTo(june.risk.retainedAnnual * Math.sqrt(288 / 270), 4);
  });
});
