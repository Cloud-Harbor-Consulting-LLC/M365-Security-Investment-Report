/**
 * Several clients side by side, on the consultant's own machine.
 *
 * Built from files the consultant drops, and held only in this tab. There is no backend to
 * keep a portfolio in, and there will not be one: a stored list of client tenants is the
 * thing "nothing is uploaded anywhere" rules out. Closing the tab forgets it, and dropping
 * the same files again rebuilds it exactly.
 *
 * Each client shows its newest run. When the files hold an earlier run of the same tenant,
 * the most recent one becomes the comparison, so "since last review" works across a whole
 * book of clients without anyone pairing files by hand.
 */
import { analyze, clearOverrides, parseSession, toCsv, type CsvColumn, type Overrides, type ReportModel } from '@/engine';
import type { RunComparison } from '@/engine/compare';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';
import { compareWith } from '@/comparison';

export interface DroppedFile {
  name: string;
  /** The parsed JSON, or null when the file was not valid JSON. */
  raw: unknown;
}

export interface PortfolioTenant {
  tenantId: string;
  /** The newest run of this tenant among the files. */
  snapshot: Snapshot;
  /** The run before it, when the files hold one. */
  baseline: Snapshot | null;
  overrides: Overrides;
  /** The file the newest run came from. */
  sourceLabel: string;
  /** What the reader should know about how this tenant's files were put together. */
  notes: string[];
}

export interface Portfolio {
  tenants: PortfolioTenant[];
  rejected: Array<{ file: string; reason: string }>;
}

interface Run {
  snapshot: Snapshot;
  collected: number;
  file: string;
  /** Prices saved with this run, when it came from a session. */
  overrides: Overrides | null;
}

const tenantIdOf = (s: Snapshot): string =>
  (s.Collectors.organization?.Data?.TenantId ?? s.Context.TenantId ?? '').toLowerCase();

const longDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function analysable(snapshot: Snapshot): string | null {
  try {
    analyze({ snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Every run in one file: a snapshot, or a session and the earlier run saved with it. */
function runsIn(file: DroppedFile): { runs: Run[] } | { reason: string } {
  const { raw, name } = file;
  if (raw === null || typeof raw !== 'object') return { reason: 'It is not valid JSON.' };

  const run = (snapshot: Snapshot, overrides: Overrides | null): Run => ({
    snapshot,
    collected: Date.parse(snapshot.GeneratedAt),
    file: name,
    overrides,
  });

  if ('kind' in (raw as object)) {
    const session = parseSession(raw);
    if (!session.ok) return { reason: session.reason };
    const { snapshot, overrides, baseline } = session.session;
    return { runs: [run(snapshot, overrides), ...(baseline ? [run(baseline, null)] : [])] };
  }

  const parsed = parseSnapshot(raw);
  return parsed.ok ? { runs: [run(parsed.snapshot, null)] } : { reason: parsed.reason };
}

/**
 * Groups the files by tenant: newest run shown, the one before it compared with.
 *
 * Prices come from the newest session among a tenant's files, even when the newest run is
 * a raw snapshot, because a consultant's negotiated rates outlive any one collection. The
 * reader is told when that happens. A comparison prices both runs the same way, as it
 * does everywhere else in this tool.
 */
export function buildPortfolio(files: readonly DroppedFile[]): Portfolio {
  const rejected: Portfolio['rejected'] = [];
  const byTenant = new Map<string, Run[]>();

  for (const file of files) {
    const found = runsIn(file);
    if ('reason' in found) {
      rejected.push({ file: file.name, reason: found.reason });
      continue;
    }
    const problem = analysable(found.runs[0]!.snapshot);
    if (problem) {
      rejected.push({ file: file.name, reason: problem });
      continue;
    }
    for (const run of found.runs) {
      const key = tenantIdOf(run.snapshot);
      byTenant.set(key, [...(byTenant.get(key) ?? []), run]);
    }
  }

  const tenants: PortfolioTenant[] = [];
  for (const [tenantId, all] of byTenant) {
    // The same run can arrive twice, as a snapshot and inside a session. Keep one, and
    // prefer the copy that carries prices.
    const sorted = [...all].sort((a, b) => b.collected - a.collected || Number(b.overrides !== null) - Number(a.overrides !== null));
    const runs = sorted.filter((r, i) => i === 0 || r.collected !== sorted[i - 1]!.collected);

    const current = runs[0]!;
    const notes: string[] = [];
    const priced = runs.find((r) => r.overrides !== null);
    if (priced && priced !== current && Object.keys(priced.overrides!.prices).length > 0) {
      notes.push(`Prices came from ${priced.file}, saved with the run of ${longDate(priced.collected)}.`);
    }

    let baseline: Snapshot | null = runs[1]?.snapshot ?? null;
    if (baseline) {
      const compared = compareWith(baseline, current.snapshot, priced?.overrides ?? clearOverrides());
      if (!compared.ok) {
        notes.push(`The earlier run was not compared. ${compared.reason}`);
        baseline = null;
      }
    }
    if (runs.length > 2) {
      const left = runs.length - 2;
      notes.push(
        `${left} older run${left === 1 ? ' was' : 's were'} left out. Since last review compares with the most recent earlier one, from ${longDate(runs[1]!.collected)}.`,
      );
    }

    tenants.push({
      tenantId,
      snapshot: current.snapshot,
      baseline,
      overrides: priced?.overrides ?? clearOverrides(),
      sourceLabel: current.file,
      notes,
    });
  }

  return { tenants, rejected };
}

export interface PortfolioRow {
  tenant: PortfolioTenant;
  model: ReportModel;
  comparison: RunComparison | null;
  name: string;
  domain: string;
  collected: string;
  currency: string;
  /** The board headline: spend realized, or seat realization when Secure Score is missing. */
  realized: { ratio: number | null; label: string };
  commitment: number | null;
  /** Licence spend that deploying what is already owned would put to work. */
  notSwitchedOn: number | null;
  waste: { total: number | null; floor: boolean };
  /** Controls a recent packaging change brought in that are not switched on yet. */
  newlyEntitled: number;
  /** Collectors that returned nothing, so parts of this client's report are not measured. */
  notCollected: number;
}

/** One client's line, from the same model its own report is drawn from. */
export function rowFor(tenant: PortfolioTenant): PortfolioRow {
  const model = analyze({
    snapshot: tenant.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
    overrides: tenant.overrides,
  });
  const compared = tenant.baseline ? compareWith(tenant.baseline, tenant.snapshot, tenant.overrides) : null;
  const { realization, spend, seatWaste, features } = model;
  const headline = realization.composite.available ? realization.composite : realization.seat;

  return {
    tenant,
    model,
    comparison: compared?.ok ? compared.comparison : null,
    name: model.tenant.DisplayName,
    domain: model.tenant.DefaultDomain ?? model.tenant.TenantId,
    collected: model.provenance.snapshotCollected,
    currency: spend.currency,
    realized: { ratio: headline.ratio, label: headline.label },
    commitment: spend.anyPriced ? spend.annualCommitment : null,
    notSwitchedOn: features.available ? features.unlockableSpend : null,
    waste: {
      total: seatWaste.totalAnnualCost,
      floor: seatWaste.totalIsFloor || seatWaste.incomplete,
    },
    newlyEntitled: features.newlyEntitled.reduce((n, s) => n + s.notDeployed, 0),
    notCollected: model.provenance.collectors.filter((c) => !c.available).length,
  };
}

/** Largest spend not switched on first: where the next hour of work is worth most. */
export function byOpportunity(rows: readonly PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort(
    (a, b) => (b.notSwitchedOn ?? -1) - (a.notSwitchedOn ?? -1) || a.name.localeCompare(b.name),
  );
}

/** The table as a CSV, for the consultant's own tracking. Contains client names. */
export function portfolioCsv(rows: readonly PortfolioRow[]): string {
  const cols: CsvColumn<PortfolioRow>[] = [
    { header: 'Client', value: (r) => r.name },
    { header: 'Domain', value: (r) => r.domain },
    { header: 'Tenant ID', value: (r) => r.tenant.tenantId },
    { header: 'Collected', value: (r) => r.collected },
    { header: 'Currency', value: (r) => r.currency },
    { header: 'Realized measure', value: (r) => r.realized.label },
    { header: 'Realized', value: (r) => r.realized.ratio },
    { header: 'Compared with run of', value: (r) => r.comparison?.baselineCollected ?? null },
    { header: 'Spend realized change', value: (r) => r.comparison?.headline.spendRealized.change ?? null },
    { header: 'Annual commitment', value: (r) => r.commitment },
    { header: 'Not switched on', value: (r) => r.notSwitchedOn },
    { header: 'Seat waste', value: (r) => r.waste.total },
    { header: 'Seat waste is a floor', value: (r) => r.waste.floor },
    { header: 'Newly entitled, not switched on', value: (r) => r.newlyEntitled },
    { header: 'Collectors not collected', value: (r) => r.notCollected },
    { header: 'Source file', value: (r) => r.tenant.sourceLabel },
  ];
  return toCsv(byOpportunity(rows), cols);
}

/**
 * A total across the clients that have the figure, and how many that is.
 *
 * Null when no client has it, or when the currencies differ, since adding dollars to euros
 * is not a number at all. A total that leaves a client out says so through `counted`, so
 * it is never read as the whole book.
 */
export function totalOf(
  rows: readonly PortfolioRow[],
  pick: (r: PortfolioRow) => number | null,
): { total: number; counted: number } | null {
  if (new Set(rows.map((r) => r.currency)).size > 1) return null;
  const values = rows.map(pick).filter((v): v is number => v !== null);
  return values.length === 0 ? null : { total: values.reduce((a, b) => a + b, 0), counted: values.length };
}
