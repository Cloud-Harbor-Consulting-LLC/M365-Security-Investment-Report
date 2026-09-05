import type { SecureScoreData } from '@/model/snapshot';
import type { InventoryRow } from './inventory';

/**
 * Entitled versus deployed — the question the whole tool exists to answer.
 *
 * Owning a licence and having the capability switched on are different things, and the
 * gap between them is what a customer is paying for and not receiving. Deployment comes
 * from Secure Score, which already knows whether a control is enforced and costs no
 * scope beyond SecurityEvents.Read.All.
 *
 * One row per control Microsoft scores for the tenant. An earlier version listed only
 * the capabilities named in feature-map.json, which meant two tenants with different
 * licensing and different configuration produced an identical table — the file was being
 * reported rather than the tenant.
 */

export interface FeatureEvidence {
  type: string;
  controlName: string;
  /** Score ratio at or above which the control counts as deployed, e.g. ">=0.9". */
  deployedWhen: string;
  partialWhen?: string;
}

export interface FeatureDefinition {
  id: string;
  displayName: string;
  category: string;
  entitledBy: { servicePlanNames: string[] };
  evidence: FeatureEvidence[];
  valueWeight: number;
  risk?: { threatScenario: string; likelihoodReductionPct: number };
  learnUrl?: string;
}

export interface FeatureMap {
  schemaVersion: string;
  features: FeatureDefinition[];
  /**
   * Controls that need no paid licence. Excluded from spend allocation: a tenant did not
   * buy "designate more than one global administrator", and charging licence money
   * against it would credit a SKU with something it never sold.
   */
  baselineControls?: { controlNames: string[] };
}

export type DeploymentState = 'deployed' | 'partial' | 'notDeployed' | 'unknown';

/** How confident the Entitled by column is, which is not the same for every row. */
export type EntitlementBasis =
  /** Named SKUs, resolved from service plans actually present in the tenant's inventory. */
  | 'servicePlans'
  /** Inferred: Microsoft scores this control for this tenant, so it applies to them. */
  | 'secureScoreScope';

export interface CapabilityRow {
  controlName: string;
  displayName: string;
  /** Exchange Online, Microsoft Entra ID, Defender for Office, and so on. */
  service: string;
  /** SKU part numbers that entitle it. Empty when the basis is inference. */
  entitledBy: string[];
  entitlementBasis: EntitlementBasis;
  state: DeploymentState;
  score: number;
  maxScore: number;
  /** 0 to 1. Null only when the control carries no usable denominator. */
  scoreRatio: number | null;
  /** Annual spend allocated to this control, or null when it is not licence-funded. */
  attributedSpend: number | null;
  /** The part of that already earned, because the control is in place. */
  realizedSpend: number | null;
  /** The part still on the table, unlocked by finishing deployment. */
  unlockableSpend: number | null;
  /** True when no paid licence is required, so no spend is allocated. */
  baseline: boolean;
  rank: number | null;
  implementationCost: string | null;
  userImpact: string | null;
  remediation: string | null;
  actionUrl: string | null;
  learnUrl: string | null;
}

export interface FeatureAnalysis {
  available: boolean;
  unavailableReason: string | null;
  rows: CapabilityRow[];
  /** Licence spend allocated across scored controls. Null when nothing could be priced. */
  attributedSpend: number | null;
  /** Of that, the part already earned. */
  realizedSpend: number | null;
  /** Of that, the part deployment would unlock. */
  unlockableSpend: number | null;
  /**
   * Share of the security posture Microsoft measures for this tenant that is in place —
   * currentScore / maxScore.
   *
   * Because attribution weights controls by maxScore, this is also exactly
   * realizedSpend / attributedSpend across licence-funded controls. The table's totals,
   * this tile, and Spend realized on the Board therefore reconcile to each other rather
   * than being three independently plausible numbers.
   */
  featureRealization: number | null;
  /**
   * True when the controls scored in this table account for the tenant's Secure Score
   * maximum, so the table's realized share and the Secure Score tile are two views of
   * one quantity rather than two different populations.
   *
   * A live tenant returned 460 control profiles summing to roughly 4,600 points against
   * a stated maximum of 1,215 — the profile list is wider than the set that actually
   * counts. That inflates the attribution denominator and makes every per-control figure
   * too small. Detected rather than assumed, because the fixture could not show it and
   * the resulting numbers look plausible enough to ship unnoticed.
   */
  reconciles: boolean;
  /** Points the scored controls sum to, against which the tenant's maximum is compared. */
  profileMaxTotal: number;
  currentScore: number | null;
  maxScore: number | null;
  scorePercent: number | null;
  comparative: Array<{ basis: string; averageScore: number }>;
  history: Array<{ date: string; score: number; maxScore: number }>;
}

/**
 * Graph returns the service as an internal code — MDATP, AzureAD, Azure ATP — names
 * Microsoft retired years ago and which a customer will not recognise in a report they
 * are being asked to act on. Mapped to the product names they see in their own portal;
 * anything unmapped passes through unchanged rather than being guessed at.
 */
const SERVICE_LABELS: Record<string, string> = {
  MDATP: 'Defender for Endpoint',
  'Azure ATP': 'Defender for Identity',
  AATP: 'Defender for Identity',
  AzureAD: 'Microsoft Entra ID',
  'Azure AD': 'Microsoft Entra ID',
  AAD: 'Microsoft Entra ID',
  MCAS: 'Defender for Cloud Apps',
  OATP: 'Defender for Office',
  MDO: 'Defender for Office',
  Exchange: 'Exchange Online',
  SharePoint: 'SharePoint Online',
  Intune: 'Microsoft Intune',
};

function serviceLabel(raw: string | null): string {
  const key = (raw ?? '').trim();
  if (!key) return 'Other';
  return SERVICE_LABELS[key] ?? key;
}

export interface FeatureAnalysisInput {
  featureMap: FeatureMap;
  inventory: InventoryRow[];
  secureScore: SecureScoreData | null;
  secureScoreAvailable: boolean;
  secureScoreReason: string | null;
}

const EMPTY: Omit<FeatureAnalysis, 'available' | 'unavailableReason' | 'rows'> = {
  attributedSpend: null,
  realizedSpend: null,
  unlockableSpend: null,
  featureRealization: null,
  reconciles: false,
  profileMaxTotal: 0,
  currentScore: null,
  maxScore: null,
  scorePercent: null,
  comparative: [],
  history: [],
};

export function analyzeFeatures(input: FeatureAnalysisInput): FeatureAnalysis {
  const { featureMap, inventory, secureScore, secureScoreAvailable, secureScoreReason } = input;

  if (!secureScoreAvailable || !secureScore) {
    return {
      available: false,
      unavailableReason:
        secureScoreReason ??
        'Secure Score was not collected, so whether these capabilities are deployed cannot be established.',
      rows: [],
      ...EMPTY,
    };
  }

  const owned = inventory.filter((r) => !r.excluded);

  // Service plan → the SKUs carrying it, so a curated capability can name what entitles it.
  const planToSkus = new Map<string, InventoryRow[]>();
  for (const row of owned) {
    for (const plan of row.servicePlans) {
      const list = planToSkus.get(plan.ServicePlanName) ?? [];
      list.push(row);
      planToSkus.set(plan.ServicePlanName, list);
    }
    // A standalone SKU whose part number matches a service plan name is common
    // (ATP_ENTERPRISE, AAD_PREMIUM), so treat that as entitling too.
    const selfList = planToSkus.get(row.skuPartNumber) ?? [];
    if (!selfList.includes(row)) {
      selfList.push(row);
      planToSkus.set(row.skuPartNumber, selfList);
    }
  }

  const scoreByControl = new Map(secureScore.ControlScores.map((c) => [c.ControlName, c]));
  const curatedByControl = new Map(
    featureMap.features
      .filter((f) => f.evidence[0])
      .map((f) => [f.evidence[0]!.controlName, f] as const),
  );
  const baseline = new Set(featureMap.baselineControls?.controlNames ?? []);

  // ── The security budget ────────────────────────────────────────────────────
  //
  // What the tenant's licences plausibly spend on security: annual spend in use times
  // each SKU's security value share. An allocation model, not a measurement, and the
  // report says so wherever a figure derived from it appears.
  let budget = 0;
  let anyPriced = false;
  for (const row of owned) {
    if (row.annualSpendConsumed === null) continue;
    anyPriced = true;
    budget += row.annualSpendConsumed * row.securityValueShare;
  }

  const profiles = secureScore.ControlProfiles.filter((p) => p.MaxScore > 0);
  const profileMaxTotal = profiles.reduce((sum, p) => sum + p.MaxScore, 0);

  // Weight by Secure Score's own maxScore. Microsoft has already decided that Privileged
  // Identity Management is worth four times an idle session timeout, tenant by tenant and
  // with a published source behind it. Inventing our own weights for fifty controls would
  // mean fifty numbers a customer could challenge and we could not defend.
  const fundedMaxTotal = profiles
    .filter((p) => !baseline.has(p.ControlName))
    .reduce((sum, p) => sum + p.MaxScore, 0);

  const rows: CapabilityRow[] = profiles.map((p) => {
    const curated = curatedByControl.get(p.ControlName);
    const score = scoreByControl.get(p.ControlName)?.Score ?? 0;
    const ratio = Math.max(0, Math.min(1, score / p.MaxScore));

    const state: DeploymentState = ratio >= 0.9 ? 'deployed' : ratio > 0 ? 'partial' : 'notDeployed';

    const entitlingSkus = new Set<InventoryRow>();
    for (const planName of curated?.entitledBy.servicePlanNames ?? []) {
      for (const row of planToSkus.get(planName) ?? []) entitlingSkus.add(row);
    }
    const entitledBy = [...entitlingSkus].map((r) => r.skuPartNumber).sort();

    const isBaseline = baseline.has(p.ControlName);
    const attributed =
      isBaseline || !anyPriced || fundedMaxTotal <= 0 ? null : (budget * p.MaxScore) / fundedMaxTotal;

    return {
      controlName: p.ControlName,
      displayName: curated?.displayName ?? p.Title ?? p.ControlName,
      service: serviceLabel(p.Service),
      entitledBy,
      entitlementBasis: entitledBy.length > 0 ? 'servicePlans' : 'secureScoreScope',
      state,
      score,
      maxScore: p.MaxScore,
      scoreRatio: ratio,
      attributedSpend: attributed,
      realizedSpend: attributed === null ? null : attributed * ratio,
      unlockableSpend: attributed === null ? null : attributed * (1 - ratio),
      baseline: isBaseline,
      rank: p.Rank,
      implementationCost: p.ImplementationCost,
      userImpact: p.UserImpact,
      remediation: p.Remediation,
      actionUrl: p.ActionUrl,
      learnUrl: curated?.learnUrl ?? null,
    } satisfies CapabilityRow;
  });

  // Most money on the table first: the order the conversation should follow. Deployed
  // rows have nothing left to unlock, so they fall to the bottom on their own.
  rows.sort(
    (a, b) =>
      (b.unlockableSpend ?? 0) - (a.unlockableSpend ?? 0) ||
      b.maxScore - a.maxScore ||
      a.displayName.localeCompare(b.displayName),
  );

  const funded = rows.filter((r) => r.attributedSpend !== null);
  const sum = (pick: (r: CapabilityRow) => number | null) =>
    funded.length > 0 ? funded.reduce((t, r) => t + (pick(r) ?? 0), 0) : null;

  return {
    available: true,
    unavailableReason: null,
    rows,
    attributedSpend: sum((r) => r.attributedSpend),
    realizedSpend: sum((r) => r.realizedSpend),
    unlockableSpend: sum((r) => r.unlockableSpend),
    featureRealization: secureScore.MaxScore > 0 ? secureScore.CurrentScore / secureScore.MaxScore : null,
    // Within 10% is treated as agreement; a live tenant came back nearly 4x apart, which
    // is a difference in population rather than in rounding.
    reconciles:
      secureScore.MaxScore > 0 &&
      Math.abs(profileMaxTotal - secureScore.MaxScore) / secureScore.MaxScore <= 0.1,
    profileMaxTotal,
    currentScore: secureScore.CurrentScore,
    maxScore: secureScore.MaxScore,
    scorePercent: secureScore.MaxScore > 0 ? secureScore.CurrentScore / secureScore.MaxScore : null,
    comparative: secureScore.Comparative.map((c) => ({ basis: c.Basis, averageScore: c.AverageScore })),
    history: secureScore.History.map((h) => ({
      date: h.CreatedDateTime,
      score: h.CurrentScore,
      maxScore: h.MaxScore,
    })).reverse(),
  };
}
