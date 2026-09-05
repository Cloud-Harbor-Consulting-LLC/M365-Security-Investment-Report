import type { SecureScoreData } from '@/model/snapshot';
import type { InventoryRow } from './inventory';

/**
 * Entitled versus deployed — the question the whole tool exists to answer.
 *
 * Owning a licence and having the capability switched on are different things, and the
 * gap between them is what a customer is paying for and not receiving. Entitlement comes
 * from the service plans on the SKUs they own; deployment comes from Secure Score, which
 * already knows whether a control is enforced and costs no scope beyond
 * SecurityEvents.Read.All.
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
}

export type DeploymentState = 'deployed' | 'partial' | 'notDeployed' | 'unknown';

export interface FeatureGap {
  id: string;
  displayName: string;
  category: string;
  /** True when a SKU the tenant owns carries a service plan that grants this. */
  entitled: boolean;
  /** SKUs that entitle it, for the drill-down. */
  entitledBy: string[];
  state: DeploymentState;
  /** Null when the control was not found or profiles were unavailable. */
  scoreRatio: number | null;
  controlName: string | null;
  /** How much of this capability is not in use: 0 when deployed, 1 when not. */
  gap: number;
  /** Annual spend attributed to this capability, or null when it cannot be valued. */
  attributedSpend: number | null;
  /** The portion of that attributable to the part which is not deployed. */
  idleSpend: number | null;
  learnUrl: string | null;
  remediation: string | null;
  implementationCost: string | null;
  userImpact: string | null;
  actionUrl: string | null;
}

export interface FeatureAnalysis {
  available: boolean;
  unavailableReason: string | null;
  gaps: FeatureGap[];
  /** Total attributed to capabilities that are entitled but not fully deployed. */
  idleSpend: number | null;
  attributedSpend: number | null;
  /** Deployed share of the security value that could be valued. Null when unmeasurable. */
  featureRealization: number | null;
  currentScore: number | null;
  maxScore: number | null;
  scorePercent: number | null;
  comparative: Array<{ basis: string; averageScore: number }>;
  history: Array<{ date: string; score: number; maxScore: number }>;
}

/** Parses the threshold expressions the feature map uses, e.g. ">=0.9" or ">0". */
function meets(ratio: number, expression: string | undefined): boolean {
  if (!expression) return false;
  const match = /^(>=|<=|>|<|==)?\s*([0-9.]+)$/.exec(expression.trim());
  if (!match) return false;
  const value = Number(match[2]);
  switch (match[1] ?? '>=') {
    case '>':
      return ratio > value;
    case '<':
      return ratio < value;
    case '<=':
      return ratio <= value;
    case '==':
      return ratio === value;
    default:
      return ratio >= value;
  }
}

export interface FeatureAnalysisInput {
  featureMap: FeatureMap;
  inventory: readonly InventoryRow[];
  secureScore: SecureScoreData | null;
  secureScoreAvailable: boolean;
  secureScoreReason: string | null;
}

const EMPTY: Omit<FeatureAnalysis, 'available' | 'unavailableReason' | 'gaps'> = {
  idleSpend: null,
  attributedSpend: null,
  featureRealization: null,
  currentScore: null,
  maxScore: null,
  scorePercent: null,
  comparative: [],
  history: [],
};

export function analyzeFeatures(input: FeatureAnalysisInput): FeatureAnalysis {
  const { featureMap, inventory, secureScore, secureScoreAvailable, secureScoreReason } = input;

  // Entitlement is knowable from the licence inventory alone, so it is computed even
  // when Secure Score is unavailable: "you own this and we cannot tell whether it is on"
  // is more useful than silence.
  const owned = inventory.filter((r) => !r.excluded);
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

  const scoreByControl = new Map((secureScore?.ControlScores ?? []).map((c) => [c.ControlName, c]));
  const profileByControl = new Map((secureScore?.ControlProfiles ?? []).map((p) => [p.ControlName, p]));

  const gaps: FeatureGap[] = featureMap.features.map((feature) => {
    const entitlingSkus = new Set<InventoryRow>();
    for (const planName of feature.entitledBy.servicePlanNames) {
      for (const row of planToSkus.get(planName) ?? []) entitlingSkus.add(row);
    }
    const entitled = entitlingSkus.size > 0;

    const evidence = feature.evidence[0];
    const control = evidence ? scoreByControl.get(evidence.controlName) : undefined;
    const profile = evidence ? profileByControl.get(evidence.controlName) : undefined;

    let state: DeploymentState = 'unknown';
    let ratio: number | null = null;

    if (control && profile && profile.MaxScore > 0) {
      ratio = Math.max(0, Math.min(1, control.Score / profile.MaxScore));
      if (meets(ratio, evidence?.deployedWhen)) state = 'deployed';
      else if (meets(ratio, evidence?.partialWhen)) state = 'partial';
      else state = 'notDeployed';
    } else if (secureScoreAvailable && evidence && !control) {
      // Secure Score does not report this control for this tenant, which usually means
      // the workload is not present. Claiming "not deployed" would be a guess.
      state = 'unknown';
    }

    const gap = state === 'deployed' ? 0 : state === 'partial' ? 1 - (ratio ?? 0) : state === 'notDeployed' ? 1 : 0;

    return {
      id: feature.id,
      displayName: feature.displayName,
      category: feature.category,
      entitled,
      entitledBy: [...entitlingSkus].map((r) => r.skuPartNumber),
      state,
      scoreRatio: ratio,
      controlName: evidence?.controlName ?? null,
      gap,
      attributedSpend: null,
      idleSpend: null,
      learnUrl: feature.learnUrl ?? null,
      remediation: profile?.Remediation ?? null,
      implementationCost: profile?.ImplementationCost ?? null,
      userImpact: profile?.UserImpact ?? null,
      actionUrl: profile?.ActionUrl ?? null,
    };
  });

  // ── Dollarization ──────────────────────────────────────────────────────────
  //
  // No vendor publishes "the Safe Links portion of an E5 seat", so this is an explicit
  // allocation model rather than a measurement, and the report says so wherever the
  // figure appears. Each SKU contributes a security budget of
  //     annual spend in use x securityValueShare
  // split across the capabilities that SKU entitles, weighted by valueWeight.
  const attributed = new Map<string, number>();
  let anyAttributed = false;

  for (const row of owned) {
    if (row.annualSpendConsumed === null) continue;

    const budget = row.annualSpendConsumed * row.securityValueShare;
    if (budget <= 0) continue;

    const mine = gaps.filter((g) => g.entitledBy.includes(row.skuPartNumber));
    const weightTotal = mine.reduce(
      (sum, g) => sum + (featureMap.features.find((f) => f.id === g.id)?.valueWeight ?? 0),
      0,
    );
    if (weightTotal <= 0) continue;

    for (const g of mine) {
      const weight = featureMap.features.find((f) => f.id === g.id)?.valueWeight ?? 0;
      attributed.set(g.id, (attributed.get(g.id) ?? 0) + (budget * weight) / weightTotal);
      anyAttributed = true;
    }
  }

  for (const g of gaps) {
    const value = attributed.get(g.id);
    if (value === undefined) continue;
    g.attributedSpend = value;
    // Only meaningful where deployment is actually known.
    g.idleSpend = g.state === 'unknown' ? null : value * g.gap;
  }

  if (!secureScoreAvailable || !secureScore) {
    return {
      available: false,
      unavailableReason:
        secureScoreReason ??
        'Secure Score was not collected, so whether these capabilities are deployed cannot be established.',
      gaps,
      ...EMPTY,
      attributedSpend: anyAttributed
        ? gaps.reduce((sum, g) => sum + (g.attributedSpend ?? 0), 0)
        : null,
    };
  }

  const valued = gaps.filter((g) => g.entitled && g.attributedSpend !== null && g.state !== 'unknown');
  const attributedTotal = valued.reduce((sum, g) => sum + (g.attributedSpend ?? 0), 0);
  const idleTotal = valued.reduce((sum, g) => sum + (g.idleSpend ?? 0), 0);

  return {
    available: true,
    unavailableReason: null,
    gaps,
    attributedSpend: valued.length > 0 ? attributedTotal : null,
    idleSpend: valued.length > 0 ? idleTotal : null,
    featureRealization:
      valued.length > 0 && attributedTotal > 0 ? (attributedTotal - idleTotal) / attributedTotal : null,
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
