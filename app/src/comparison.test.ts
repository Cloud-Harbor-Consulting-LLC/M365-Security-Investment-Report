/**
 * Reading an earlier run from a dropped file, and comparing at the current prices.
 *
 * The rule under test is the one that keeps a comparison honest from the outside: a
 * session dropped as the earlier run contributes its run and not its prices, and the
 * reader is told.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import baselineSnapshot from '@fixtures/premium-baseline-snapshot.json';

import { compareWith, readEarlierRun } from './comparison';
import { buildSession, clearOverrides, setOverride } from '@/engine';
import { parseSnapshot } from '@/model/snapshot';

const snap = (raw: unknown) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};

describe('reading an earlier run', () => {
  it('takes a raw snapshot as it is', () => {
    const r = readEarlierRun(baselineSnapshot);
    expect(r.ok && r.snapshot.GeneratedAt).toBe('2026-06-03T18:00:00Z');
    expect(r.ok && r.note).toBeNull();
  });

  it('takes the run from a session and leaves its prices behind, saying so', () => {
    const session = JSON.parse(
      JSON.stringify(buildSession(snap(baselineSnapshot), setOverride(clearOverrides(), 'SPE_E5', 44), 'june')),
    );
    const r = readEarlierRun(session);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.GeneratedAt).toBe('2026-06-03T18:00:00Z');
    expect(r.note).toMatch(/carried 1 price of its own\. They are not used/);
  });

  it('refuses a file that is not JSON', () => {
    const r = readEarlierRun(null);
    expect(!r.ok && r.reason).toMatch(/not valid JSON/);
  });

  it('refuses a file that is neither a snapshot nor a session', () => {
    const r = readEarlierRun({ hello: 'world' });
    expect(r.ok).toBe(false);
  });
});

describe('comparing at the prices the report uses now', () => {
  it('prices the earlier run with the overrides in force', () => {
    // E5 at 44: the 20 extra seats add 20 x 44 x 12 = 10,560; EMS subtracts 5,760.
    const r = compareWith(snap(baselineSnapshot), snap(premiumSnapshot), setOverride(clearOverrides(), 'SPE_E5', 44));
    expect(r.ok && r.comparison.headline.annualCommitment.change).toBe(10560 - 5760);
  });
});
