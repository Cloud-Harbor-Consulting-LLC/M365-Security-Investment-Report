/**
 * Two runs of the same tenant, compared.
 *
 * The question this answers is the one a quarterly review asks: since we last looked, what
 * did this organisation change, and what is it worth? Spend realized moving from 30% to
 * 39% is the headline; the controls behind it, the licences bought and dropped, and the
 * waste that grew or shrank are the evidence.
 *
 * Two rules keep every difference honest.
 *
 * Both runs are analysed with the same prices and the same reference data. Otherwise a
 * price increase, or a correction to the entitlement map, would show up as something the
 * tenant did. compareSnapshots() is the only way in that guarantees this, because it
 * analyses both runs with one set of inputs; compareRuns() trusts its caller to have done
 * the same.
 *
 * A figure that could not be measured in either run is not comparable, and says why. It
 * is never compared as zero: "we could not look" in June and "we looked" in September is
 * not an improvement.
 *
 * Not re-exported from the engine barrel: this module calls analyze(), and the barrel
 * re-exporting it would make the import circular. Import it by path.
 */
import { analyze, type AnalyzeInput, type DeploymentState, type ReportModel } from './index';
import type { Snapshot } from '@/model/snapshot';

/** A figure in both runs. The change is null whenever either side is unknown. */
export interface Change {
  before: number | null;
  after: number | null;
  change: number | null;
}

export type ControlMovement = 'closed' | 'regressed' | 'improved' | 'appeared' | 'retired' | 'unchanged';

export interface ControlChange {
  controlName: string;
  displayName: string;
  service: string;
  movement: ControlMovement;
  stateBefore: DeploymentState | null;
  stateAfter: DeploymentState | null;
  score: Change;
  /** The later run's maximum where it has one, since that is what the control is worth now. */
  maxScore: number;
}

export type LicenceMovement = 'added' | 'removed' | 'changed';

export interface LicenceChange {
  skuPartNumber: string;
  displayName: string;
  movement: LicenceMovement;
  purchased: Change;
  assigned: Change;
  annualCommitment: Change;
}

export interface WasteChange {
  id: string;
  label: string;
  comparable: boolean;
  /** Why not, when it is not. */
  reason: string | null;
  seats: Change;
  annualCost: Change;
}

export interface RunComparison {
  tenantId: string;
  tenantName: string;
  baselineCollected: string;
  currentCollected: string;
  daysBetween: number;
  headline: {
    spendRealized: Change;
    seatRealization: Change;
    featureRealization: Change;
    securePoints: Change;
    secureMax: Change;
    annualCommitment: Change;
    annualSpendConsumed: Change;
    idleSeatCost: Change;
    seatsPurchased: Change;
    seatsAssigned: Change;
    seatsUnassigned: Change;
    wasteTotal: Change;
    riskRetained: Change;
  };
  /** Every control that moved, most consequential first. Unchanged controls are counted, not listed. */
  controls: ControlChange[];
  controlCounts: Record<ControlMovement, number>;
  licences: LicenceChange[];
  waste: WasteChange[];
  /** What could not be compared, and why. Shown wherever the comparison is. */
  notComparable: string[];
}

export type ComparisonResult = { ok: true; comparison: RunComparison } | { ok: false; reason: string };

const DAY = 86_400_000;

const change = (before: number | null | undefined, after: number | null | undefined): Change => {
  const b = before ?? null;
  const a = after ?? null;
  return { before: b, after: a, change: b === null || a === null ? null : a - b };
};

const ratio = (score: number, max: number): number | null => (max > 0 ? score / max : null);

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Order for the controls list: what a reader most needs to see first. */
const MOVEMENT_ORDER: ControlMovement[] = ['regressed', 'closed', 'improved', 'appeared', 'retired', 'unchanged'];

/**
 * Compares 2 analysed runs. The caller must have analysed both with the same prices and
 * reference data; compareSnapshots() does that and is what the app should call.
 */
export function compareRuns(baseline: ReportModel, current: ReportModel): ComparisonResult {
  if (baseline.tenant.TenantId !== current.tenant.TenantId) {
    return {
      ok: false,
      reason: `That run is from a different tenant (${baseline.tenant.DisplayName}), so it cannot be compared with ${current.tenant.DisplayName}. Compare 2 runs of the same tenant.`,
    };
  }

  const before = Date.parse(baseline.provenance.snapshotCollected);
  const after = Date.parse(current.provenance.snapshotCollected);
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return { ok: false, reason: 'One of the runs carries no collection date, so the order between them cannot be known.' };
  }
  if (before >= after) {
    return {
      ok: false,
      reason:
        before === after
          ? 'That is the same run as the one open now, so there is nothing to compare.'
          : `That run was collected on ${shortDate(baseline.provenance.snapshotCollected)}, after the one open now (${shortDate(current.provenance.snapshotCollected)}). Open the later run, then compare it with this one.`,
    };
  }

  const notComparable: string[] = [];

  // Realization. A component unavailable in either run is not comparable.
  const realized = (pick: (m: ReportModel) => { available: boolean; ratio: number | null }) => {
    const b = pick(baseline);
    const a = pick(current);
    return change(b.available ? b.ratio : null, a.available ? a.ratio : null);
  };

  // Secure Score is the evidence behind every control movement.
  const scoreBefore = baseline.features.available;
  const scoreAfter = current.features.available;
  if (!scoreBefore || !scoreAfter) {
    notComparable.push(
      `Secure Score was not collected in the ${!scoreBefore ? 'earlier' : 'later'} run, so control changes and feature realization cannot be compared.`,
    );
  }

  const controls = scoreBefore && scoreAfter ? compareControls(baseline, current) : [];
  const controlCounts = Object.fromEntries(MOVEMENT_ORDER.map((m) => [m, 0])) as Record<ControlMovement, number>;
  for (const c of controls) controlCounts[c.movement] += 1;

  // Waste, category by category. A category measured in one run only is not comparable,
  // and then neither is the total.
  const waste: WasteChange[] = current.seatWaste.categories.map((cat) => {
    const prior = baseline.seatWaste.categories.find((c) => c.id === cat.id);
    const comparable = Boolean(prior?.available && cat.available);
    let reason: string | null = null;
    if (!comparable) {
      const before = Boolean(prior?.available);
      const where = !before && !cat.available ? 'either run' : !before ? 'the earlier run' : 'the later run';
      const why = (!before ? prior?.unavailableReason : cat.unavailableReason) ?? 'It was not measured.';
      reason = `Not measured in ${where}. ${why}`;
    }
    return {
      id: cat.id,
      label: cat.label,
      comparable,
      reason,
      seats: comparable ? change(prior!.seats, cat.seats) : change(null, null),
      annualCost: comparable ? change(prior!.annualCost, cat.annualCost) : change(null, null),
    };
  });
  // A category measured in one run only cannot be compared. One measured in neither is
  // simply not measured, which the waste view already says, so it is not listed here.
  const measuredIn = (m: ReportModel, id: string) =>
    Boolean(m.seatWaste.categories.find((c) => c.id === id)?.available);
  const ids = new Set([...baseline.seatWaste.categories, ...current.seatWaste.categories].map((c) => c.id));
  let sameScope = true;
  for (const id of ids) {
    if (measuredIn(baseline, id) !== measuredIn(current, id)) {
      sameScope = false;
      const w = waste.find((x) => x.id === id);
      if (w) notComparable.push(`${w.label}: ${w.reason}`);
    }
  }
  // Totals over different sets of categories would compare unlike with unlike.
  const wasteTotal = sameScope
    ? change(baseline.seatWaste.totalAnnualCost, current.seatWaste.totalAnnualCost)
    : change(null, null);
  if (!sameScope) {
    notComparable.push('The 2 runs measured different waste categories, so the waste total is not compared.');
  }

  const riskComparable = baseline.risk.available && current.risk.available;
  if (!riskComparable) {
    notComparable.push('Risk could not be calculated in both runs, so retained risk is not compared.');
  }

  return {
    ok: true,
    comparison: {
      tenantId: current.tenant.TenantId,
      tenantName: current.tenant.DisplayName,
      baselineCollected: baseline.provenance.snapshotCollected,
      currentCollected: current.provenance.snapshotCollected,
      daysBetween: Math.floor((after - before) / DAY),
      headline: {
        spendRealized: realized((m) => m.realization.composite),
        seatRealization: realized((m) => m.realization.seat),
        featureRealization: realized((m) => m.realization.feature),
        securePoints: change(baseline.features.currentScore, current.features.currentScore),
        secureMax: change(baseline.features.maxScore, current.features.maxScore),
        annualCommitment: change(baseline.spend.annualCommitment, current.spend.annualCommitment),
        annualSpendConsumed: change(baseline.spend.annualSpendConsumed, current.spend.annualSpendConsumed),
        idleSeatCost: change(baseline.spend.unassignedSeatCost, current.spend.unassignedSeatCost),
        seatsPurchased: change(baseline.spend.seatsPurchased, current.spend.seatsPurchased),
        seatsAssigned: change(baseline.spend.seatsConsumed, current.spend.seatsConsumed),
        seatsUnassigned: change(baseline.spend.seatsUnassigned, current.spend.seatsUnassigned),
        wasteTotal,
        riskRetained: riskComparable
          ? change(baseline.risk.retainedAnnual, current.risk.retainedAnnual)
          : change(null, null),
      },
      controls: controls.filter((c) => c.movement !== 'unchanged'),
      controlCounts,
      licences: compareLicences(baseline, current),
      waste,
      notComparable,
    },
  };
}

function compareControls(baseline: ReportModel, current: ReportModel): ControlChange[] {
  const prior = new Map(baseline.features.rows.map((r) => [r.controlName, r]));
  const now = new Map(current.features.rows.map((r) => [r.controlName, r]));
  const names = new Set([...prior.keys(), ...now.keys()]);
  const out: ControlChange[] = [];

  for (const name of names) {
    const b = prior.get(name);
    const a = now.get(name);
    const row = (a ?? b)!;

    let movement: ControlMovement;
    if (!b) movement = 'appeared';
    else if (!a) movement = 'retired';
    else {
      // By share of the maximum rather than by points, so a control Microsoft re-weights
      // between runs does not read as something the tenant changed.
      const rb = ratio(b.score, b.maxScore) ?? 0;
      const ra = ratio(a.score, a.maxScore) ?? 0;
      if (ra < rb) movement = 'regressed';
      else if (a.state === 'deployed' && b.state !== 'deployed') movement = 'closed';
      else if (ra > rb) movement = 'improved';
      else movement = 'unchanged';
    }

    out.push({
      controlName: name,
      displayName: row.displayName,
      service: row.service,
      movement,
      stateBefore: b?.state ?? null,
      stateAfter: a?.state ?? null,
      score: change(b?.score, a?.score),
      maxScore: a?.maxScore ?? b!.maxScore,
    });
  }

  // Grouped by movement, then the biggest swing in points first within each group.
  const swing = (c: ControlChange) => Math.abs(c.score.change ?? c.score.after ?? c.score.before ?? 0);
  return out.sort(
    (x, y) =>
      MOVEMENT_ORDER.indexOf(x.movement) - MOVEMENT_ORDER.indexOf(y.movement) ||
      swing(y) - swing(x) ||
      x.controlName.localeCompare(y.controlName),
  );
}

function compareLicences(baseline: ReportModel, current: ReportModel): LicenceChange[] {
  // Free SKUs reporting unlimited seats are excluded from the analysis, and from this.
  const billable = (m: ReportModel) => new Map(m.inventory.filter((r) => !r.excluded).map((r) => [r.skuPartNumber, r]));
  const prior = billable(baseline);
  const now = billable(current);
  const out: LicenceChange[] = [];

  for (const part of new Set([...prior.keys(), ...now.keys()])) {
    const b = prior.get(part);
    const a = now.get(part);
    const movement: LicenceMovement | null = !b
      ? 'added'
      : !a
        ? 'removed'
        : b.purchasedUnits !== a.purchasedUnits || b.consumedUnits !== a.consumedUnits
          ? 'changed'
          : null;
    if (!movement) continue;

    out.push({
      skuPartNumber: part,
      displayName: (a ?? b)!.displayName,
      movement,
      purchased: change(b?.purchasedUnits ?? 0, a?.purchasedUnits ?? 0),
      assigned: change(b?.consumedUnits ?? 0, a?.consumedUnits ?? 0),
      annualCommitment: change(
        b ? b.annualCommitment : 0,
        a ? a.annualCommitment : 0,
      ),
    });
  }

  const order: LicenceMovement[] = ['added', 'removed', 'changed'];
  return out.sort(
    (x, y) =>
      order.indexOf(x.movement) - order.indexOf(y.movement) ||
      Math.abs(y.annualCommitment.change ?? 0) - Math.abs(x.annualCommitment.change ?? 0) ||
      x.skuPartNumber.localeCompare(y.skuPartNumber),
  );
}

/**
 * Analyses 2 snapshots with one set of prices and reference data, then compares them.
 *
 * This is the guarantee that a difference is something the tenant did: the earlier run is
 * priced at today's rates, with today's entitlement map, exactly as the later one is.
 * Prices saved inside an older session file are therefore not used for the comparison.
 */
export function compareSnapshots(
  input: Omit<AnalyzeInput, 'snapshot'> & { baseline: Snapshot; current: Snapshot },
): ComparisonResult {
  const { baseline, current, ...shared } = input;
  let before: ReportModel;
  try {
    before = analyze({ ...shared, snapshot: baseline });
  } catch (e) {
    return { ok: false, reason: `The earlier run could not be analysed. ${e instanceof Error ? e.message : String(e)}` };
  }
  return compareRuns(before, analyze({ ...shared, snapshot: current }));
}
