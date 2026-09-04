/**
 * Loads the shipped reference data.
 *
 * These import the actual files the PowerShell module ships — not copies. If a SKU is
 * added to the catalog, both tiers see it in the same commit. That is the whole reason
 * the app and the module live in one repository.
 */
import catalogJson from '@data/sku-catalog.json';
import priceListJson from '@data/pricelist.json';
import defaultConfigJson from '@data/default-config.json';

import { stripDocKeys, type Config, type PriceList, type SkuCatalog } from '@/model/reference';

export const catalog = catalogJson as SkuCatalog;
export const listPriceList = priceListJson as PriceList;
export const defaultConfig = stripDocKeys(defaultConfigJson as unknown as Config);

/** A deep-enough clone so callers can apply overrides without mutating the defaults. */
export function cloneConfig(config: Config = defaultConfig): Config {
  return structuredClone(config);
}
