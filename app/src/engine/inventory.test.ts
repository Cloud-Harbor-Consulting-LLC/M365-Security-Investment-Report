/**
 * Resolving a subscribed SKU to something a customer recognises.
 *
 * Microsoft's part numbers are internal identifiers, and a report that prints
 * MDATP_XPLAT in a column headed "Product" is asking the reader to do the translation.
 */
import { describe, expect, it } from 'vitest';

import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { humanizePartNumber, resolveInventory } from './inventory';

describe('every part number resolves to a product name', () => {
  it('carries Microsoft official display names, not just our curated ones', () => {
    // The complaint that produced this: the Product column showed raw part numbers like
    // MDATP_XPLAT and IDENTITY_THREAT_PROTECTION. The catalogue held 51 hand-written
    // entries against the 619 SKUs Microsoft publishes.
    expect(catalog.skus.length).toBeGreaterThan(600);
    const byPart = new Map(catalog.skus.map((s) => [s.skuPartNumber, s]));
    expect(byPart.get('MDATP_XPLAT')?.displayName).toBe('Microsoft Defender for Endpoint P2');
    expect(byPart.get('IDENTITY_THREAT_PROTECTION')?.displayName).toBe('Microsoft 365 E5 Security');
    expect(byPart.get('SPB')?.displayName).toBe('Microsoft 365 Business Premium');
  });

  it('keeps our curated entry when it beats the official one', () => {
    // Microsoft's own list calls INTUNE_A simply "Intune", where the product a tenant
    // buys is Intune Plan 1. Curated entries win on conflict for exactly this reason,
    // and they carry the naming traps the official list has no field for.
    const byPart = new Map(catalog.skus.map((s) => [s.skuPartNumber, s]));
    expect(byPart.get('INTUNE_A')?.displayName).toBe('Microsoft Intune Plan 1');
    expect(byPart.get('O365_BUSINESS_PREMIUM')?.trap).toBeTruthy();
  });

  it('resolves by GUID when the part number does not match', () => {
    // Part numbers vary between tenants in spacing and case; GUIDs do not.
    const entry = catalog.skus.find((s) => s.skuPartNumber === 'SPB')!;
    const rows = resolveInventory(
      [
        {
          SkuId: entry.skuId!,
          SkuPartNumber: 'spb_with_different_spacing',
          AppliesTo: 'User',
          CapabilityStatus: 'Enabled',
          ConsumedUnits: 1,
          PrepaidEnabled: 1,
          PrepaidSuspended: 0,
          PrepaidWarning: 0,
          ServicePlans: [],
        },
      ],
      cloneConfig(),
      catalog,
      listPriceList,
    );
    expect(rows[0]!.displayName).toBe('Microsoft 365 Business Premium');
    expect(rows[0]!.inCatalog).toBe(true);
  });
});

describe('a part number Microsoft does not publish', () => {
  it('is formatted, never invented', () => {
    // Newer and partner SKUs reach tenants before the licensing reference. Formatting
    // Microsoft's own identifier is honest; quoting a product name from a licensing blog
    // would not be.
    expect(humanizePartNumber('MICROSOFT_AGENT_365_TIER_3')).toBe('Microsoft Agent 365 Tier 3');
    expect(humanizePartNumber('Dynamics_365_Business_Central_Partner_Sandbox')).toBe(
      'Dynamics 365 Business Central Partner Sandbox',
    );
  });

  it('leaves acronyms and already-readable identifiers alone', () => {
    expect(humanizePartNumber('POWERAUTOMATE_ATTENDED_RPA')).toBe('Powerautomate Attended RPA');
    expect(humanizePartNumber('Microsoft_365_Copilot')).toBe('Microsoft 365 Copilot');
  });

  it('is still flagged as absent from the catalogue', () => {
    const rows = resolveInventory(
      [
        {
          SkuId: 'no-such-guid',
          SkuPartNumber: 'SOME_FUTURE_SKU_TIER_9',
          AppliesTo: 'User',
          CapabilityStatus: 'Enabled',
          ConsumedUnits: 1,
          PrepaidEnabled: 1,
          PrepaidSuspended: 0,
          PrepaidWarning: 0,
          ServicePlans: [],
        },
      ],
      cloneConfig(),
      catalog,
      listPriceList,
    );
    // A tidied string must never read as a catalogue match.
    expect(rows[0]!.displayName).toBe('Some Future SKU Tier 9');
    expect(rows[0]!.inCatalog).toBe(false);
    expect(rows[0]!.family).toBe('Unrecognized');
  });
});

describe('display names are product names, not identifiers', () => {
  it('drops the internal suffixes Microsoft appends to its own display names', () => {
    // Microsoft's list ships "Microsoft Defender for Endpoint P2_XPLAT" and
    // "Microsoft 365 E3 (500 seats min)_HUB". _XPLAT and _HUB mean something inside
    // Microsoft and nothing in a column headed Product.
    const byPart = new Map(catalog.skus.map((s) => [s.skuPartNumber, s]));
    expect(byPart.get('MDATP_XPLAT')?.displayName).toBe('Microsoft Defender for Endpoint P2');
    expect(byPart.get('Microsoft_365_E5')?.displayName).toBe('Microsoft 365 E5 (500 seats min)');
  });

  it('keeps sovereign-cloud markers, because those are different products', () => {
    // A GCC High E3 is not a commercial E3. Stripping the marker would merge two SKUs
    // that a customer buys separately and pays differently for.
    const byPart = new Map(catalog.skus.map((s) => [s.skuPartNumber, s]));
    expect(byPart.get('SPE_E3_USGOV_GCCHIGH')?.displayName).toBe('Microsoft 365 E3 (GCC High)');
    expect(byPart.get('ENTERPRISEPACK_USGOV_DOD')?.displayName).toBe('Office 365 E3 (DoD)');
  });

  it('leaves no underscore in any display name', () => {
    // The class, not the instance: one reported row was P2_XPLAT, and the same defect
    // sat in 50 entries.
    const leaking = catalog.skus.filter((s) => s.displayName.includes('_'));
    expect(leaking.map((s) => s.skuPartNumber)).toEqual([]);
  });

  it('trims the part numbers Microsoft ships with stray whitespace', () => {
    // Five arrive padded, one with a tab. An exact-match lookup would miss all of them
    // and the row would fall through to the formatted fallback for no visible reason.
    const untrimmed = catalog.skus.filter((s) => s.skuPartNumber !== s.skuPartNumber.trim());
    expect(untrimmed.map((s) => s.skuPartNumber)).toEqual([]);
  });
});
