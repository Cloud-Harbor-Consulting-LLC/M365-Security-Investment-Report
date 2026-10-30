/**
 * Comparing the report on screen with an earlier run, from either way in.
 *
 * The hosted app and the one-file report both use this, so the rule that both runs are
 * analysed with the same prices and the same shipped reference data is applied in one
 * place, not kept in agreement across two.
 */
import { compareSnapshots, type ComparisonResult } from '@/engine/compare';
import { parseSession, type Overrides } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

/** Compares an earlier run with the current one, at the current run's prices. */
export function compareWith(baseline: Snapshot, current: Snapshot, overrides: Overrides): ComparisonResult {
  return compareSnapshots({
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
    overrides,
    baseline,
    current,
  });
}

export type EarlierRun = { ok: true; snapshot: Snapshot; note: string | null } | { ok: false; reason: string };

/**
 * Reads a dropped file as an earlier run: a raw snapshot, or the run inside a session.
 *
 * From a session only the run is taken. Its prices are not, because a comparison prices
 * both runs the same way, and the reader is told so rather than left to wonder why the
 * prices they saved with that file do not appear.
 */
export function readEarlierRun(raw: unknown): EarlierRun {
  if (raw === null) return { ok: false, reason: 'That file is not valid JSON.' };

  if (typeof raw === 'object' && 'kind' in (raw as object)) {
    const session = parseSession(raw);
    if (!session.ok) return { ok: false, reason: session.reason };
    const saved = Object.keys(session.session.overrides.prices).length;
    return {
      ok: true,
      snapshot: session.session.snapshot,
      note:
        saved > 0
          ? `That session carried ${saved} price${saved === 1 ? '' : 's'} of its own. They are not used: both runs are priced the same way, at the prices this report uses now.`
          : null,
    };
  }

  const parsed = parseSnapshot(raw);
  return parsed.ok ? { ok: true, snapshot: parsed.snapshot, note: null } : { ok: false, reason: parsed.reason };
}
