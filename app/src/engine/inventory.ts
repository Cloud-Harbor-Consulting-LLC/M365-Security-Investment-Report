import type { SubscribedSku } from '@/model/snapshot';
import type { CatalogSku, Config, PriceList, SkuCatalog } from '@/model/reference';

export interface InventoryRow {
  skuId: string;
  skuPartNumber: string;
  displayName: string;
  family: string;
  namingTrap: string | null;
  inCatalog: boolean;

  purchasedUnits: number;
  consumedUnits: number;
  unassignedUnits: number;
  suspendedUnits: number;
  warningUnits: number;
  capabilityStatus: string | null;

  isFreeSku: boolean;
  isUnlimitedSeatCount: boolean;
  excluded: boolean;
  exclusionReason: string | null;

  priceKnown: boolean;
  unitPriceMonthly: number | null;
  unitPriceAnnual: number | null;
  securityValueShare: number;

  /** Null rather than 0 whenever the figure is unknown. Zero is a claim; null is the truth. */
  annualSpendConsumed: number | null;
  annualCommitment: number | null;
  unassignedSeatCost: number | null;
  securityBudgetAnnual: number | null;

  seatUtilization: number | null;
  servicePlans: SubscribedSku['ServicePlans'];
}

/**
 * Division that yields null instead of throwing or fabricating a zero.
 *
 * "No seats purchased" and "0% realized" mean different things to a reader, and the
 * report must not confuse them.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Turns raw subscribedSkus into the priced, named inventory everything else is built on.
 *
 * Three jobs, mirroring Resolve-CHSISku:
 *  1. Resolve the part number to a product name — Microsoft's part numbers routinely
 *     disagree with the marketing name, so unresolved ones are surfaced, never guessed.
 *  2. Attach a price. A SKU with no price entry is marked and excluded from every dollar
 *     figure while still counting toward seats. It is never silently priced at zero.
 *  3. Flag free and self-service SKUs, which report implausible seat counts that would
 *     otherwise dominate every total.
 */
export function resolveInventory(
  skus: readonly SubscribedSku[],
  config: Config,
  catalog: SkuCatalog,
  priceList: PriceList,
): InventoryRow[] {
  const catalogIndex = new Map<string, CatalogSku>(catalog.skus.map((s) => [s.skuPartNumber, s]));
  const priceIndex = new Map(priceList.prices.map((p) => [p.skuPartNumber, p]));

  const unlimitedThreshold = config.skus.unlimitedSeatThreshold;
  const unrecognizedThreshold = config.skus.unrecognizedSeatThreshold;
  const manualExclusions = new Set(config.skus.excludeSkuPartNumbers);
  const defaultShare = priceList.defaultSecurityValueShare ?? 0.1;

  return skus.map((sku): InventoryRow => {
    const partNumber = sku.SkuPartNumber;
    const catalogEntry = catalogIndex.get(partNumber);
    const priceEntry = priceIndex.get(partNumber);

    const purchased = sku.PrepaidEnabled;
    const consumed = sku.ConsumedUnits;

    const isCatalogFree = catalogEntry?.isFree === true;
    const isUnlimited = purchased >= unlimitedThreshold;
    const isUnrecognizedViral = !catalogEntry && !priceEntry && purchased >= unrecognizedThreshold;

    let excluded = false;
    let exclusionReason: string | null = null;

    if (manualExclusions.has(partNumber)) {
      excluded = true;
      exclusionReason = 'Excluded by configuration.';
    } else if (isCatalogFree) {
      excluded = true;
      exclusionReason = 'Free or self-service SKU; carries no cost and reports an unlimited seat count.';
    } else if (isUnlimited) {
      excluded = true;
      exclusionReason =
        `Reports ${purchased.toLocaleString('en-US')} purchased seats, at or above the ` +
        `${unlimitedThreshold.toLocaleString('en-US')} unlimited-seat threshold. Treated as an unlimited free SKU.`;
    } else if (isUnrecognizedViral) {
      // 10,000 seats is a plausible enterprise purchase on its own, so this branch also
      // requires the SKU to be unknown and unpriced. Left in, a viral trial injects five
      // figures of phantom seats into seat realization.
      excluded = true;
      exclusionReason =
        `Reports ${purchased.toLocaleString('en-US')} purchased seats but is absent from the SKU catalog and has ` +
        'no price. Treated as a self-service or viral trial rather than a purchase; add it to the catalog and ' +
        'price list if this tenant genuinely bought it.';
    }

    const priceKnown = priceEntry !== undefined;
    const monthly = priceEntry?.monthlyPerSeat ?? null;
    const annual = monthly === null ? null : monthly * 12;
    const share = priceEntry?.securityValueShare ?? defaultShare;

    const countsTowardMoney = !excluded && priceKnown && annual !== null;
    const unassigned = Math.max(0, purchased - consumed);

    return {
      skuId: sku.SkuId,
      skuPartNumber: partNumber,
      displayName: catalogEntry?.displayName ?? partNumber,
      family: catalogEntry?.family ?? 'Unrecognized',
      namingTrap: catalogEntry?.trap ?? null,
      inCatalog: catalogEntry !== undefined,

      purchasedUnits: purchased,
      consumedUnits: consumed,
      unassignedUnits: unassigned,
      suspendedUnits: sku.PrepaidSuspended,
      warningUnits: sku.PrepaidWarning,
      capabilityStatus: sku.CapabilityStatus,

      isFreeSku: isCatalogFree,
      isUnlimitedSeatCount: isUnlimited || isUnrecognizedViral,
      excluded,
      exclusionReason,

      priceKnown,
      unitPriceMonthly: monthly,
      unitPriceAnnual: annual,
      securityValueShare: share,

      annualSpendConsumed: countsTowardMoney ? annual * consumed : null,
      annualCommitment: countsTowardMoney ? annual * purchased : null,
      unassignedSeatCost: countsTowardMoney ? annual * unassigned : null,
      securityBudgetAnnual: countsTowardMoney ? annual * consumed * share : null,

      seatUtilization: safeRatio(consumed, purchased),
      servicePlans: sku.ServicePlans,
    };
  });
}
