import type { ReportModel } from './index';
import { toCsv, type CsvColumn } from './csv';

/**
 * Getting the analysis out of the browser.
 *
 * Two audiences. JSON is for whatever comes next — a pipeline, a spreadsheet someone
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

const nul = (v: number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/**
 * The JSON export.
 *
 * The whole model, plus a header saying what it is and what in it is assumed rather than
 * measured. Exported wholesale rather than trimmed: the reader may want anything, and a
 * field withheld to keep the file tidy is a field someone has to re-collect a tenant to
 * get back.
 */
export function toJsonExport(model: ReportModel, sourceLabel: string): unknown {
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
      notMeasured:
        'Anything this run could not establish is reported as unavailable with a reason rather than as zero. Check the notMeasured fields before treating an absent figure as nil.',
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
  };
}

export function exportSections(model: ReportModel): ExportSection[] {
  const sections: ExportSection[] = [];

  const inventoryCols: CsvColumn<ReportModel['inventory'][number]>[] = [
    { header: 'Product', value: (r) => r.displayName },
    { header: 'Part number', value: (r) => r.skuPartNumber },
    { header: 'Purchased seats', value: (r) => r.purchasedUnits },
    { header: 'Assigned seats', value: (r) => r.consumedUnits },
    { header: 'Unassigned seats', value: (r) => r.unassignedUnits },
    { header: 'Unit price monthly', value: (r) => nul(r.unitPriceMonthly) },
    { header: 'Price source', value: (r) => (r.priceOverridden ? 'customer-supplied' : r.priceKnown ? 'list price' : 'unpriced') },
    { header: 'Annual commitment', value: (r) => nul(r.annualCommitment) },
    { header: 'Annual spend in use', value: (r) => nul(r.annualSpendConsumed) },
    { header: 'Idle seat cost', value: (r) => nul(r.unassignedSeatCost) },
    { header: 'Excluded', value: (r) => (r.excluded ? 'yes' : 'no') },
    { header: 'Exclusion reason', value: (r) => r.exclusionReason ?? '' },
  ];
  sections.push({
    id: 'licence-inventory',
    label: 'Licence inventory',
    description: 'Every subscribed SKU, its seats, its price and where that price came from.',
    rowCount: model.inventory.length,
    csv: () => toCsv(model.inventory, inventoryCols),
  });

  if (model.features.available) {
    const controlCols: CsvColumn<ReportModel['features']['rows'][number]>[] = [
      { header: 'Capability', value: (r) => r.displayName },
      { header: 'Control', value: (r) => r.controlName },
      { header: 'Service', value: (r) => r.service },
      { header: 'State', value: (r) => (r.state === 'notDeployed' ? 'not deployed' : r.state) },
      { header: 'Score', value: (r) => r.score },
      { header: 'Max score', value: (r) => r.maxScore },
      { header: 'Entitled by', value: (r) => r.costSkuName ?? r.entitledBy.join('; ') },
      { header: 'Entitlement basis', value: (r) => r.entitlementBasis },
      { header: 'Required service plans', value: (r) => r.requiredPlans.join('; ') },
      { header: 'Annual cost of that licence', value: (r) => nul(r.attributedSpend) },
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
      { header: 'Annual cost', value: (r) => r.annualCost },
      { header: 'Cost basis', value: (r) => r.basis },
      { header: 'Controls it enables', value: (r) => r.controls },
      { header: 'Deployed', value: (r) => r.deployed },
      { header: 'At risk', value: (r) => r.annualCost * (1 - r.deployed / r.controls) },
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
    { header: 'Annual cost', value: (r) => nul(r.annualCost) },
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
      { header: 'Annual cost', value: (r) => nul(r.annualCost) },
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
      { header: 'Annual likelihood (assumption)', value: (r) => r.annualLikelihood },
      { header: 'Impact USD (assumption)', value: (r) => r.impactUsd },
      { header: 'Expected loss', value: (r) => r.expectedLoss },
      { header: 'Controls', value: (r) => r.controls },
      { header: 'Points earned', value: (r) => r.score },
      { header: 'Points available', value: (r) => r.maxScore },
      { header: 'Coverage', value: (r) => r.coverage },
      { header: 'Avoided', value: (r) => r.avoided },
      { header: 'Retained', value: (r) => r.retained },
    ];
    sections.push({
      id: 'threat-exposure',
      label: 'Threat exposure',
      description:
        'Expected loss per threat. Likelihood and impact are ENGAGEMENT ASSUMPTIONS, not measurements — the column headers say so, because this sheet will be forwarded without the report around it.',
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
      { header: 'Risk retired (assumption-based)', value: (r) => r.riskRetired },
      { header: 'Spend unlocked', value: (r) => nul(r.spendUnlocked) },
      { header: 'Secure Score points', value: (r) => r.pointsGained },
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
): string {
  const lines: string[] = [
    `M365 Security Investment Report — export`,
    ``,
    `Tenant:      ${model.tenant.DisplayName} (${model.tenant.DefaultDomain ?? model.tenant.TenantId})`,
    `Collected:   ${model.provenance.snapshotCollected}`,
    `Exported:    ${model.generatedAt}`,
    `Source:      ${sourceLabel}`,
    `Pricing:     ${model.spend.basisLabel}`,
    ``,
    `FILES`,
    ...sections.map((s) => `  ${s.id}.csv — ${s.label} (${s.rowCount} rows). ${s.description}`),
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
    `READ THESE CAREFULLY`,
    ``,
    `  The per-control cost column in entitled-versus-deployed is NOT additive. Several`,
    `  controls can depend on one licence and each carries that licence's whole cost.`,
    `  Use licence-rollup.csv for a total.`,
    ``,
    `  An empty cell means the figure could not be established, never that it is zero.`,
  ];

  if (model.risk.available && model.risk.controlsWithoutThreatTag > 0) {
    const tagged = model.features.rows.length - model.risk.controlsWithoutThreatTag;
    lines.push(
      ``,
      `  Risk rests on ${tagged} of ${model.features.rows.length} scored controls. Microsoft tags the rest with no`,
      `  threat, so they contribute no expected-loss figure — which is not the same as`,
      `  contributing no risk.`,
    );
  }

  return lines.join('\n') + '\n';
}
