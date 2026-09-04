/**
 * Reference data and configuration — the shipped JSON that the PowerShell module and
 * this engine both read. camelCase here, because these files are hand-authored JSON
 * rather than PowerShell output.
 */

export interface CatalogSku {
  skuPartNumber: string;
  displayName: string;
  family: string;
  isFree?: boolean;
  /** Set where Microsoft's part number disagrees with the product's marketing name. */
  trap?: string;
  retired?: boolean;
  note?: string;
}

export interface SkuCatalog {
  schemaVersion: string;
  updated: string;
  skus: CatalogSku[];
}

export interface PriceEntry {
  skuPartNumber: string;
  monthlyPerSeat: number;
  securityValueShare?: number;
}

export interface PriceList {
  schemaVersion: string;
  basis: string;
  currency: string;
  asOf: string;
  /** False for the shipped seed prices. Drives a prominent warning in the report. */
  verified: boolean;
  verificationWarning?: string;
  defaultSecurityValueShare?: number;
  prices: PriceEntry[];
}

export interface Config {
  pricing: {
    basis: string;
    currency: string;
    customPricingPath: string | null;
  };
  inactivity: { thresholdDays: number };
  exemptions: {
    userPrincipalNames: string[];
    displayNamePatterns: string[];
    userTypes: string[];
  };
  skus: {
    unlimitedSeatThreshold: number;
    unrecognizedSeatThreshold: number;
    excludeSkuPartNumbers: string[];
  };
  risk: { annualLikelihood: number; impactUsd: number };
  report: {
    organizationName: string | null;
    preparedFor: string | null;
    preparedBy: string | null;
    includeArchitectAppendix: boolean;
  };
  reporting: {
    /**
     * Share of purchased seats coming from unpriced SKUs above which seat realization
     * carries an explicit caveat. Disclosure rather than silent adjustment.
     */
    unpricedSeatDominanceThreshold: number;
  };
}

/** Strips the `$`-prefixed documentation keys the shared JSON files carry. */
export function stripDocKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripDocKeys) as unknown as T;
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    out[key] = stripDocKeys(inner);
  }
  return out as T;
}
