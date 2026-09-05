import type { TenantUser } from '@/model/snapshot';
import type { Config } from '@/model/reference';
import type { InventoryRow } from './inventory';

/**
 * Seat-level waste: the five canonical categories.
 *
 * Each category reports its own availability. A tenant without Entra ID P1 cannot
 * measure sign-in activity, and the correct answer there is "not measured", never zero —
 * a zero would read as "no waste found", which is the opposite of the truth.
 */

export type WasteCategoryId =
  | 'unassigned'
  | 'disabled'
  | 'neverSignedIn'
  | 'inactive'
  | 'overProvisioned';

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
  /** Accounts behind the figure, for the drill-down. Empty when not measured. */
  accounts: WasteAccount[];
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
 * Accounts that legitimately hold a licence but rarely sign in: service accounts, shared
 * mailboxes, room and equipment resources. Counting them as waste produces a report the
 * customer immediately disputes, and one wrong line costs the credibility of every other.
 */
function isExempt(user: TenantUser, config: Config): boolean {
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

function summarise(id: WasteCategoryId, label: string, accounts: WasteAccount[]): WasteCategory {
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
    accounts,
  };
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
}

export function measureSeatWaste(input: SeatWasteInput): SeatWaste {
  const { users, inventory, config, signInActivityAvailable, usersAvailable, usersReason } = input;
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
    accounts: [],
  });

  const overProvisioned = notCollected(
    'overProvisioned',
    'Over-provisioned (a richer licence than the account uses)',
    'Requires per-user service-plan usage rather than seat counts, which is not collected.',
  );

  if (!usersAvailable || !users) {
    const reason = usersReason ?? 'User collection was unavailable.';
    return {
      categories: [
        unassigned,
        notCollected('disabled', 'Disabled but licensed', reason),
        notCollected('neverSignedIn', 'Never signed in', reason),
        notCollected('inactive', `Inactive beyond ${config.inactivity.thresholdDays} days`, reason),
        overProvisioned,
      ],
      totalAnnualCost: unassigned.annualCost,
      totalSeats: unassigned.seats,
      incomplete: true,
      totalIsFloor: unassigned.costIsFloor,
      exemptedAccounts: 0,
    };
  }

  const exempted = users.filter((u) => isExempt(u, config));
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
    const cutoff = Date.now() - config.inactivity.thresholdDays * 86_400_000;

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

    const days = (ms: number) => Math.floor((Date.now() - ms) / 86_400_000);
    inactive = summarise(
      'inactive',
      `Inactive beyond ${config.inactivity.thresholdDays} days`,
      enabled
        .filter((u) => {
          const seen = lastSeen(u);
          return seen !== null && seen < cutoff;
        })
        .map((u) => toAccount(u, `Last signed in ${days(lastSeen(u)!)} days ago`)),
    );
  }

  const categories = [unassigned, disabled, neverSignedIn, inactive, overProvisioned];
  const measured = categories.filter((c) => c.available);
  const costs = measured.map((c) => c.annualCost).filter((c): c is number => c !== null);
  const seats = measured.map((c) => c.seats).filter((s): s is number => s !== null);

  return {
    categories,
    totalAnnualCost: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    totalSeats: seats.length > 0 ? seats.reduce((a, b) => a + b, 0) : null,
    incomplete: measured.length < categories.length,
    totalIsFloor: measured.some((c) => c.costIsFloor) || measured.some((c) => c.annualCost === null),
    exemptedAccounts: exempted.length,
  };
}
