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

import { analyze } from './index';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const run = (raw: unknown, tweak?: (c: ReturnType<typeof cloneConfig>) => void) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const config = cloneConfig();
  config.exemptions.displayNamePatterns = ['*Service Account*'];
  tweak?.(config);
  return analyze({ snapshot: parsed.snapshot, config, catalog, priceList: listPriceList });
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
    expect(never.seats).toBe(1);
    expect(never.accounts[0]?.userPrincipalName).toBe('jean@contoso.com');
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

describe('exemptions', () => {
  const model = run(premiumSnapshot);

  it('excludes service accounts matched by display-name pattern', () => {
    const never = category(model, 'neverSignedIn');
    expect(never.accounts.map((a) => a.userPrincipalName)).not.toContain('svc-backup@contoso.com');
  });

  it('excludes guests by user type', () => {
    const never = category(model, 'neverSignedIn');
    expect(never.accounts.map((a) => a.userPrincipalName)).not.toContain('auditor@partner.com');
  });

  it('reports how many accounts were exempted, so the exclusion is visible', () => {
    expect(model.seatWaste.exemptedAccounts).toBe(2);
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
    });

    expect(model.spend.annualCommitment).toBe(221430);
    expect(model.seatWaste.categories.find((c) => c.id === 'disabled')?.available).toBe(false);
    // Category 1 comes from SKU counts, so it survives.
    expect(model.seatWaste.categories.find((c) => c.id === 'unassigned')?.annualCost).toBe(26736);
  });
});
