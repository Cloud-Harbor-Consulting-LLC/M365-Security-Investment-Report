/**
 * Price overrides.
 *
 * The case that drove the design: both real tenants tested against had no priceable SKU
 * at all, so every dollar figure read "Not available". Supplying a price for a SKU the
 * shipped table has never heard of is not a convenience — it is what makes those tenants
 * analysable.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze, applyOverrides, clearOverrides, setOverride, type Overrides } from './index';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const run = (raw: unknown, overrides?: Overrides) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, overrides });
};

describe('pricing a tenant the shipped table cannot price', () => {
  it('produces no spend figure without overrides', () => {
    const model = run(unpricedSnapshot);
    expect(model.spend.anyPriced).toBe(false);
    expect(model.spend.annualCommitment).toBeNull();
  });

  it('produces one as soon as a price is supplied', () => {
    // PREVIEW_SKU_NOT_IN_CATALOG: 1 purchased, 1 assigned, at $10/month.
    const overrides = setOverride(clearOverrides(), 'PREVIEW_SKU_NOT_IN_CATALOG', 10);
    const model = run(unpricedSnapshot, overrides);

    expect(model.spend.anyPriced).toBe(true);
    expect(model.spend.annualCommitment).toBe(120);
    expect(model.spend.annualSpendConsumed).toBe(120);
    expect(model.spend.unassignedSeatCost).toBe(0);
  });

  it('prices every unpriced SKU when all are supplied', () => {
    // 1 seat at $10 + 25 seats at $4 = 120 + 1200 committed.
    let overrides = setOverride(clearOverrides(), 'PREVIEW_SKU_NOT_IN_CATALOG', 10);
    overrides = setOverride(overrides, 'ANOTHER_PREVIEW_ADDON', 4);
    const model = run(unpricedSnapshot, overrides);

    expect(model.spend.skuCountUnpriced).toBe(0);
    expect(model.spend.complete).toBe(true);
    expect(model.spend.annualCommitment).toBe(120 + 25 * 48);
    expect(model.spend.unassignedSeatCost).toBe(25 * 48);
  });

  it('lifts the dominance caveat once the seats can be valued', () => {
    let overrides = setOverride(clearOverrides(), 'PREVIEW_SKU_NOT_IN_CATALOG', 10);
    overrides = setOverride(overrides, 'ANOTHER_PREVIEW_ADDON', 4);
    expect(run(unpricedSnapshot, overrides).realization.seat.caveat).toBeNull();
    expect(run(unpricedSnapshot).realization.seat.caveat).toMatch(/dominated by/i);
  });
});

describe('replacing a list price with a negotiated one', () => {
  it('recalculates every dependent figure', () => {
    const base = run(premiumSnapshot);
    expect(base.spend.annualCommitment).toBe(221430);

    // E5 from $57 to $44: 120 seats x 12 x $13 less.
    const model = run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 44));
    expect(model.spend.annualCommitment).toBe(221430 - 120 * 12 * 13);
    expect(model.spend.annualSpendConsumed).toBe(194694 - 96 * 12 * 13);
    expect(model.spend.unassignedSeatCost).toBe(26736 - 24 * 12 * 13);
  });

  it('marks which rows carry a supplied price', () => {
    const model = run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 44));
    const e5 = model.inventory.find((r) => r.skuPartNumber === 'SPE_E5');
    const e3 = model.inventory.find((r) => r.skuPartNumber === 'SPE_E3');
    expect(e5?.priceOverridden).toBe(true);
    expect(e3?.priceOverridden).toBe(false);
  });

  it('keeps the shipped table untouched, so resetting is just discarding', () => {
    const before = listPriceList.prices.find((p) => p.skuPartNumber === 'SPE_E5')?.monthlyPerSeat;
    run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 44));
    const after = listPriceList.prices.find((p) => p.skuPartNumber === 'SPE_E5')?.monthlyPerSeat;
    expect(after).toBe(before);
    expect(run(premiumSnapshot).spend.annualCommitment).toBe(221430);
  });
});

describe('pricing basis is stated honestly', () => {
  it('reads as list price when nothing is overridden', () => {
    const model = run(premiumSnapshot);
    expect(model.spend.pricingProvenance).toBe('list');
    expect(model.spend.basisLabel).toMatch(/Microsoft public list price/);
    expect(model.spend.pricingWarning).toBeTruthy();
  });

  it('names the mixed case rather than overclaiming', () => {
    // Overriding one of five priced SKUs is neither list nor negotiated.
    const model = run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 44));
    expect(model.spend.pricingProvenance).toBe('mixed');
    expect(model.spend.overriddenSkuCount).toBe(1);
    expect(model.spend.basisLabel).toBe(
      'Mixed — 1 of 5 priced SKUs at customer-supplied rates, the rest at Microsoft list price',
    );
  });

  it('drops the seed-data warning only when every price came from the user', () => {
    let overrides = clearOverrides();
    for (const part of ['SPE_E5', 'SPE_E3', 'AAD_PREMIUM', 'ATP_ENTERPRISE', 'O365_BUSINESS_PREMIUM']) {
      overrides = setOverride(overrides, part, 10);
    }
    const model = run(premiumSnapshot, overrides);

    expect(model.spend.pricingProvenance).toBe('negotiated');
    expect(model.spend.basisLabel).toBe('Customer-supplied rates');
    // The seed-price warning describes the shipped table, which no longer supplies these.
    expect(model.spend.pricingWarning).toBeNull();
  });
});

describe('override bookkeeping', () => {
  it('clears an override when the value is not a usable price', () => {
    const set = setOverride(clearOverrides(), 'SPE_E5', 44);
    expect(setOverride(set, 'SPE_E5', null).prices).toEqual({});
    expect(setOverride(set, 'SPE_E5', -1).prices).toEqual({});
    expect(setOverride(set, 'SPE_E5', Number.NaN).prices).toEqual({});
  });

  it('accepts zero as a real price rather than treating it as absent', () => {
    // A SKU genuinely bundled at no cost is a legitimate answer, and different from
    // "we do not know what this costs".
    const model = run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E5', 0));
    expect(model.spend.skuCountUnpriced).toBe(1); // still only CONTOSO_CUSTOM_ADDON
    expect(model.spend.annualCommitment).toBe(221430 - 120 * 12 * 57);
  });

  it('does not mutate the overrides it is given', () => {
    const original = setOverride(clearOverrides(), 'SPE_E5', 44);
    const next = setOverride(original, 'SPE_E3', 30);
    expect(Object.keys(original.prices)).toEqual(['SPE_E5']);
    expect(Object.keys(next.prices).sort()).toEqual(['SPE_E3', 'SPE_E5']);
  });

  it('appends a SKU the shipped table has never heard of', () => {
    const merged = applyOverrides(listPriceList, setOverride(clearOverrides(), 'MICROSOFT_365_E7', 62));
    expect(merged.prices.find((p) => p.skuPartNumber === 'MICROSOFT_365_E7')?.monthlyPerSeat).toBe(62);
    expect(merged.prices.length).toBe(listPriceList.prices.length + 1);
  });

  it('keeps the shipped security value share when only the price is overridden', () => {
    const merged = applyOverrides(listPriceList, setOverride(clearOverrides(), 'SPE_E5', 44));
    const e5 = merged.prices.find((p) => p.skuPartNumber === 'SPE_E5');
    expect(e5?.monthlyPerSeat).toBe(44);
    expect(e5?.securityValueShare).toBe(0.4);
  });
});
