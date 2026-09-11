/**
 * Loads the shipped reference data.
 *
 * These import the actual files the PowerShell module ships, not copies of them. If a SKU is
 * added to the catalog, both tiers see it in the same commit. That is the whole reason
 * the app and the module live in one repository.
 */
import catalogJson from '@data/sku-catalog.json';
import priceListJson from '@data/pricelist.json';
import defaultConfigJson from '@data/default-config.json';
import featureMapJson from '@data/feature-map.json';
import riskModelJson from '@data/risk-model.json';

import { stripDocKeys, type Config, type PriceList, type SkuCatalog } from '@/model/reference';
import type { FeatureMap } from '@/engine/features';
import type { RiskModel } from '@/engine/risk';

// Every file, not only the config. These carry documentation in keys beginning with $:
// why a control maps to the service plan it does, where a price came from, what a marker
// pattern is for. Only default-config.json was being stripped, so the rest of that prose
// travelled into the engine and sat in memory beside the data it describes. Stripping all
// of them makes the $ convention mean the same thing in every reference file, which is
// what lets a price carry its source without changing the runtime shape.
export const catalog = stripDocKeys(catalogJson as SkuCatalog);
export const listPriceList = stripDocKeys(priceListJson as PriceList);
export const featureMap = stripDocKeys(featureMapJson as unknown as FeatureMap);
export const riskModel = stripDocKeys(riskModelJson as unknown as RiskModel);
export const defaultConfig = stripDocKeys(defaultConfigJson as unknown as Config);

/** A deep-enough clone so callers can apply overrides without mutating the defaults. */
export function cloneConfig(config: Config = defaultConfig): Config {
  return structuredClone(config);
}
