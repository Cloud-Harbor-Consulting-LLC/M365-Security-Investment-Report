import type { PriceList } from '@/model/reference';

/**
 * Pricing the consultant supplies, on top of the shipped table.
 *
 * Two distinct jobs, and the second turned out to be the more important one:
 *
 *   * Replace a list price with a customer's negotiated rate.
 *   * Supply a price for a SKU the table does not cover at all. Every real tenant has
 *     at least one — a preview SKU, a new add-on, something bought through a reseller —
 *     and without a price those licences produce no spend figure whatsoever.
 *
 * Keyed by skuPartNumber rather than skuId: part numbers are stable across tenants, so
 * a price entered for one customer is meaningful for the next.
 */
export interface PriceOverride {
  monthlyPerSeat: number;
  /** Optional. Falls back to the shipped share, or the list default. */
  securityValueShare?: number;
}

export interface Overrides {
  prices: Record<string, PriceOverride>;
}

export const NO_OVERRIDES: Overrides = { prices: {} };

export function overrideCount(overrides: Overrides): number {
  return Object.keys(overrides.prices).length;
}

export function hasOverrides(overrides: Overrides): boolean {
  return overrideCount(overrides) > 0;
}

/**
 * Produces the price list the engine should actually use.
 *
 * Overrides are layered onto a copy rather than mutating the shipped table, so resetting
 * is simply discarding them and the original stays trustworthy. An override for a SKU
 * the table has never heard of is appended, which is what makes an unpriced tenant
 * analysable at all.
 */
export function applyOverrides(priceList: PriceList, overrides: Overrides): PriceList {
  if (!hasOverrides(overrides)) return priceList;

  const byPartNumber = new Map(priceList.prices.map((p) => [p.skuPartNumber, { ...p }]));

  for (const [partNumber, override] of Object.entries(overrides.prices)) {
    const existing = byPartNumber.get(partNumber);
    byPartNumber.set(partNumber, {
      skuPartNumber: partNumber,
      monthlyPerSeat: override.monthlyPerSeat,
      securityValueShare: override.securityValueShare ?? existing?.securityValueShare,
    });
  }

  return { ...priceList, prices: [...byPartNumber.values()] };
}

/**
 * Sets an override, or clears it when the value is not a usable price.
 *
 * Returns a new object rather than mutating: the model is recomputed from
 * snapshot + overrides on every change, and shared mutable state would make that
 * recomputation unreliable.
 */
export function setOverride(
  overrides: Overrides,
  partNumber: string,
  monthlyPerSeat: number | null,
): Overrides {
  const next = { ...overrides.prices };

  if (monthlyPerSeat === null || !Number.isFinite(monthlyPerSeat) || monthlyPerSeat < 0) {
    delete next[partNumber];
  } else {
    const existing = next[partNumber];
    next[partNumber] = existing
      ? { ...existing, monthlyPerSeat }
      : { monthlyPerSeat };
  }

  return { prices: next };
}

export function clearOverrides(): Overrides {
  return { prices: {} };
}
