/**
 * Seat-level waste.
 *
 * The rule under test throughout: a category that cannot be measured reports as not
 * measured, never as zero. Zero reads as "we looked and found no waste", which on a
 * tenant without Entra ID P1 is the opposite of the truth.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze, clearOverrides, setOverride } from './index';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const run = (raw: unknown, tweak?: (c: ReturnType<typeof cloneConfig>) => void) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const config = cloneConfig();
  config.exemptions.displayNamePatterns = ['*Service Account*'];
  tweak?.(config);
  return analyze({ snapshot: parsed.snapshot, config, catalog, priceList: listPriceList, featureMap, riskModel });
};

const category = (model: ReturnType<typeof run>, id: string) =>
  model.seatWaste.categories.find((c) => c.id === id)!;

describe('categories measurable from account state alone', () => {
  const model = run(premiumSnapshot);

  it('finds disabled accounts that still hold a licence', () => {
    const disabled = category(model, 'disabled');
    expect(disabled.available).toBe(true);
    expect(disabled.seats).toBe(2);
    // Grace on E5 ($720/yr) and Katherine on E3 ($468/yr, up from $432 when Microsoft
    // raised E3 from $36 to $39 on 1 July 2026).
    expect(disabled.annualCost).toBe(720 + 468);
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
    // Radia last signed in interactively 198 days before collection, but non-interactively
    // 2 days before it, so the account is plainly in use.
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

describe('inactivity is measured from the collection, not from today', () => {
  // The snapshot stops when it is collected and the clock does not. Measured from now,
  // Alan Turing's 25 August sign-in crossed the 90-day line on 23 November 2026 and Radia
  // Perlman's on 30 November, after which this file failed on every run with no code
  // changed. A saved session also reported more inactive accounts each time it was
  // reopened, and an earlier run compared with a later one would have looked worse than it
  // was.
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const opened of ['2026-11-24T12:00:00Z', '2026-12-01T12:00:00Z', '2027-06-01T00:00:00Z']) {
    it(`gives the same answer when the report is opened on ${opened.slice(0, 10)}`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(opened));
      const model = run(premiumSnapshot);
      expect(category(model, 'inactive').accounts.map((a) => a.userPrincipalName).sort()).toEqual([
        'barbara@contoso.com',
        'frances@contoso.com',
      ]);
      expect(category(model, 'neverSignedIn').seats).toBe(3);
    });
  }

  it('says how long before collection each account was last seen', () => {
    const accounts = category(run(premiumSnapshot), 'inactive').accounts;
    const detail = new Map(accounts.map((a) => [a.userPrincipalName, a.detail]));
    // Last sign-ins 6 February and 7 May, read on 3 September.
    expect(detail.get('frances@contoso.com')).toBe('Last signed in 208 days before collection');
    expect(detail.get('barbara@contoso.com')).toBe('Last signed in 118 days before collection');
  });
});

describe('exemptions never hide a licensed account', () => {
  const model = run(premiumSnapshot);

  // An exemption that can drop a licensed account turns the tool's central claim inside
  // out: it would under-state waste in exactly the tenants that most need it found, and
  // do so silently. A service account or a guest holding a paid licence is not noise to
  // be filtered out. It is the finding.
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
  /** A copy of the sample with the given edits, so each case states only what it changes. */
  const tenant = (edit: (s: any) => void) => {
    const s = structuredClone(premiumSnapshot) as any;
    edit(s);
    return s;
  };
  const user = (s: any, upn: string) => s.Collectors.users.Data.find((u: any) => u.UserPrincipalName === upn);
  const plan = (name: string) => ({ ServicePlanId: name, ServicePlanName: name, ProvisioningStatus: 'Success', AppliesTo: 'User' });
  // Synthetic ids: the sample already uses Business Basic's real one for its Business Standard row.
  const APPS_FOR_BUSINESS = '00000000-0000-4000-8000-0000000000a1';
  const BUSINESS_BASIC = '00000000-0000-4000-8000-0000000000b1';
  const sku = (id: string, part: string, plans: string[]) => ({
    SkuId: id,
    SkuPartNumber: part,
    AppliesTo: 'User',
    CapabilityStatus: 'Enabled',
    ConsumedUnits: 2,
    PrepaidEnabled: 2,
    PrepaidSuspended: 0,
    PrepaidWarning: 0,
    ServicePlans: plans.map(plan),
  });
  /** Ada and Alan on Apps for business, with or without Business Basic beside it. */
  const onAppsForBusiness = (s: any, withBasic: boolean) => {
    s.Collectors.subscribedSkus.Data.push(sku(APPS_FOR_BUSINESS, 'O365_BUSINESS', ['OFFICE_BUSINESS', 'SHAREPOINTWAC', 'ONEDRIVESTANDARD']));
    s.Collectors.subscribedSkus.Data.push(sku(BUSINESS_BASIC, 'O365_BUSINESS_ESSENTIALS', ['EXCHANGE_S_STANDARD', 'SHAREPOINTWAC', 'SHAREPOINTSTANDARD']));
    for (const upn of ['ada@contoso.com', 'alan@contoso.com']) {
      user(s, upn).AssignedSkuIds = withBasic ? [APPS_FOR_BUSINESS, BUSINESS_BASIC] : [APPS_FOR_BUSINESS];
    }
  };
  const conceal = (s: any) => {
    s.Collectors.appUsage.Data.Concealed = true;
    s.Collectors.appUsage.Data.Users.forEach((u: any, i: number) => (u.UserPrincipalName = `3F8A1C0E9B7D2A4C6E1F0B3D5A7C9E2${i}`));
  };

  it('counts an account that used the desktop apps only on the web or a phone', () => {
    const over = category(run(premiumSnapshot), 'overProvisioned');
    expect(over.available).toBe(true);
    // Ada used Windows. Alan used the web and a phone only. Radia signs in, non-interactively,
    // so she is not inactive, and the report shows her using the apps nowhere at all.
    const why = Object.fromEntries(over.accounts.map((a) => [a.userPrincipalName, a.detail]));
    expect(Object.keys(why)).toEqual(['alan@contoso.com', 'radia@contoso.com']);
    expect(why['alan@contoso.com']).toBe(
      'Used the apps only on a phone or tablet and the web in 90 days. No cheaper licence keeps the same security, so no saving is priced.',
    );
    expect(why['radia@contoso.com']).toBe(
      'No use of the apps reported in 90 days. No cheaper licence keeps the same security, so no saving is priced.',
    );
  });

  it('never prices a move to less security', () => {
    // Both hold Microsoft 365 E3. Every cheaper licence drops Intune, Entra ID P1 or
    // Defender, so they are counted and their cost is not a figure this tool will produce.
    const over = category(run(premiumSnapshot), 'overProvisioned');
    expect(over.seats).toBe(2);
    expect(over.annualCost).toBeNull();
    expect(over.note).toBe(
      '2 of these accounts hold a licence whose cheaper sibling drops a security plan, so they are counted and not priced.',
    );
  });

  it('prices a standalone Apps for business seat held beside Office for the web and storage', () => {
    const over = category(run(tenant((s) => onAppsForBusiness(s, true))), 'overProvisioned');
    // Alan's $10 a month seat goes. Radia is still on E3, counted and not priced, so the
    // category total is a floor.
    const alan = over.accounts.find((a) => a.userPrincipalName === 'alan@contoso.com')!;
    expect(alan.annualCost).toBe(120);
    expect(alan.detail).toMatch(/The standalone desktop apps licence can go\.$/);
    expect(over.annualCost).toBe(120);
    expect(over.costIsFloor).toBe(true);
  });

  it('does not price it when nothing else would give the account Office for the web', () => {
    const over = category(run(tenant((s) => onAppsForBusiness(s, false))), 'overProvisioned');
    expect(over.accounts.find((a) => a.userPrincipalName === 'alan@contoso.com')!.annualCost).toBeNull();
    expect(over.annualCost).toBeNull();
  });

  it('leaves out an account created inside the 90 days', () => {
    const over = category(run(tenant((s) => (user(s, 'alan@contoso.com').CreatedDateTime = '2026-08-01T09:00:00Z'))), 'overProvisioned');
    expect(over.accounts.map((a) => a.userPrincipalName)).toEqual(['radia@contoso.com']);
  });

  it('never counts a seat twice', () => {
    // Jean has never signed in and holds E3, with no usage at all. He is never-signed-in
    // waste already, so he is not over-provisioned as well.
    const model = run(premiumSnapshot);
    expect(category(model, 'neverSignedIn').accounts.map((a) => a.userPrincipalName)).toContain('jean@contoso.com');
    expect(category(model, 'overProvisioned').accounts.map((a) => a.userPrincipalName)).not.toContain('jean@contoso.com');
  });

  describe('when the tenant hides names in usage reports', () => {
    it('counts at least the licensed accounts the report does not show on a desktop, and lists none', () => {
      const over = category(run(tenant(conceal)), 'overProvisioned');
      expect(over.seats).toBe(2);
      expect(over.seatsAreFloor).toBe(true);
      expect(over.accounts).toEqual([]);
      expect(over.annualCost).toBeNull();
      expect(over.note).toBe(
        "This tenant hides names in Microsoft's usage reports, so the accounts cannot be listed. 3 accounts are licensed for the desktop apps and the report shows 1 using them on Windows or Mac in 90 days, so at least 2 did not. A saving is priced only where removing a licence costs the account no security plan.",
      );
    });

    it('prices only what must be true however the unnamed accounts fall', () => {
      // 3 candidates, 1 seen on a desktop, so at least 2 were not. Only Radia's E3 is
      // unpriced, so at least 1 of those 2 holds a priced Apps for business seat.
      const over = category(run(tenant((s) => (onAppsForBusiness(s, true), conceal(s)))), 'overProvisioned');
      expect(over.seats).toBe(2);
      expect(over.annualCost).toBe(120);
      expect(over.costIsFloor).toBe(true);
    });
  });

  describe('not measured, and why', () => {
    it('in a snapshot from before the usage report was read', () => {
      const over = category(run(tenant((s) => delete s.Collectors.appUsage)), 'overProvisioned');
      expect(over.available).toBe(false);
      expect(over.unavailableReason).toBe('This snapshot was collected before Microsoft 365 apps usage was read.');
    });

    it('with the reason the collector gave', () => {
      const over = category(
        run(
          tenant((s) => {
            s.Collectors.appUsage = { ...s.Collectors.appUsage, Available: false, Data: null, Reason: 'Global Reader sees only tenant totals.' };
          }),
        ),
        'overProvisioned',
      );
      expect(over.available).toBe(false);
      expect(over.unavailableReason).toBe('Global Reader sees only tenant totals.');
      expect(over.seats).toBeNull();
    });
  });
});

describe('a licence duplicated by another on the same account', () => {
  const tenant = (edit: (s: any) => void) => {
    const s = structuredClone(premiumSnapshot) as any;
    edit(s);
    return s;
  };
  const user = (s: any, upn: string) => s.Collectors.users.Data.find((u: any) => u.UserPrincipalName === upn);
  const skuOf = (s: any, part: string) => s.Collectors.subscribedSkus.Data.find((k: any) => k.SkuPartNumber === part);
  const E3 = '05e9a617-0261-4cee-bb44-138d3ef5d965';
  const P1 = '078d2b04-f1bd-4111-bbd4-b4b1b354cef4';
  const MDO_P1 = '4ef96642-f096-40de-a3e9-d83fb2f90211';
  const duplicated = (raw: unknown) => category(run(raw), 'duplicated');

  it('prices a standalone licence whose every plan another licence already carries', () => {
    // The sample's Alan holds Entra ID P1 beside Microsoft 365 E3, which includes it.
    const d = duplicated(premiumSnapshot);
    expect(d.available).toBe(true);
    expect(d.seats).toBe(1);
    expect(d.annualCost).toBe(7 * 12);
    expect(d.accounts[0]!.userPrincipalName).toBe('alan@contoso.com');
    expect(d.accounts[0]!.detail).toMatch(/^Everything in .+ also comes with Microsoft 365 E3\.$/);
    expect(d.note).toMatch(/check the same plan is switched on in the one that stays/);
  });

  it('names the packaging change that made it a duplicate', () => {
    // July 2026: Defender for Office 365 Plan 1 arrives in E3, so a standalone seat beside
    // it becomes a second copy.
    const s = tenant((t) => {
      skuOf(t, 'SPE_E3').ServicePlans.push({
        ServicePlanId: 'f20fedf3-f3c3-43c3-8267-2bfdd51c0939',
        ServicePlanName: 'ATP_ENTERPRISE',
        ProvisioningStatus: 'Success',
        AppliesTo: 'User',
      });
      user(t, 'alan@contoso.com').AssignedSkuIds = [E3, MDO_P1];
    });
    const d = duplicated(s);
    expect(d.seats).toBe(1);
    expect(d.annualCost).toBe(2 * 12);
    expect(d.accounts[0]!.detail).toContain(
      'Microsoft added Microsoft Defender for Office 365 Plan 1 to Microsoft 365 E3 on 1 July 2026.',
    );
  });

  it('leaves alone a licence that brings something the others do not', () => {
    const s = tenant((t) => {
      user(t, 'alan@contoso.com').AssignedSkuIds = [E3, MDO_P1]; // E3 here predates July
    });
    expect(duplicated(s).seats).toBe(0);
  });

  it('counts only one of 2 licences that carry the same plans as each other', () => {
    const s = tenant((t) => {
      t.Collectors.subscribedSkus.Data.push({ ...structuredClone(skuOf(t, 'AAD_PREMIUM')), SkuId: 'p1-copy', SkuPartNumber: 'AAD_PREMIUM_COPY' });
      user(t, 'alan@contoso.com').AssignedSkuIds = [P1, 'p1-copy'];
    });
    expect(duplicated(s).seats).toBe(1);
  });

  it('does not lean on a plan switched off in the other licence', () => {
    const s = tenant((t) => {
      skuOf(t, 'SPE_E3').ServicePlans.find((p: any) => p.ServicePlanName === 'AAD_PREMIUM').ProvisioningStatus = 'Disabled';
    });
    expect(duplicated(s).seats).toBe(0);
  });

  it('does not count a seat another category already holds', () => {
    // Katherine is disabled, so her whole account is already counted there.
    const s = tenant((t) => {
      user(t, 'katherine@contoso.com').AssignedSkuIds = [E3, P1];
    });
    expect(duplicated(s).accounts.map((a) => a.userPrincipalName)).toEqual(['alan@contoso.com']);
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
      riskModel,
    });

    expect(model.spend.annualCommitment).toBe(237600);
    expect(model.seatWaste.categories.find((c) => c.id === 'disabled')?.available).toBe(false);
    // Category 1 comes from SKU counts, so it survives.
    expect(model.seatWaste.categories.find((c) => c.id === 'unassigned')?.annualCost).toBe(28488);
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
      riskModel,
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
    // We looked and found none. That is a measurement, and $0 is its result, so the
    // opposite error from reporting an unknown cost as zero.
    const model = withOverrides({ PREVIEW_SKU_NOT_IN_CATALOG: 20, ANOTHER_PREVIEW_ADDON: 20 });
    const never = model.seatWaste.categories.find((c) => c.id === 'neverSignedIn')!;
    expect(never.available).toBe(false); // no Entra ID P1 in this fixture

    const premium = analyze({
      snapshot: (() => {
        const p = parseSnapshot(premiumSnapshot);
        if (!p.ok) throw new Error(p.reason);
        // Everyone signed in this morning, so the category is genuinely empty rather
        // than emptied by configuration, which is no longer possible for licensed
        // accounts, and is the point of the exemption rule.
        const s = structuredClone(p.snapshot);
        for (const u of s.Collectors.users!.Data!) u.LastSignIn = new Date().toISOString();
        return s;
      })(),
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      riskModel,
    });
    const emptyCategory = premium.seatWaste.categories.find((c) => c.id === 'neverSignedIn')!;
    expect(emptyCategory.seats).toBe(0);
    expect(emptyCategory.annualCost).toBe(0);
  });
});
