import type { OrganizationData, Snapshot } from '@/model/snapshot';
import type { Config, PriceList, SkuCatalog } from '@/model/reference';
import { resolveInventory, type InventoryRow } from './inventory';
import { measureRealization, measureSpend, type Realization, type Spend } from './spend';
import { applyOverrides, hasOverrides, NO_OVERRIDES, type Overrides } from './overrides';
import { measureSeatWaste, type SeatWaste } from './waste';

export * from './inventory';
export * from './spend';
export * from './overrides';
export * from './waste';

export interface CollectorSummary {
  name: string;
  available: boolean;
  degraded: boolean;
  reason: string;
}

export interface ReportModel {
  schemaVersion: string;
  generatedAt: string;
  tenant: OrganizationData;
  config: Config;
  inventory: InventoryRow[];
  spend: Spend;
  seatWaste: SeatWaste;
  realization: Realization;
  provenance: {
    source: string;
    snapshotCollected: string;
    collectors: CollectorSummary[];
    extraScopes: string[];
    extraWriteScopes: string[];
  };
}

export interface AnalyzeInput {
  snapshot: Snapshot;
  config: Config;
  catalog: SkuCatalog;
  priceList: PriceList;
  /** Prices the user supplied. Layered over the shipped table, never into it. */
  overrides?: Overrides;
}

/**
 * Snapshot + reference data + config → report model.
 *
 * Pure: no network, no clock beyond a single generatedAt stamp, no I/O. That is what
 * makes it safe to re-run on every keystroke when a price is overridden, and what lets
 * the fixture tests be genuine end-to-end coverage.
 */
export function analyze({
  snapshot,
  config,
  catalog,
  priceList,
  overrides = NO_OVERRIDES,
}: AnalyzeInput): ReportModel {
  const skuCollector = snapshot.Collectors.subscribedSkus;
  if (!skuCollector.Available || !skuCollector.Data) {
    throw new Error(
      `Cannot analyse: the subscribed SKU collection is unavailable. ${skuCollector.Reason ?? ''}`.trim(),
    );
  }

  const orgCollector = snapshot.Collectors.organization;
  const tenant: OrganizationData =
    orgCollector.Available && orgCollector.Data
      ? orgCollector.Data
      : {
          TenantId: snapshot.Context.TenantId,
          DisplayName: 'Unknown tenant',
          CountryLetterCode: null,
          CreatedDateTime: null,
          VerifiedDomains: [],
          DefaultDomain: null,
        };

  // Overrides produce a derived price list rather than mutating the shipped one, so the
  // whole downstream calculation is unchanged and resetting is just discarding them.
  const effectivePriceList = applyOverrides(priceList, overrides);
  const overriddenPartNumbers = new Set(Object.keys(overrides.prices));

  const effectiveConfig: Config = hasOverrides(overrides)
    ? { ...config, pricing: { ...config.pricing, basis: 'CustomNegotiated' } }
    : config;

  const inventory = resolveInventory(
    skuCollector.Data,
    effectiveConfig,
    catalog,
    effectivePriceList,
    overriddenPartNumbers,
  );
  const spend = measureSpend(inventory, effectiveConfig, effectivePriceList, overrides);

  // Users are absent from snapshots taken before this collector existed, which must
  // degrade the waste analysis rather than break the whole report.
  const userCollector = snapshot.Collectors.users;
  const seatWaste = measureSeatWaste({
    users: userCollector?.Data ?? null,
    usersAvailable: Boolean(userCollector?.Available && userCollector.Data),
    usersReason:
      userCollector?.Reason ??
      (userCollector ? null : 'This snapshot was collected before user data was gathered.'),
    // A degraded user collection means sign-in activity was refused, which is exactly
    // the Entra ID P1 case.
    signInActivityAvailable: Boolean(userCollector?.Available && !userCollector.Degraded),
    inventory,
    config: effectiveConfig,
    unassignedSeats: spend.seatsUnassigned,
    unassignedCost: spend.unassignedSeatCost,
    unassignedSeatsPriced: spend.unassignedSeatsPriced,
    unassignedSeatsUnpriced: spend.unassignedSeatsUnpriced,
  });

  // Optional collectors are absent from older snapshots, and an explicitly-undefined
  // entry still shows up in Object.values.
  const collectors: CollectorSummary[] = Object.values(snapshot.Collectors)
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
    name: c.Name,
    available: c.Available,
    degraded: c.Degraded,
    reason: c.Reason ?? (c.Available ? 'Collected without error.' : 'Unavailable.'),
  }));

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    tenant,
    config: effectiveConfig,
    inventory,
    spend,
    seatWaste,
    realization: measureRealization(spend, effectiveConfig),
    provenance: {
      source: snapshot.Source,
      snapshotCollected: snapshot.GeneratedAt,
      collectors,
      extraScopes: snapshot.ScopeAssessment?.ExtraScopes ?? [],
      extraWriteScopes: snapshot.ScopeAssessment?.ExtraWriteScopes ?? [],
    },
  };
}
