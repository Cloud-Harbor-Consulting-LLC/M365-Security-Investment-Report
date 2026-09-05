import type { Config, PriceList } from '@/model/reference';
import { safeRatio, type InventoryRow } from './inventory';
import type { Overrides } from './overrides';

export interface UnpricedSku {
  skuPartNumber: string;
  displayName: string;
  consumedUnits: number;
}

export interface ExcludedSku {
  skuPartNumber: string;
  displayName: string;
  exclusionReason: string | null;
}

export interface Spend {
  currency: string;
  basis: string;
  basisLabel: string;
  pricingAsOf: string;
  pricingVerified: boolean;
  pricingWarning: string | null;
  /** Priced, billable SKUs whose price the user supplied rather than the shipped table. */
  overriddenSkuCount: number;
  /** 'list' when nothing was overridden, 'negotiated' when all were, 'mixed' otherwise. */
  pricingProvenance: 'list' | 'negotiated' | 'mixed';

  seatsPurchased: number;
  seatsConsumed: number;
  seatsUnassigned: number;
  /** Of those, how many belong to SKUs that carry a price — and how many do not. */
  unassignedSeatsPriced: number;
  unassignedSeatsUnpriced: number;
  /** Purchased seats belonging to non-excluded SKUs the price table does not cover. */
  seatsUnpriced: number;
  /** Those seats as a share of all purchased seats. Null when none were purchased. */
  unpricedSeatShare: number | null;

  /** False when not one SKU could be priced. Every monetary field is then null. */
  anyPriced: boolean;
  annualSpendConsumed: number | null;
  monthlySpendConsumed: number | null;
  annualCommitment: number | null;
  unassignedSeatCost: number | null;
  securityBudgetAnnual: number | null;

  skuCountTotal: number;
  skuCountBillable: number;
  skuCountPriced: number;
  skuCountUnpriced: number;
  skuCountExcluded: number;
  unpricedSkus: UnpricedSku[];
  excludedSkus: ExcludedSku[];

  /** False when any billable SKU lacks a price, so the totals are a floor. */
  complete: boolean;
}

const sum = (rows: readonly InventoryRow[], pick: (r: InventoryRow) => number | null): number =>
  rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);

/**
 * Totals the inventory into the figures the report leads with.
 *
 * Two dollar totals on purpose, because they answer different questions and conflating
 * them is how these reports lose a CFO:
 *   annualCommitment    purchased seats x price — what EA and CSP agreements actually invoice
 *   annualSpendConsumed assigned seats x price — the part in someone's hands
 * The difference is idle seat spend: money already gone.
 */
export function measureSpend(
  inventory: readonly InventoryRow[],
  config: Config,
  priceList: PriceList,
  overrides: Overrides = { prices: {} },
): Spend {
  const billable = inventory.filter((r) => !r.excluded);
  const priced = billable.filter((r) => r.priceKnown);
  const unpriced = billable.filter((r) => !r.priceKnown);
  const excluded = inventory.filter((r) => r.excluded);

  const seatsPurchased = sum(billable, (r) => r.purchasedUnits);
  const seatsConsumed = sum(billable, (r) => r.consumedUnits);
  const seatsUnpriced = sum(unpriced, (r) => r.purchasedUnits);

  // When not one SKU could be priced, the totals are unknown — not zero. Summing an empty
  // set to 0 and printing "$0 a year" states something false about the tenant. This is the
  // defect the first live run exposed, and it is pinned by tests in both languages.
  const anyPriced = priced.length > 0;
  const annualConsumed = anyPriced ? sum(priced, (r) => r.annualSpendConsumed) : null;
  const annualCommitment = anyPriced ? sum(priced, (r) => r.annualCommitment) : null;
  const unassignedCost = anyPriced ? sum(priced, (r) => r.unassignedSeatCost) : null;
  const securityBudget = anyPriced ? sum(priced, (r) => r.securityBudgetAnnual) : null;

  // A report whose prices are partly the shipped list and partly the customer's own is
  // on neither basis. Saying "negotiated rates" would overclaim and "list price" would
  // be plainly false, so the mixed case is named as mixed and counted.
  const overriddenPriced = priced.filter((r) => r.skuPartNumber in overrides.prices);
  const overriddenSkuCount = overriddenPriced.length;
  const pricingProvenance: Spend['pricingProvenance'] =
    overriddenSkuCount === 0 ? 'list' : overriddenSkuCount === priced.length ? 'negotiated' : 'mixed';

  return {
    currency: config.pricing.currency,
    basis: config.pricing.basis,
    basisLabel: pricingBasisLabel(priceList, pricingProvenance, overriddenSkuCount, priced.length),
    overriddenSkuCount,
    pricingProvenance,
    pricingAsOf: priceList.asOf,
    pricingVerified: priceList.verified,
    // The seed-price warning is about the shipped table. Once every priced SKU carries a
    // rate the user supplied, that warning no longer describes these numbers.
    pricingWarning:
      pricingProvenance === 'negotiated' || priceList.verified
        ? null
        : (priceList.verificationWarning ?? null),

    seatsPurchased,
    seatsConsumed,
    seatsUnassigned: Math.max(0, seatsPurchased - seatsConsumed),
    unassignedSeatsPriced: sum(priced, (r) => r.unassignedUnits),
    unassignedSeatsUnpriced: sum(unpriced, (r) => r.unassignedUnits),
    seatsUnpriced,
    unpricedSeatShare: safeRatio(seatsUnpriced, seatsPurchased),

    anyPriced,
    annualSpendConsumed: annualConsumed,
    monthlySpendConsumed: annualConsumed === null ? null : annualConsumed / 12,
    annualCommitment,
    unassignedSeatCost: unassignedCost,
    securityBudgetAnnual: securityBudget,

    skuCountTotal: inventory.length,
    skuCountBillable: billable.length,
    skuCountPriced: priced.length,
    skuCountUnpriced: unpriced.length,
    skuCountExcluded: excluded.length,
    unpricedSkus: unpriced.map((r) => ({
      skuPartNumber: r.skuPartNumber,
      displayName: r.displayName,
      consumedUnits: r.consumedUnits,
    })),
    excludedSkus: excluded.map((r) => ({
      skuPartNumber: r.skuPartNumber,
      displayName: r.displayName,
      exclusionReason: r.exclusionReason,
    })),

    complete: unpriced.length === 0,
  };
}

/**
 * The pricing-basis sentence printed in the report header. A CFO will ask, and the
 * honest answer is sometimes "both".
 */
export function pricingBasisLabel(
  priceList: PriceList,
  provenance: Spend['pricingProvenance'],
  overridden: number,
  priced: number,
): string {
  if (provenance === 'negotiated') {
    return 'Customer-supplied rates';
  }

  if (provenance === 'mixed') {
    return `Mixed — ${overridden} of ${priced} priced SKUs at customer-supplied rates, the rest at Microsoft list price`;
  }

  let label = `Microsoft public list price${priceList.asOf ? `, as of ${priceList.asOf}` : ''}`;
  if (!priceList.verified) label += ' — unverified seed data';
  return label;
}

export interface RealizationComponent {
  available: boolean;
  ratio: number | null;
  label: string;
  detail: string;
  /**
   * Set when the figure is arithmetically correct but describes something other than
   * what a reader would assume. Shown alongside the number rather than used to adjust
   * it: this report discloses, it does not silently correct.
   */
  caveat: string | null;
}

export interface Realization {
  seat: RealizationComponent;
  feature: RealizationComponent;
  composite: RealizationComponent;
}

/**
 * The board headline: how much of the security value you bought is actually working.
 *
 * Seat realization is measurable now. Feature realization needs Secure Score control
 * evidence (M7), so it is reported as not-yet-measured and the composite is withheld.
 * Presenting a seat-only figure as "spend realized" would overstate the tenant, which is
 * the exact failure this tool exists to correct.
 */
export function measureRealization(spend: Spend, config: Config): Realization {
  const seatRatio = safeRatio(spend.seatsConsumed, spend.seatsPurchased);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const pct = (r: number) => `${Math.round(r * 100)}%`;

  // Seat realization counts every non-excluded SKU, priced or not. When most of those
  // seats come from SKUs the price table does not cover, the percentage is correct but
  // describes allocations the report cannot value — a 25-seat preview SKU can sink the
  // headline on its own. Say so rather than quietly excluding them: removing real
  // allocations to flatter a number would hide genuine waste in a customer tenant.
  const share = spend.unpricedSeatShare;
  const threshold = config.reporting.unpricedSeatDominanceThreshold;
  const seatCaveat =
    share !== null && share > threshold
      ? `${fmt(spend.seatsUnpriced)} of ${fmt(spend.seatsPurchased)} purchased seats (${pct(share)}) come from ` +
        `${spend.skuCountUnpriced === 1 ? 'a SKU' : 'SKUs'} with no price, so this figure is dominated by ` +
        'licences the report cannot value.'
      : null;

  return {
    seat: {
      available: true,
      ratio: seatRatio,
      label: 'Seat realization',
      detail: `${fmt(spend.seatsConsumed)} of ${fmt(spend.seatsPurchased)} purchased seats are assigned.`,
      caveat: seatCaveat,
    },
    feature: {
      available: false,
      ratio: null,
      label: 'Feature realization',
      detail: 'Not yet measured. Requires Secure Score control evidence.',
      caveat: null,
    },
    composite: {
      available: false,
      ratio: null,
      label: 'Spend realized',
      detail: 'Withheld until both seat and feature realization are measured.',
      caveat: null,
    },
  };
}
