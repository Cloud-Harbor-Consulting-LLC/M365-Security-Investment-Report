import type { ReportModel } from './index';
import type { RunComparison } from './compare';
import { toCsv, type CsvColumn } from './csv';

/**
 * Getting the analysis out of the browser.
 *
 * Two audiences. JSON is for whatever comes next: a pipeline, a spreadsheet someone
 * builds themselves, a diff between two collections. CSV is for the person who is going
 * to open it in Excel this afternoon and sort it.
 *
 * Both carry the caveats with them. A figure that says "assumption" on screen and not in
 * the export is a figure that will be quoted without its caveat, and the export is the
 * copy that gets forwarded.
 */

export interface ExportSection {
  /** Short slug used in the filename. */
  id: string;
  label: string;
  /** What the sheet contains, in a sentence, for the manifest. */
  description: string;
  csv: () => string;
  rowCount: number;
}

/**
 * A number, or empty when it is unknown.
 *
 * These return numbers rather than strings on purpose. The CSV writer neutralises text
 * that starts with a minus sign, since text can come from a tenant, but passes a number
 * through as a number. A negative change written as text cannot be summed in a spreadsheet.
 */
const nul = (v: number | null | undefined): number | '' => (v === null || v === undefined ? '' : v);

/**
 * A number to a fixed precision, or empty when it is unknown.
 *
 * The engine keeps full precision so the 2 tiers agree to the cent, and arithmetic on
 * prices and ratios carries binary noise: 0.07 x 168 is 11.760000000000002, and expected
 * loss came out as 42000.00000000001. Rounding belongs here, where a figure leaves the model
 * for a spreadsheet, and not in the model, where it would compound.
 */
const fixed =
  (places: number) =>
  (v: number | null | undefined): number | '' => {
    if (v === null || v === undefined) return '';
    const scale = 10 ** places;
    return Math.round(v * scale) / scale;
  };

/** Money, to the cent. */
export const cents = fixed(2);
/** Secure Score points, which Microsoft issues in fractions such as 4.5. */
const points = fixed(2);
/** Ratios, to 4 places, matching the PowerShell export's seat utilisation. */
const ratio = fixed(4);

/**
 * The JSON export.
 *
 * The whole model, plus a header saying what it is and what in it is assumed rather than
 * measured. Exported wholesale rather than trimmed: the reader may want anything, and a
 * field withheld to keep the file tidy is a field someone has to re-collect a tenant to
 * get back.
 */
export function toJsonExport(model: ReportModel, sourceLabel: string, comparison?: RunComparison | null): unknown {
  return {
    kind: 'm365-security-investment-report',
    schemaVersion: model.schemaVersion,
    generatedAt: model.generatedAt,
    source: { label: sourceLabel, ...model.provenance },
    $readThisFirst: {
      pricing:
        'Microsoft Graph does not expose contract pricing. Every monetary figure derives from the supplied price table, which is either Microsoft list price or rates the consultant entered.',
      riskModel:
        'Expected loss is annual likelihood multiplied by impact, per threat. Both inputs are engagement assumptions supplied by the consultant, not measurements.',
      attribution:
        'A control is costed from the most expensive licence the tenant holds that carries the service plan unlocking it. Which licence pays is an allocation choice made by this tool; the entitlement itself is researched against Microsoft licensing documentation.',
      securityBudget:
        'securityBudgetAnnual is assigned seats times annual price times securityValueShare, the fraction of the price of each SKU that this tool attributes to security. The share is an allocation model, not a Microsoft figure; METHODOLOGY.md explains how it is derived.',
      notMeasured:
        'Anything this run could not establish is reported as unavailable with a reason rather than as zero. Check the notMeasured fields before treating an absent figure as nil.',
      ...(comparison
        ? {
            comparison:
              'comparison describes what changed since an earlier run of the same tenant. Both runs were priced with the same prices and analysed with the same reference data, so a difference is something that changed in the tenant. A change is null wherever either run could not measure the figure; comparison.notComparable says why.',
          }
        : {}),
    },
    tenant: model.tenant,
    config: model.config,
    inventory: model.inventory,
    spend: model.spend,
    realization: model.realization,
    seatWaste: model.seatWaste,
    features: model.features,
    risk: model.risk,
    roadmap: model.roadmap,
    ...(comparison ? { comparison } : {}),
  };
}

export function exportSections(model: ReportModel, comparison?: RunComparison | null): ExportSection[] {
  const sections: ExportSection[] = [];

  const inventoryCols: CsvColumn<ReportModel['inventory'][number]>[] = [
    { header: 'Product', value: (r) => r.displayName },
    { header: 'Part number', value: (r) => r.skuPartNumber },
    { header: 'Purchased seats', value: (r) => r.purchasedUnits },
    { header: 'Assigned seats', value: (r) => r.consumedUnits },
    { header: 'Unassigned seats', value: (r) => r.unassignedUnits },
    { header: 'Unit price monthly', value: (r) => cents(r.unitPriceMonthly) },
    { header: 'Price source', value: (r) => (r.priceOverridden ? 'customer-supplied' : r.priceKnown ? 'list price' : 'unpriced') },
    { header: 'Annual commitment', value: (r) => cents(r.annualCommitment) },
    { header: 'Annual spend in use', value: (r) => cents(r.annualSpendConsumed) },
    { header: 'Idle seat cost', value: (r) => cents(r.unassignedSeatCost) },
    // Labelled in the header, as the risk sheet labels its assumptions: this sheet gets
    // forwarded on its own, and the caveat has to travel inside it.
    { header: 'Annual security budget (allocation)', value: (r) => cents(r.securityBudgetAnnual) },
    { header: 'Excluded', value: (r) => (r.excluded ? 'yes' : 'no') },
    { header: 'Exclusion reason', value: (r) => r.exclusionReason ?? '' },
  ];
  sections.push({
    id: 'licence-inventory',
    label: 'Licence inventory',
    description:
      'Every subscribed SKU, its seats, its price, where that price came from, and the security budget this tool allocates to it.',
    rowCount: model.inventory.length,
    csv: () => toCsv(model.inventory, inventoryCols),
  });

  if (model.features.available) {
    const controlCols: CsvColumn<ReportModel['features']['rows'][number]>[] = [
      { header: 'Capability', value: (r) => r.displayName },
      { header: 'Control', value: (r) => r.controlName },
      { header: 'Service', value: (r) => r.service },
      { header: 'State', value: (r) => (r.state === 'notDeployed' ? 'not deployed' : r.state) },
      { header: 'Score', value: (r) => points(r.score) },
      { header: 'Max score', value: (r) => points(r.maxScore) },
      { header: 'Entitled by', value: (r) => r.costSkuName ?? r.entitledBy.join('; ') },
      { header: 'Entitlement basis', value: (r) => r.entitlementBasis },
      { header: 'Required service plans', value: (r) => r.requiredPlans.join('; ') },
      { header: 'Annual cost of that licence', value: (r) => cents(r.attributedSpend) },
      { header: 'Cost basis', value: (r) => r.costBasis ?? '' },
      { header: 'Effort', value: (r) => r.implementationCost ?? '' },
      { header: 'User impact', value: (r) => r.userImpact ?? '' },
    ];
    sections.push({
      id: 'entitled-versus-deployed',
      label: 'Entitled versus deployed',
      description:
        'Every control Microsoft scores for this tenant, the licence that enables it, and whether it is switched on. The cost column is per control and is NOT additive: several controls can depend on one licence.',
      rowCount: model.features.rows.length,
      csv: () => toCsv(model.features.rows, controlCols),
    });

    const licenceCols: CsvColumn<ReportModel['features']['licences'][number]>[] = [
      { header: 'Licence', value: (r) => r.displayName },
      { header: 'Part number', value: (r) => r.skuPartNumber },
      { header: 'Annual cost', value: (r) => cents(r.annualCost) },
      { header: 'Cost basis', value: (r) => r.basis },
      { header: 'Controls it enables', value: (r) => r.controls },
      { header: 'Deployed', value: (r) => r.deployed },
      { header: 'At risk', value: (r) => cents(r.annualCost * (1 - r.deployed / r.controls)) },
    ];
    sections.push({
      id: 'licence-rollup',
      label: 'What each licence is earning',
      description: 'The additive view: each licence once, and how much of what it enables is in place.',
      rowCount: model.features.licences.length,
      csv: () => toCsv(model.features.licences, licenceCols),
    });
  }

  const wasteCols: CsvColumn<ReportModel['seatWaste']['categories'][number]>[] = [
    { header: 'Category', value: (r) => r.label },
    { header: 'Measured', value: (r) => (r.available ? 'yes' : 'no') },
    { header: 'Seats', value: (r) => nul(r.seats) },
    { header: 'Annual cost', value: (r) => cents(r.annualCost) },
    { header: 'Cost is a floor', value: (r) => (r.costIsFloor ? 'yes' : 'no') },
    { header: 'Why not measured', value: (r) => r.unavailableReason ?? '' },
  ];
  sections.push({
    id: 'wasted-spend',
    label: 'Wasted spend',
    description: 'Seat-level waste by category. A category that could not be measured says so rather than reporting zero.',
    rowCount: model.seatWaste.categories.length,
    csv: () => toCsv(model.seatWaste.categories, wasteCols),
  });

  // The accounts behind the categories: the drill-down a customer asks for first.
  const accounts = model.seatWaste.categories.flatMap((c) =>
    c.accounts.map((a) => ({ category: c.label, ...a })),
  );
  if (accounts.length > 0) {
    const accountCols: CsvColumn<(typeof accounts)[number]>[] = [
      { header: 'Category', value: (r) => r.category },
      { header: 'Account', value: (r) => r.displayName ?? '' },
      { header: 'User principal name', value: (r) => r.userPrincipalName ?? '' },
      { header: 'Licences', value: (r) => r.skuPartNumbers.join('; ') },
      { header: 'Why', value: (r) => r.detail ?? '' },
      { header: 'Annual cost', value: (r) => cents(r.annualCost) },
    ];
    sections.push({
      id: 'wasted-spend-accounts',
      label: 'Wasted spend by account',
      description: 'The individual accounts behind each waste category. Contains user principal names.',
      rowCount: accounts.length,
      csv: () => toCsv(accounts, accountCols),
    });
  }

  if (model.risk.available) {
    const threatCols: CsvColumn<ReportModel['risk']['threats'][number]>[] = [
      { header: 'Threat', value: (r) => r.displayName },
      { header: 'Annual likelihood (assumption)', value: (r) => ratio(r.annualLikelihood) },
      { header: 'Impact USD (assumption)', value: (r) => cents(r.impactUsd) },
      { header: 'Expected loss', value: (r) => cents(r.expectedLoss) },
      { header: 'Controls', value: (r) => r.controls },
      { header: 'Points earned', value: (r) => points(r.score) },
      { header: 'Points available', value: (r) => points(r.maxScore) },
      { header: 'Coverage', value: (r) => ratio(r.coverage) },
      { header: 'Avoided', value: (r) => cents(r.avoided) },
      { header: 'Retained', value: (r) => cents(r.retained) },
    ];
    sections.push({
      id: 'threat-exposure',
      label: 'Threat exposure',
      description:
        'Expected loss per threat. Likelihood and impact are ENGAGEMENT ASSUMPTIONS rather than measurements. The column headers say so, because this sheet will be forwarded without the report around it.',
      rowCount: model.risk.threats.length,
      csv: () => toCsv(model.risk.threats, threatCols),
    });
  }

  if (model.roadmap.length > 0) {
    const roadmapCols: CsvColumn<ReportModel['roadmap'][number]>[] = [
      { header: 'Order', value: (_r) => '' }, // filled below
      { header: 'Step', value: (r) => r.displayName },
      { header: 'Control', value: (r) => r.controlName },
      { header: 'Service', value: (r) => r.service },
      { header: 'Risk retired (assumption-based)', value: (r) => cents(r.riskRetired) },
      { header: 'Spend unlocked', value: (r) => cents(r.spendUnlocked) },
      { header: 'Secure Score points', value: (r) => points(r.pointsGained) },
      { header: 'Effort', value: (r) => r.implementationCost ?? '' },
      { header: 'User impact', value: (r) => r.userImpact ?? '' },
      { header: 'Licence', value: (r) => r.costSkuName ?? '' },
      { header: 'Action URL', value: (r) => r.actionUrl ?? '' },
    ];
    const ordered = model.roadmap.map((s, i) => ({ ...s, order: i + 1 }));
    const cols = roadmapCols.map((c) =>
      c.header === 'Order' ? { header: 'Order', value: (r: (typeof ordered)[number]) => r.order } : (c as CsvColumn<(typeof ordered)[number]>),
    );
    sections.push({
      id: 'roadmap',
      label: 'Remediation roadmap',
      description: 'The order to work in, ranked by value against effort. Risk figures rest on the stated assumptions.',
      rowCount: ordered.length,
      csv: () => toCsv(ordered, cols),
    });
  }

  if (comparison) {
    const state = (s: string | null) => (s === 'notDeployed' ? 'not deployed' : (s ?? 'not scored'));
    const controlCols: CsvColumn<RunComparison['controls'][number]>[] = [
      { header: 'Control', value: (r) => r.displayName },
      { header: 'Control id', value: (r) => r.controlName },
      { header: 'Service', value: (r) => r.service },
      { header: 'Movement', value: (r) => r.movement },
      { header: 'State then', value: (r) => state(r.stateBefore) },
      { header: 'State now', value: (r) => state(r.stateAfter) },
      { header: 'Score then', value: (r) => points(r.score.before) },
      { header: 'Score now', value: (r) => points(r.score.after) },
      { header: 'Points change', value: (r) => points(r.score.change) },
      { header: 'Max score', value: (r) => points(r.maxScore) },
    ];
    sections.push({
      id: 'controls-changed',
      label: 'Controls changed since the earlier run',
      description: `Every Secure Score control that moved since the run collected ${comparison.baselineCollected.slice(0, 10)}, regressions first. Unchanged controls are not listed.`,
      rowCount: comparison.controls.length,
      csv: () => toCsv(comparison.controls, controlCols),
    });

    const licenceCols: CsvColumn<RunComparison['licences'][number]>[] = [
      { header: 'Licence', value: (r) => r.displayName },
      { header: 'Part number', value: (r) => r.skuPartNumber },
      { header: 'Change', value: (r) => r.movement },
      { header: 'Seats bought then', value: (r) => nul(r.purchased.before) },
      { header: 'Seats bought now', value: (r) => nul(r.purchased.after) },
      { header: 'Seats assigned then', value: (r) => nul(r.assigned.before) },
      { header: 'Seats assigned now', value: (r) => nul(r.assigned.after) },
      { header: 'Annual commitment then', value: (r) => cents(r.annualCommitment.before) },
      { header: 'Annual commitment now', value: (r) => cents(r.annualCommitment.after) },
      { header: 'Annual commitment change', value: (r) => cents(r.annualCommitment.change) },
    ];
    sections.push({
      id: 'licences-changed',
      label: 'Licences changed since the earlier run',
      description: 'Licences added, dropped, or bought and assigned in different numbers, with both runs priced the same way.',
      rowCount: comparison.licences.length,
      csv: () => toCsv(comparison.licences, licenceCols),
    });
  }

  return sections;
}

/**
 * A README that travels with the export.
 *
 * A folder of CSVs with no context is how a caveated figure becomes an uncaveated one.
 * This is the sheet that says which numbers are measured, which are assumed, and which
 * column must never be summed.
 */
export function exportManifest(
  model: ReportModel,
  sourceLabel: string,
  sections: readonly ExportSection[],
  comparison?: RunComparison | null,
): string {
  const lines: string[] = [
    `M365 Security Investment Report: export`,
    ``,
    `Tenant:      ${model.tenant.DisplayName} (${model.tenant.DefaultDomain ?? model.tenant.TenantId})`,
    `Collected:   ${model.provenance.snapshotCollected}`,
    ...(comparison ? [`Compared:    with the run collected ${comparison.baselineCollected}`] : []),
    `Exported:    ${model.generatedAt}`,
    `Source:      ${sourceLabel}`,
    `Pricing:     ${model.spend.basisLabel}`,
    ``,
    `FILES`,
    ...sections.map((s) => `  ${s.id}.csv: ${s.label} (${s.rowCount} rows). ${s.description}`),
    ``,
    `WHAT IS MEASURED AND WHAT IS ASSUMED`,
    ``,
    `  Measured, read from the tenant:`,
    `    Licence counts and assignment, Secure Score and its control states, user sign-in`,
    `    activity where Entra ID P1 permitted it.`,
    ``,
    `  Supplied, not measured:`,
    `    Every price. Microsoft Graph does not expose contract pricing, so all monetary`,
    `    figures derive from ${model.spend.basisLabel}.`,
    ``,
    `  Assumed, and arguable by design:`,
    `    Annual likelihood and impact per threat, which drive every expected-loss figure.`,
    `    These are engagement inputs. Change them and every risk number changes.`,
    ``,
    `    The annual security budget in licence-inventory.csv: assigned seats times annual`,
    `    price times the share of the price of each SKU that this tool attributes to`,
    `    security. The share is an allocation model, not a Microsoft figure, and`,
    `    METHODOLOGY.md explains how it is derived.`,
    ``,
    `READ THESE CAREFULLY`,
    ``,
    `  The per-control cost column in entitled-versus-deployed is NOT additive. Several`,
    `  controls can depend on one licence and each carries that licence's whole cost.`,
    `  Use licence-rollup.csv for a total.`,
    ``,
    `  An empty cell means the figure could not be established, never that it is zero.`,
    ``,
    `  Money is written to the cent and ratios to 4 decimal places, but every figure is`,
    `  computed from unrounded values. A figure recomputed from rounded cells can differ by`,
    `  a cent. Coverage is exactly points earned divided by points available, and both are`,
    `  in threat-exposure.csv.`,
  ];

  if (model.risk.available && model.risk.controlsWithoutThreatTag > 0) {
    const tagged = model.features.rows.length - model.risk.controlsWithoutThreatTag;
    lines.push(
      ``,
      `  Risk rests on ${tagged} of ${model.features.rows.length} scored controls. Microsoft tags the rest with no`,
      `  threat, so they contribute no expected-loss figure, which is not the same as`,
      `  contributing no risk.`,
    );
  }

  if (comparison) {
    lines.push(
      ``,
      `COMPARED WITH AN EARLIER RUN`,
      ``,
      `  The 2 "changed" sheets compare this run with the one collected`,
      `  ${comparison.baselineCollected}, ${comparison.daysBetween} days earlier. Both runs were priced with`,
      `  the same prices and analysed with the same reference data, so a difference is`,
      `  something that changed in the tenant, not in a price list.`,
      ...(comparison.notComparable.length > 0
        ? [``, `  Not compared, because it was not measured in both runs:`, ...comparison.notComparable.map((r) => `    ${r}`)]
        : []),
    );
  }

  return lines.join('\n') + '\n';
}
