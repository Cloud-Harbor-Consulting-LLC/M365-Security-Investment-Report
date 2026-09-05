/**
 * Seat-level waste.
 *
 * The rule under test throughout: a category that cannot be measured reports as not
 * measured, never as zero. Zero reads as "we looked and found no waste", which on a
 * tenant without Entra ID P1 is the opposite of the truth.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze, clearOverrides, setOverride } from './index';
import { catalog, cloneConfig, featureMap, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const run = (raw: unknown, tweak?: (c: ReturnType<typeof cloneConfig>) => void) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const config = cloneConfig();
  config.exemptions.displayNamePatterns = ['*Service Account*'];
  tweak?.(config);
  return analyze({ snapshot: parsed.snapshot, config, catalog, priceList: listPriceList, featureMap });
};

const category = (model: ReturnType<typeof run>, id: string) =>
  model.seatWaste.categories.find((c) => c.id === id)!;

describe('categories measurable from account state alone', () => {
  const model = run(premiumSnapshot);

  it('finds disabled accounts that still hold a licence', () => {
    const disabled = category(model, 'disabled');
    expect(disabled.available).toBe(true);
    expect(disabled.seats).toBe(2);
    // Grace on E5 ($684/yr) and Katherine on E3 ($432/yr).
    expect(disabled.annualCost).toBe(684 + 432);
    expect(disabled.accounts.map((a) => a.userPrincipalName).sort()).toEqual([
      'grace@contoso.com',
      'katherine@contoso.com',
    ]);
  });

  it('ignores a disabled account holding no licence', () => {
    // A disabled account costs nothing if it carries no seat, so it is not waste.
    const disabled = category(model, 'disabled');
    expect(disabled.accounts.map((a) => a.userPrincipalName)).not.toContain('former@contoso.com');
  });
});

describe('categories that depend on sign-in activity', () => {
  const model = run(premiumSnapshot);

  it('finds accounts that have never signed in', () => {
    const never = category(model, 'neverSignedIn');
    // Three, not one: the licensed service account and the licensed guest are counted
    // now that an exemption can no longer remove a paid seat from the analysis.
    expect(never.seats).toBe(3);
    expect(never.accounts.map((a) => a.userPrincipalName).sort()).toEqual([
      'auditor@partner.com',
      'jean@contoso.com',
      'svc-backup@contoso.com',
    ]);
  });

  it('finds accounts inactive beyond the threshold', () => {
    const inactive = category(model, 'inactive');
    expect(inactive.accounts.map((a) => a.userPrincipalName).sort()).toEqual([
      'barbara@contoso.com',
      'frances@contoso.com',
    ]);
  });

  it('counts a non-interactive sign-in as activity', () => {
    // Radia last signed in interactively 200 days ago but the account is plainly in use.
    // Treating it as idle would put a real user on a decommissioning list.
    const inactive = category(model, 'inactive');
    expect(inactive.accounts.map((a) => a.userPrincipalName)).not.toContain('radia@contoso.com');
  });

  it('honours the configured threshold', () => {
    const strict = run(premiumSnapshot, (c) => {
      c.inactivity.thresholdDays = 5;
    });
    expect(category(strict, 'inactive').seats).toBeGreaterThan(category(run(premiumSnapshot), 'inactive').seats!);
  });
});

describe('exemptions never hide a licensed account', () => {
  const model = run(premiumSnapshot);

  // An exemption that can drop a licensed account turns the tool's central claim inside
  // out: it would under-state waste in exactly the tenants that most need it found, and
  // do so silently. A service account or a guest holding a paid licence is not noise to
  // be filtered out — it is the finding.
  it('keeps a service account that matches an exemption pattern but holds a licence', () => {
    const never = category(model, 'neverSignedIn');
    expect(never.accounts.map((a) => a.userPrincipalName)).toContain('svc-backup@contoso.com');
  });

  it('keeps a guest that holds a licence, whatever the user-type rule says', () => {
    const never = category(model, 'neverSignedIn');
    expect(never.accounts.map((a) => a.userPrincipalName)).toContain('auditor@partner.com');
  });

  it('reports no account as exempted, because none could be', () => {
    // Unlicensed accounts hold no seats and were never in scope, so an exemption can no
    // longer remove anything. A non-zero count here means the rule has been loosened.
    expect(model.seatWaste.exemptedAccounts).toBe(0);
  });
});

describe('a tenant without Entra ID P1', () => {
  const model = run(unpricedSnapshot);

  it('still measures disabled-but-licensed, which needs no premium licence', () => {
    const disabled = category(model, 'disabled');
    expect(disabled.available).toBe(true);
    expect(disabled.seats).toBe(1);
  });

  it('reports the sign-in categories as not measured rather than zero', () => {
    for (const id of ['neverSignedIn', 'inactive']) {
      const c = category(model, id);
      expect(c.available).toBe(false);
      expect(c.seats).toBeNull();
      expect(c.annualCost).toBeNull();
      expect(c.unavailableReason).toMatch(/Entra ID P1/);
    }
  });

  it('marks the total as a floor', () => {
    expect(model.seatWaste.incomplete).toBe(true);
  });

  it('leaves cost null where the seats are real but unpriced', () => {
    // The account is genuinely disabled and licensed; its licence simply has no price.
    expect(category(model, 'disabled').annualCost).toBeNull();
  });
});

describe('over-provisioning', () => {
  it('is always reported as not collected, since seat counts cannot establish it', () => {
    const over = category(run(premiumSnapshot), 'overProvisioned');
    expect(over.available).toBe(false);
    expect(over.unavailableReason).toMatch(/service-plan usage/);
  });
});

describe('a snapshot collected before user data existed', () => {
  it('degrades the waste analysis instead of failing the report', () => {
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const withoutUsers: Snapshot = {
      ...parsed.snapshot,
      Collectors: { ...parsed.snapshot.Collectors, users: undefined },
    };

    const model = analyze({
      snapshot: withoutUsers,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });

    expect(model.spend.annualCommitment).toBe(221430);
    expect(model.seatWaste.categories.find((c) => c.id === 'disabled')?.available).toBe(false);
    // Category 1 comes from SKU counts, so it survives.
    expect(model.seatWaste.categories.find((c) => c.id === 'unassigned')?.annualCost).toBe(26736);
  });
});

describe('a cost is never presented on a basis it does not have', () => {
  const withOverrides = (partNumbers: Record<string, number>) => {
    const parsed = parseSnapshot(unpricedSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    let overrides = clearOverrides();
    for (const [part, price] of Object.entries(partNumbers)) {
      overrides = setOverride(overrides, part, price);
    }
    return analyze({
      snapshot: parsed.snapshot,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      overrides,
    });
  };

  it('does not report idle seats as costing zero when their SKU has no price', () => {
    // The regression: 25 unassigned seats all belong to an unpriced SKU, while a
    // different SKU carries a price. Summing only priced rows gave $0, which reads as
    // "these 25 idle seats cost nothing".
    const model = withOverrides({ PREVIEW_SKU_NOT_IN_CATALOG: 20 });
    const unassigned = model.seatWaste.categories.find((c) => c.id === 'unassigned')!;

    expect(unassigned.seats).toBe(25);
    expect(unassigned.annualCost).toBeNull();
    expect(model.seatWaste.totalAnnualCost).not.toBe(0);
  });

  it('marks a partly-priced figure as a floor rather than an answer', () => {
    const model = withOverrides({ ANOTHER_PREVIEW_ADDON: 20 });
    const unassigned = model.seatWaste.categories.find((c) => c.id === 'unassigned')!;
    expect(unassigned.annualCost).toBe(25 * 240);
    expect(unassigned.costIsFloor).toBe(false); // every unassigned seat is priced here
  });

  it('reports zero, not "not available", where a category genuinely has no accounts', () => {
    // We looked and found none. That is a measurement, and $0 is its result — the
    // opposite error from reporting an unknown cost as zero.
    const model = withOverrides({ PREVIEW_SKU_NOT_IN_CATALOG: 20, ANOTHER_PREVIEW_ADDON: 20 });
    const never = model.seatWaste.categories.find((c) => c.id === 'neverSignedIn')!;
    expect(never.available).toBe(false); // no Entra ID P1 in this fixture

    const premium = analyze({
      snapshot: (() => {
        const p = parseSnapshot(premiumSnapshot);
        if (!p.ok) throw new Error(p.reason);
        // Everyone signed in this morning, so the category is genuinely empty rather
        // than emptied by configuration — which is no longer possible for licensed
        // accounts, and is the point of the exemption rule.
        const s = structuredClone(p.snapshot);
        for (const u of s.Collectors.users!.Data!) u.LastSignIn = new Date().toISOString();
        return s;
      })(),
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
    });
    const emptyCategory = premium.seatWaste.categories.find((c) => c.id === 'neverSignedIn')!;
    expect(emptyCategory.seats).toBe(0);
    expect(emptyCategory.annualCost).toBe(0);
  });
});
