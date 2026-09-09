/**
 * Saving and reopening a session.
 *
 * The value is narrow and concrete: negotiated prices survive a refresh. What the tests
 * guard is that reopening one produces the same report, and that a file this tool did not
 * write is refused rather than half-read.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';

import { analyze } from './index';
import { buildSession, parseSession, sessionFileName, SESSION_KIND } from './session';
import { clearOverrides, setOverride } from './overrides';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const snapshot = () => {
  const parsed = parseSnapshot(premiumSnapshot);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};

const report = (s: ReturnType<typeof snapshot>, overrides = clearOverrides()) =>
  analyze({
    snapshot: s,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
    overrides,
  });

describe('a session round-trips', () => {
  it('reopens to the same figures, prices included', () => {
    // The whole point: a refresh no longer costs an hour of negotiated rates.
    const s = snapshot();
    let overrides = clearOverrides();
    overrides = setOverride(overrides, 'SPE_E5', 41.5);
    overrides = setOverride(overrides, 'SPE_E3', 22);

    const saved = JSON.parse(JSON.stringify(buildSession(s, overrides, 'contoso.com')));
    const restored = parseSession(saved);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const before = report(s, overrides);
    const after = report(restored.session.snapshot, restored.session.overrides);

    expect(after.spend.annualCommitment).toBeCloseTo(before.spend.annualCommitment!, 6);
    expect(after.spend.pricingProvenance).toBe(before.spend.pricingProvenance);
    expect(after.features.attributedSpend).toBeCloseTo(before.features.attributedSpend!, 6);
    expect(restored.session.sourceLabel).toBe('contoso.com');
  });

  it('keeps the provenance that the prices were user-supplied', () => {
    // A reopened session must not quietly present negotiated rates as list price.
    const s = snapshot();
    const overrides = setOverride(clearOverrides(), 'SPE_E5', 41.5);
    const saved = JSON.parse(JSON.stringify(buildSession(s, overrides, 'contoso.com')));
    const restored = parseSession(saved);
    if (!restored.ok) throw new Error(restored.reason);

    const m = report(restored.session.snapshot, restored.session.overrides);
    expect(m.config.pricing.basis).toBe('CustomNegotiated');
    expect(m.spend.overriddenSkuCount).toBeGreaterThan(0);
  });
});

describe('a session refuses what it cannot vouch for', () => {
  it('tells a raw snapshot apart from a session', () => {
    // Both are JSON a user drops on the same target. Identified by marker, not by shape.
    const r = parseSession(premiumSnapshot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a session file/i);
  });

  it('refuses a session written by a newer build rather than guessing', () => {
    const s = snapshot();
    const saved = { ...buildSession(s, clearOverrides(), 'x'), version: 99 };
    const r = parseSession(saved);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/newer version/i);
  });

  it('validates the embedded snapshot rather than trusting its own output', () => {
    // A session file is not a trusted channel just because this tool wrote it: it has
    // been on disk, and may have been edited or truncated in between.
    const r = parseSession({ kind: SESSION_KIND, version: 1, snapshot: { nonsense: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/could not be read/i);
  });

  it('drops an override with no usable price instead of passing it to the engine', () => {
    // There is no stored "deliberately unpriced" state, so a hand-edited entry degrades
    // to one fewer override rather than to a figure nobody can account for.
    const s = snapshot();
    const saved = {
      ...buildSession(s, clearOverrides(), 'x'),
      overrides: {
        prices: {
          GOOD: { monthlyPerSeat: 10 },
          NEGATIVE: { monthlyPerSeat: -5 },
          TEXT: { monthlyPerSeat: 'free' },
          NOTHING: {},
        },
      },
    };
    const r = parseSession(saved);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.session.overrides.prices)).toEqual(['GOOD']);
  });

  it('survives a session with no overrides at all', () => {
    const s = snapshot();
    const saved = { ...buildSession(s, clearOverrides(), 'x'), overrides: undefined };
    const r = parseSession(saved);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.overrides.prices).toEqual({});
  });
});

describe('the filename says which tenant and when', () => {
  it('slugs the tenant name and stamps the date', () => {
    const name = sessionFileName('Cloud Harbor Consulting LLC', new Date('2026-09-09T12:00:00Z'));
    expect(name).toBe('cloud-harbor-consulting-llc-2026-09-09.m365session.json');
  });

  it('still produces a usable name for an unnamed tenant', () => {
    expect(sessionFileName('', new Date('2026-09-09T00:00:00Z'))).toBe(
      'tenant-2026-09-09.m365session.json',
    );
    expect(sessionFileName('***', new Date('2026-09-09T00:00:00Z'))).toBe(
      'tenant-2026-09-09.m365session.json',
    );
  });
});
