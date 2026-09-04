/**
 * Seat realization is arithmetically correct even when it is materially misleading.
 *
 * The demo tenant made this concrete: 25 of its 26 purchased seats were a single
 * unrecognised, unpriced preview SKU, so the board reported "4% seat realization" on a
 * denominator almost entirely composed of licences nobody was ever going to assign.
 *
 * The chosen remedy is disclosure, not adjustment. Excluding those seats would flatter
 * the number and would hide genuine waste in a customer tenant, so the figure stands and
 * carries a caveat.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';

import { analyze } from './index';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const run = (raw: unknown, tweak?: (c: ReturnType<typeof cloneConfig>) => void) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const config = cloneConfig();
  tweak?.(config);
  return analyze({ snapshot: parsed.snapshot, config, catalog, priceList: listPriceList });
};

describe('unpriced seat dominance', () => {
  it('caveats the figure when unpriced SKUs dominate the seat count', () => {
    const model = run(unpricedSnapshot);

    // 25 of 26 seats are the unpriced preview SKU.
    expect(model.spend.seatsUnpriced).toBe(26);
    expect(model.spend.unpricedSeatShare).toBe(1);
    expect(model.realization.seat.caveat).toMatch(/dominated by/i);
    expect(model.realization.seat.caveat).toMatch(/26 of 26 purchased seats/);
  });

  it('leaves the figure uncaveated when pricing covers most seats', () => {
    const model = run(premiumSnapshot);

    // 40 of 635 seats are unpriced — well under the threshold.
    expect(model.spend.seatsUnpriced).toBe(40);
    expect(model.spend.unpricedSeatShare).toBeCloseTo(0.063, 3);
    expect(model.realization.seat.caveat).toBeNull();
  });

  it('still reports the real percentage rather than adjusting it', () => {
    // Disclosure, not correction: removing real allocations to flatter the headline
    // would hide genuine waste.
    const model = run(unpricedSnapshot);
    expect(model.realization.seat.ratio).toBeCloseTo(1 / 26, 4);
    expect(model.realization.seat.available).toBe(true);
  });

  it('honours the configured threshold', () => {
    const strict = run(premiumSnapshot, (c) => {
      c.reporting.unpricedSeatDominanceThreshold = 0.05;
    });
    expect(strict.realization.seat.caveat).toMatch(/dominated by/i);

    const lax = run(unpricedSnapshot, (c) => {
      c.reporting.unpricedSeatDominanceThreshold = 1;
    });
    expect(lax.realization.seat.caveat).toBeNull();
  });

  it('reports no share when nothing was purchased', () => {
    const empty = run({
      ...(unpricedSnapshot as Record<string, unknown>),
      Collectors: {
        ...(unpricedSnapshot as { Collectors: Record<string, unknown> }).Collectors,
        subscribedSkus: {
          ...(unpricedSnapshot as { Collectors: { subscribedSkus: Record<string, unknown> } }).Collectors
            .subscribedSkus,
          Data: [],
        },
      },
    });
    expect(empty.spend.unpricedSeatShare).toBeNull();
    expect(empty.realization.seat.caveat).toBeNull();
  });
});
