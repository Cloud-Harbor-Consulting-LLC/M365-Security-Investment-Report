/**
 * The price table itself.
 *
 * It is a flat array, so the failures it can have are quiet ones. A duplicate part number
 * shadows an earlier entry and nothing says so. A missing entry reads as "this tenant
 * cannot be priced", which is how a Microsoft 365 E7 tenant produced a report with no
 * dollar figure anywhere.
 *
 * These assertions read the raw file rather than the loaded list, because provenance lives
 * in keys beginning with $ and those are stripped before the engine sees them.
 */
import { describe, expect, it } from 'vitest';

import raw from '@data/pricelist.json';

import { listPriceList } from '@/data/reference';

interface RawEntry {
  skuPartNumber?: string;
  monthlyPerSeat?: number;
  securityValueShare?: number;
  $source?: string;
  $confidence?: string;
  $asOf?: string;
}

const entries = (raw as { prices: RawEntry[] }).prices;

describe('the shipped price table', () => {
  it('prices every entry, positively', () => {
    for (const e of entries) {
      expect(e.skuPartNumber, 'every entry needs a part number').toBeTruthy();
      expect(typeof e.monthlyPerSeat, e.skuPartNumber).toBe('number');
      expect(e.monthlyPerSeat, e.skuPartNumber).toBeGreaterThan(0);
    }
  });

  it('names each SKU once', () => {
    // A duplicate shadows silently: the engine takes one and the other never applies.
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(e.skuPartNumber!, (seen.get(e.skuPartNumber!) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('keeps every security share a real fraction', () => {
    for (const e of entries) {
      if (e.securityValueShare === undefined) continue;
      expect(e.securityValueShare, e.skuPartNumber).toBeGreaterThanOrEqual(0);
      expect(e.securityValueShare, e.skuPartNumber).toBeLessThanOrEqual(1);
    }
  });

  it('makes a claimed confidence show its source', () => {
    // The file is seed data as a whole. An entry that claims to have been checked has to
    // say against what, or the claim is worth less than saying nothing.
    for (const e of entries) {
      if (!e.$confidence) continue;
      expect(e.$source, `${e.skuPartNumber} claims confidence but cites nothing`).toBeTruthy();
      expect(e.$asOf, `${e.skuPartNumber} claims confidence but is undated`).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('reaches the engine with the documentation keys removed', () => {
    // stripDocKeys runs over the loaded file. If it ever stopped recursing into the array,
    // $note and $source would travel into exports and into a customer's spreadsheet.
    for (const e of listPriceList.prices as unknown as Record<string, unknown>[]) {
      expect(Object.keys(e).filter((k) => k.startsWith('$'))).toEqual([]);
    }
  });

  it('still carries the suites the report is usually pointed at', () => {
    // A regression here is not a crash, it is a tenant that silently cannot be priced.
    for (const part of ['SPE_E3', 'SPE_E5', 'MICROSOFT_365_E7']) {
      expect(
        listPriceList.prices.some((p) => p.skuPartNumber === part),
        `${part} must stay priced`,
      ).toBe(true);
    }
  });
});
