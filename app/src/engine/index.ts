import type { OrganizationData, Snapshot } from '@/model/snapshot';
import type { Config, PriceList, SkuCatalog } from '@/model/reference';
import { resolveInventory, type InventoryRow } from './inventory';
import { measureRealization, measureSpend, type Realization, type Spend } from './spend';

export * from './inventory';
export * from './spend';

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
}

/**
 * Snapshot + reference data + config → report model.
 *
 * Pure: no network, no clock beyond a single generatedAt stamp, no I/O. That is what
 * makes it safe to re-run on every keystroke when a price is overridden, and what lets
 * the fixture tests be genuine end-to-end coverage.
 */
export function analyze({ snapshot, config, catalog, priceList }: AnalyzeInput): ReportModel {
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

  const inventory = resolveInventory(skuCollector.Data, config, catalog, priceList);
  const spend = measureSpend(inventory, config, priceList);

  const collectors: CollectorSummary[] = Object.values(snapshot.Collectors).map((c) => ({
    name: c.Name,
    available: c.Available,
    degraded: c.Degraded,
    reason: c.Reason ?? (c.Available ? 'Collected without error.' : 'Unavailable.'),
  }));

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    tenant,
    config,
    inventory,
    spend,
    realization: measureRealization(spend),
    provenance: {
      source: snapshot.Source,
      snapshotCollected: snapshot.GeneratedAt,
      collectors,
      extraScopes: snapshot.ScopeAssessment?.ExtraScopes ?? [],
      extraWriteScopes: snapshot.ScopeAssessment?.ExtraWriteScopes ?? [],
    },
  };
}
