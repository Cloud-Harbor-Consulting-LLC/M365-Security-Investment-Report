import type { AppUsageData, AppUsageUser, TenantUser } from '@/model/snapshot';
import type { Config } from '@/model/reference';
import type { InventoryRow } from './inventory';
import type { PackagingChange } from './features';

/**
 * Seat-level waste: the six canonical categories.
 *
 * Each category reports its own availability. A tenant without Entra ID P1 cannot
 * measure sign-in activity, and the correct answer there is "not measured", never zero,
 * a zero would read as "no waste found", which is the opposite of the truth.
 */

export type WasteCategoryId =
  | 'unassigned'
  | 'disabled'
  | 'neverSignedIn'
  | 'inactive'
  | 'overProvisioned'
  | 'duplicated';

export interface WasteCategory {
  id: WasteCategoryId;
  label: string;
  available: boolean;
  /** Why it could not be measured, and what would fix it. */
  unavailableReason: string | null;
  seats: number | null;
  annualCost: number | null;
  /**
   * True when the cost covers only some of the seats in this category, because the rest
   * belong to SKUs with no price. The figure is then a floor, and must not be presented
   * as the answer.
   */
  costIsFloor: boolean;
  /** True when the seat count is a lower bound rather than a count of named accounts. */
  seatsAreFloor: boolean;
  /** What a reader needs to read the figure correctly, when the label alone will not do. */
  note: string | null;
  /** Accounts behind the figure, for the drill-down. Empty when not measured. */
  accounts: WasteAccount[];
}

/** Which licences carry the desktop apps, and the one move priced. See the $note in feature-map.json. */
export interface DesktopApps {
  servicePlanNames: string[];
  removable: Array<{
    skuPartNumber: string;
    /** Each group must be met by another licence on the account: any one plan in the group. */
    requiresElsewhere: string[][];
  }>;
}

/** The usage report, or why it is missing. */
export interface AppUsageInput {
  available: boolean;
  reason: string | null;
  data: AppUsageData | null;
}

export interface WasteAccount {
  id: string;
  displayName: string | null;
  userPrincipalName: string | null;
  skuPartNumbers: string[];
  annualCost: number | null;
  detail: string | null;
}

export interface SeatWaste {
  categories: WasteCategory[];
  /** Sum of the categories that could be measured and priced. */
  totalAnnualCost: number | null;
  totalSeats: number | null;
  /** True when at least one category could not be measured, so the total is a floor. */
  incomplete: boolean;
  /** True when a measured category could only be partly priced. */
  totalIsFloor: boolean;
  exemptedAccounts: number;
}

const SIGN_IN_UNAVAILABLE =
  'Sign-in activity was not collected. It requires Entra ID P1 and AuditLog.Read.All; without the licence Graph refuses the whole user query, so this cannot be established.';

/**
 * Accounts excluded from the waste categories: service accounts, shared mailboxes, room
 * and equipment resources. Counting those as waste produces a report the customer
 * immediately disputes, and one wrong line costs the credibility of every other.
 *
 * An account holding a licence is never exempt, whatever the rules say. An exemption
 * that can hide paid-for seats turns this tool's central claim inside out, because the report
 * would under-state waste in exactly the tenants that most need it found, and do so
 * silently. A guest account with an E5 licence is not noise to be filtered; it is
 * precisely the kind of finding the customer is paying to hear.
 */
function isExempt(user: TenantUser, config: Config): boolean {
  if (user.AssignedSkuIds.length > 0) return false;

  const upn = (user.UserPrincipalName ?? '').toLowerCase();
  if (config.exemptions.userPrincipalNames.some((e) => e.toLowerCase() === upn)) return true;
  if (user.UserType && config.exemptions.userTypes.includes(user.UserType)) return true;

  const name = user.DisplayName ?? '';
  return config.exemptions.displayNamePatterns.some((pattern) => {
    // Config uses shell-style globs, which are what a consultant will reach for.
    const rx = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
      'i',
    );
    return rx.test(name);
  });
}

/** Annual cost of the licences on one account, or null when none of them are priced. */
function costOf(user: TenantUser, bySkuId: Map<string, InventoryRow>): number | null {
  let total = 0;
  let priced = false;

  for (const skuId of user.AssignedSkuIds) {
    const row = bySkuId.get(skuId);
    if (!row || row.excluded || row.unitPriceAnnual === null) continue;
    total += row.unitPriceAnnual;
    priced = true;
  }

  return priced ? total : null;
}

function partNumbersOf(user: TenantUser, bySkuId: Map<string, InventoryRow>): string[] {
  return user.AssignedSkuIds.map((id) => bySkuId.get(id))
    .filter((r): r is InventoryRow => r !== undefined && !r.excluded)
    .map((r) => r.skuPartNumber);
}

function summarise(
  id: WasteCategoryId,
  label: string,
  accounts: WasteAccount[],
  note: string | null = null,
): WasteCategory {
  const costs = accounts.map((a) => a.annualCost).filter((c): c is number => c !== null);

  // Three different answers, and conflating any two of them misleads:
  //   no accounts at all      -> $0. We looked and there is genuinely nothing here.
  //   accounts, none priced   -> null. The seats are real; their cost is unknown.
  //   accounts, some priced   -> a floor, not the answer.
  const annualCost =
    accounts.length === 0 ? 0 : costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0);

  return {
    id,
    label,
    available: true,
    unavailableReason: null,
    seats: accounts.length,
    annualCost,
    costIsFloor: costs.length > 0 && costs.length < accounts.length,
    seatsAreFloor: false,
    note,
    accounts,
  };
}

const OVER_PROVISIONED = 'Over-provisioned (desktop apps not used on a desktop)';

/** Plans carried by the account's licences, optionally leaving one licence out. */
function plansOf(user: TenantUser, bySkuId: Map<string, InventoryRow>, except?: string): Set<string> {
  const plans = new Set<string>();
  for (const id of user.AssignedSkuIds) {
    const row = bySkuId.get(id);
    if (!row || row.excluded || row.skuPartNumber === except) continue;
    for (const p of row.servicePlans) plans.add(p.ServicePlanName.toUpperCase());
  }
  return plans;
}

const platformWords = (u: AppUsageUser): string => {
  const used = [u.Mobile && 'a phone or tablet', u.Web && 'the web'].filter((w): w is string => Boolean(w));
  return used.length === 0 ? 'on no platform' : `only on ${used.join(' and ')}`;
};

/**
 * Accounts licensed for the desktop apps that used them on neither Windows nor Mac.
 *
 * Every such account is counted. A saving is priced only where removing a licence costs
 * the account no security plan, which today is a standalone Apps for business seat held
 * beside another licence with Office for the web and file storage. Every other desktop
 * licence carries a security plan its cheaper sibling lacks, and this tool does not price
 * a move to less security.
 *
 * When the tenant conceals names in usage reports, rows cannot be matched to accounts.
 * The count is then the licensed accounts less those the report shows using a desktop,
 * which can only undercount: a desktop user who is not a candidate here still reduces it.
 * It is reported as a floor, with no accounts listed, and the setting is left alone.
 */
function measureOverProvisioning(args: {
  candidates: TenantUser[];
  bySkuId: Map<string, InventoryRow>;
  appUsage: AppUsageInput;
  desktopApps: DesktopApps | null;
  asOf: number;
  toAccount: (user: TenantUser, detail: string | null) => WasteAccount;
}): WasteCategory {
  const { candidates, bySkuId, appUsage, desktopApps, asOf, toAccount } = args;
  const notMeasured = (reason: string): WasteCategory => ({
    id: 'overProvisioned',
    label: OVER_PROVISIONED,
    available: false,
    unavailableReason: reason,
    seats: null,
    annualCost: null,
    costIsFloor: false,
    seatsAreFloor: false,
    note: null,
    accounts: [],
  });

  if (!desktopApps) return notMeasured('The reference data names no licences carrying the desktop apps.');
  if (!appUsage.available || !appUsage.data) {
    return notMeasured(appUsage.reason ?? 'Microsoft 365 apps usage was not collected.');
  }

  const usage = appUsage.data;
  const days = usage.PeriodDays;
  const desktopPlans = new Set(desktopApps.servicePlanNames.map((p) => p.toUpperCase()));
  const periodStart = asOf - days * 86_400_000;

  // Licensed for the desktop apps, and old enough to have had the whole period to use them.
  const licensed = candidates.filter((u) => {
    const created = u.CreatedDateTime ? Date.parse(u.CreatedDateTime) : Number.NaN;
    if (Number.isFinite(created) && created > periodStart) return false;
    return [...plansOf(u, bySkuId)].some((p) => desktopPlans.has(p));
  });

  /** The saving from removing a licence the account would not miss, or null. */
  const savingFor = (u: TenantUser): number | null => {
    let saving: number | null = null;
    for (const move of desktopApps.removable) {
      const row = u.AssignedSkuIds.map((id) => bySkuId.get(id)).find(
        (r) => r && !r.excluded && r.skuPartNumber === move.skuPartNumber,
      );
      if (!row || row.unitPriceAnnual === null) continue;
      const elsewhere = plansOf(u, bySkuId, move.skuPartNumber);
      if (!move.requiresElsewhere.every((group) => group.some((p) => elsewhere.has(p.toUpperCase())))) continue;
      saving = (saving ?? 0) + row.unitPriceAnnual;
    }
    return saving;
  };

  const desktopUsers = usage.Users.filter((r) => r.Windows || r.Mac).length;

  if (usage.Concealed) {
    const seats = Math.max(0, licensed.length - desktopUsers);
    const priced = licensed.map(savingFor).filter((v): v is number => v !== null);
    // However the unnamed accounts fall, at least this many must hold a priced licence.
    const pricedAtLeast = Math.max(0, seats - (licensed.length - priced.length));
    return {
      id: 'overProvisioned',
      label: OVER_PROVISIONED,
      available: true,
      unavailableReason: null,
      seats,
      annualCost: seats === 0 ? 0 : pricedAtLeast > 0 ? pricedAtLeast * Math.min(...priced) : null,
      costIsFloor: pricedAtLeast > 0,
      seatsAreFloor: seats > 0,
      note:
        `This tenant hides names in Microsoft's usage reports, so the accounts cannot be listed. ` +
        `${licensed.length} accounts are licensed for the desktop apps and the report shows ${desktopUsers} ` +
        `using them on Windows or Mac in ${days} days, so at least ${seats} did not. ` +
        `A saving is priced only where removing a licence costs the account no security plan.`,
      accounts: [],
    };
  }

  const byName = new Map(usage.Users.map((r) => [r.UserPrincipalName.toLowerCase(), r]));
  const accounts = licensed
    .map((u) => ({ u, row: byName.get((u.UserPrincipalName ?? '').toLowerCase()) }))
    .filter(({ row }) => !row || !(row.Windows || row.Mac))
    .map(({ u, row }) => {
      const saving = savingFor(u);
      const used = row ? `Used the apps ${platformWords(row)} in ${days} days.` : `No use of the apps reported in ${days} days.`;
      const why =
        saving !== null
          ? ' The standalone desktop apps licence can go.'
          : ' No cheaper licence keeps the same security, so no saving is priced.';
      return { ...toAccount(u, used + why), annualCost: saving };
    });

  const unpriced = accounts.filter((a) => a.annualCost === null).length;
  return summarise(
    'overProvisioned',
    OVER_PROVISIONED,
    accounts,
    unpriced > 0
      ? `${unpriced} of these accounts ${unpriced === 1 ? 'holds' : 'hold'} a licence whose cheaper sibling drops a security plan, so ${unpriced === 1 ? 'it is' : 'they are'} counted and not priced.`
      : null,
  );
}

const DUPLICATED = 'Duplicated by another licence';

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Licences whose every service plan the account already gets from another licence it
 * holds. Removing one costs the account nothing, security included, so its whole price is
 * the saving.
 *
 * The case that prompted it: in July 2026 Microsoft added Defender for Office 365 Plan 1 to
 * Microsoft 365 E3 and Office 365 E3, so a standalone Plan 1 seat on an E3 account became a
 * second copy of something already paid for. The rule does not depend on the packaging
 * changes list, which only names the change when one explains the overlap. An Office 365
 * E3 seat beside Microsoft 365 E3 is the same waste, and older than any of them.
 *
 * Licences are tried cheapest first, and each spare one is set aside before the next is
 * checked, so 2 licences carrying the same plans never both count as the spare.
 */
function measureDuplicated(args: {
  candidates: TenantUser[];
  bySkuId: Map<string, InventoryRow>;
  changes: readonly PackagingChange[];
  /** `${account id}|${part number}` pairs another category already priced. */
  alreadyPriced: ReadonlySet<string>;
  toAccount: (user: TenantUser, detail: string | null) => WasteAccount;
}): WasteCategory {
  const { candidates, bySkuId, changes, alreadyPriced, toAccount } = args;
  const plansOfRow = (r: InventoryRow) => r.servicePlans.map((p) => p.ServicePlanName.toUpperCase());

  /** The packaging change that put one of these plans into one of these licences, if any. */
  const explainedBy = (plans: string[], keepers: InventoryRow[]): string | null => {
    for (const change of changes) {
      for (const added of change.added) {
        const keeper = keepers.find((k) => k.skuPartNumber === added.skuPartNumber);
        if (keeper && added.servicePlanNames.some((p) => plans.includes(p.toUpperCase()))) {
          return ` Microsoft added ${change.product} to ${keeper.displayName} on ${longDate(change.effective)}.`;
        }
      }
    }
    return null;
  };

  const accounts: WasteAccount[] = [];
  for (const user of candidates) {
    const rows = user.AssignedSkuIds.map((id) => bySkuId.get(id)).filter(
      (r): r is InventoryRow => r !== undefined && !r.excluded,
    );
    if (rows.length < 2) continue;

    const order = [...rows].sort(
      (a, b) => (a.unitPriceAnnual ?? 0) - (b.unitPriceAnnual ?? 0) || a.skuPartNumber.localeCompare(b.skuPartNumber),
    );
    const spare: InventoryRow[] = [];
    for (const row of order) {
      if (alreadyPriced.has(`${user.Id}|${row.skuPartNumber}`)) continue;
      const plans = plansOfRow(row);
      // A licence listing no plans is not shown to be covered by anything.
      if (plans.length === 0) continue;
      const others = rows.filter((r) => r !== row && !spare.includes(r));
      // A plan the tenant has switched off in the other licence does not stand in for it.
      const elsewhere = new Set(
        others.flatMap((r) =>
          r.servicePlans.filter((p) => p.ProvisioningStatus !== 'Disabled').map((p) => p.ServicePlanName.toUpperCase()),
        ),
      );
      if (plans.every((p) => elsewhere.has(p))) spare.push(row);
    }
    if (spare.length === 0) continue;

    const detail = spare
      .map((row) => {
        const plans = plansOfRow(row);
        const keepers = rows.filter((r) => !spare.includes(r) && plansOfRow(r).some((p) => plans.includes(p)));
        const names = keepers.map((k) => k.displayName).join(' and ');
        return `Everything in ${row.displayName} also comes with ${names}.${explainedBy(plans, keepers) ?? ''}`;
      })
      .join(' ');
    const priced = spare.map((r) => r.unitPriceAnnual).filter((p): p is number => p !== null);
    accounts.push({ ...toAccount(user, detail), annualCost: priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null });
  }

  return summarise(
    'duplicated',
    DUPLICATED,
    accounts,
    accounts.length > 0
      ? 'An administrator can switch off a single plan inside a licence for one account. Before removing the spare licence, check the same plan is switched on in the one that stays.'
      : null,
  );
}

export interface SeatWasteInput {
  users: TenantUser[] | null;
  /** True when users were collected but without sign-in activity. */
  signInActivityAvailable: boolean;
  usersAvailable: boolean;
  usersReason: string | null;
  inventory: readonly InventoryRow[];
  config: Config;
  /** Category 1 comes from SKU counts, not users, so it is passed in. */
  unassignedSeats: number;
  unassignedCost: number | null;
  unassignedSeatsPriced: number;
  unassignedSeatsUnpriced: number;
  /**
   * When the sign-in data was read, in milliseconds since the epoch. Inactivity is measured
   * back from this moment, never from the moment someone happens to open the report.
   */
  asOf: number;
  /** Absent from snapshots taken before the usage report was read. */
  appUsage: AppUsageInput;
  desktopApps: DesktopApps | null;
  /** Names the change behind a duplicated licence, when one explains it. */
  packagingChanges: readonly PackagingChange[];
}

export function measureSeatWaste(input: SeatWasteInput): SeatWaste {
  const { users, inventory, config, signInActivityAvailable, usersAvailable, usersReason, asOf } = input;
  const bySkuId = new Map(inventory.map((r) => [r.skuId, r]));

  // Seat count covers every billable SKU; cost covers only the priced ones. Where those
  // disagree, saying "$0" would report 25 idle seats as costing nothing.
  const unassigned: WasteCategory = {
    id: 'unassigned',
    label: 'Unassigned purchased seats',
    available: true,
    unavailableReason: null,
    seats: input.unassignedSeats,
    annualCost:
      input.unassignedSeats === 0
        ? 0
        : input.unassignedSeatsPriced === 0
          ? null
          : input.unassignedCost,
    costIsFloor: input.unassignedSeatsPriced > 0 && input.unassignedSeatsUnpriced > 0,
    seatsAreFloor: false,
    note: null,
    accounts: [],
  };

  const notCollected = (id: WasteCategoryId, label: string, reason: string): WasteCategory => ({
    id,
    label,
    available: false,
    unavailableReason: reason,
    seats: null,
    annualCost: null,
    costIsFloor: false,
    seatsAreFloor: false,
    note: null,
    accounts: [],
  });

  if (!usersAvailable || !users) {
    const reason = usersReason ?? 'User collection was unavailable.';
    return {
      categories: [
        unassigned,
        notCollected('disabled', 'Disabled but licensed', reason),
        notCollected('neverSignedIn', 'Never signed in', reason),
        notCollected('inactive', `Inactive beyond ${config.inactivity.thresholdDays} days`, reason),
        notCollected('overProvisioned', OVER_PROVISIONED, reason),
        notCollected('duplicated', DUPLICATED, reason),
      ],
      totalAnnualCost: unassigned.annualCost,
      totalSeats: unassigned.seats,
      incomplete: true,
      totalIsFloor: unassigned.costIsFloor,
      exemptedAccounts: 0,
    };
  }

  // Accounts an exemption rule actually removed from the analysis. Structurally zero now
  // that a licensed account is never exempt. Unlicensed accounts hold no seats and were
  // never in scope, but it is computed rather than hardcoded, so the guarantee is checked on
  // every run instead of assumed, and reappears in the report if the rule is ever loosened.
  const exempted = users.filter((u) => isExempt(u, config) && u.AssignedSkuIds.length > 0);
  const considered = users.filter((u) => !isExempt(u, config) && u.AssignedSkuIds.length > 0);

  const toAccount = (user: TenantUser, detail: string | null): WasteAccount => ({
    id: user.Id,
    displayName: user.DisplayName,
    userPrincipalName: user.UserPrincipalName,
    skuPartNumbers: partNumbersOf(user, bySkuId),
    annualCost: costOf(user, bySkuId),
    detail,
  });

  const disabled = summarise(
    'disabled',
    'Disabled but licensed',
    considered.filter((u) => !u.AccountEnabled).map((u) => toAccount(u, 'Account is disabled')),
  );

  let neverSignedIn: WasteCategory;
  let inactive: WasteCategory;

  if (!signInActivityAvailable) {
    neverSignedIn = notCollected('neverSignedIn', 'Never signed in', SIGN_IN_UNAVAILABLE);
    inactive = notCollected(
      'inactive',
      `Inactive beyond ${config.inactivity.thresholdDays} days`,
      SIGN_IN_UNAVAILABLE,
    );
  } else {
    const enabled = considered.filter((u) => u.AccountEnabled);
    // From the collection, not from now. The snapshot is frozen when it is read and the
    // clock is not, so measuring from now made accounts drift into "inactive" while a
    // saved session sat on disk, made every test on this category start failing on a fixed
    // date, and would have made any earlier run look worse than it was beside a later one.
    const cutoff = asOf - config.inactivity.thresholdDays * 86_400_000;

    const lastSeen = (u: TenantUser): number | null => {
      const stamps = [u.LastSignIn, u.LastNonInteractiveSignIn]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => new Date(s).getTime())
        .filter((n) => Number.isFinite(n));
      return stamps.length > 0 ? Math.max(...stamps) : null;
    };

    neverSignedIn = summarise(
      'neverSignedIn',
      'Never signed in',
      enabled.filter((u) => lastSeen(u) === null).map((u) => toAccount(u, 'No sign-in ever recorded')),
    );

    const days = (ms: number) => Math.floor((asOf - ms) / 86_400_000);
    inactive = summarise(
      'inactive',
      `Inactive beyond ${config.inactivity.thresholdDays} days`,
      enabled
        .filter((u) => {
          const seen = lastSeen(u);
          return seen !== null && seen < cutoff;
        })
        .map((u) => toAccount(u, `Last signed in ${days(lastSeen(u)!)} days before collection`)),
    );
  }

  // Accounts already counted as disabled, never signed in or inactive are left out, so
  // no seat is counted twice in the total.
  const counted = new Set([disabled, neverSignedIn, inactive].flatMap((c) => c.accounts.map((a) => a.id)));
  const active = considered.filter((u) => u.AccountEnabled && !counted.has(u.Id));
  const overProvisioned = measureOverProvisioning({
    candidates: active,
    bySkuId,
    appUsage: input.appUsage,
    desktopApps: input.desktopApps,
    asOf,
    toAccount,
  });

  // A desktop apps licence already priced as over-provisioned is not priced again here.
  const alreadyPriced = new Set(
    overProvisioned.accounts
      .filter((a) => a.annualCost !== null)
      .flatMap((a) => (input.desktopApps?.removable ?? []).map((m) => `${a.id}|${m.skuPartNumber}`)),
  );
  const duplicated = measureDuplicated({
    candidates: active,
    bySkuId,
    changes: input.packagingChanges,
    alreadyPriced,
    toAccount,
  });

  const categories = [unassigned, disabled, neverSignedIn, inactive, overProvisioned, duplicated];
  const measured = categories.filter((c) => c.available);
  // An empty category's $0 is true, but it prices nothing. Counting it would turn a total
  // whose real seats are all unpriced into $0, which is exactly the wrong zero.
  const costs = measured
    .filter((c) => c.seats !== 0)
    .map((c) => c.annualCost)
    .filter((c): c is number => c !== null);
  const seats = measured.map((c) => c.seats).filter((s): s is number => s !== null);
  const nothingFound = measured.length > 0 && measured.every((c) => c.seats === 0);

  return {
    categories,
    totalAnnualCost: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : nothingFound ? 0 : null,
    totalSeats: seats.length > 0 ? seats.reduce((a, b) => a + b, 0) : null,
    incomplete: measured.length < categories.length,
    totalIsFloor: measured.some((c) => c.costIsFloor) || measured.some((c) => c.annualCost === null),
    exemptedAccounts: exempted.length,
  };
}
