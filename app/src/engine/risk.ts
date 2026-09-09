import type { CapabilityRow } from './features';

/**
 * Expected loss, and what deployment would retire.
 *
 * Two numbers a customer will argue with — how likely, and how much — so they live in
 * one editable file and every figure derived from them is labelled an assumption. The
 * report never presents this as a measurement; it is the arithmetic of a stated model,
 * shown so the customer can push back on the inputs rather than the conclusion.
 */

export interface ThreatAssumption {
  threat: string;
  displayName: string;
  annualLikelihood: number;
  impactUsd: number;
  note?: string;
}

export interface RiskModel {
  schemaVersion: string;
  model: string;
  defaults: { annualLikelihood: number; impactUsd: number; impactBasis: string };
  threats: ThreatAssumption[];
}

export interface ThreatExposure {
  threat: string;
  displayName: string;
  annualLikelihood: number;
  impactUsd: number;
  /** Likelihood x impact, before any credit for what is deployed. */
  expectedLoss: number;
  /** Secure Score points on the controls mitigating this threat. */
  maxScore: number;
  score: number;
  /** 0 to 1: the share of those points earned. */
  coverage: number;
  /** Expected loss treated as already avoided, in proportion to coverage. */
  avoided: number;
  /** The remainder, which deployment would retire. */
  retained: number;
  controls: number;
}

export interface RiskAnalysis {
  available: boolean;
  unavailableReason: string | null;
  threats: ThreatExposure[];
  /** Sum of likelihood x impact across every threat the tenant's controls mention. */
  expectedLossAnnual: number;
  avoidedAnnual: number;
  retainedAnnual: number;
  /** Controls Microsoft tagged with no threat, so they carry no risk figure. */
  controlsWithoutThreatTag: number;
}

/** What one control would retire if it were fully deployed. */
export interface ControlRisk {
  controlName: string;
  /** Expected loss this control's remaining gap represents, across its threats. */
  retiredIfDeployed: number;
  threats: string[];
}

export interface RiskInput {
  riskModel: RiskModel;
  rows: CapabilityRow[];
  /** Threat tags per control, from the Secure Score profile. */
  threatsByControl: Map<string, string[]>;
}

export function analyzeRisk(input: RiskInput): {
  analysis: RiskAnalysis;
  byControl: Map<string, ControlRisk>;
} {
  const { riskModel, rows, threatsByControl } = input;

  const tagged = rows.filter((r) => (threatsByControl.get(r.controlName) ?? []).length > 0);
  const untagged = rows.length - tagged.length;

  if (rows.length === 0) {
    return {
      analysis: {
        available: false,
        unavailableReason:
          'Secure Score was not collected, so there are no controls to attach a risk estimate to.',
        threats: [],
        expectedLossAnnual: 0,
        avoidedAnnual: 0,
        retainedAnnual: 0,
        controlsWithoutThreatTag: 0,
      },
      byControl: new Map(),
    };
  }

  if (tagged.length === 0) {
    // Graph returned profiles without threat tags. Saying so beats inventing a linkage:
    // an expected-loss figure with no threat behind it is a number with no argument.
    return {
      analysis: {
        available: false,
        unavailableReason:
          'Microsoft tagged none of this tenant’s scored controls with a threat, so expected loss cannot be attributed to anything. The controls and their spend are unaffected.',
        threats: [],
        expectedLossAnnual: 0,
        avoidedAnnual: 0,
        retainedAnnual: 0,
        controlsWithoutThreatTag: untagged,
      },
      byControl: new Map(),
    };
  }

  const assumptions = new Map(riskModel.threats.map((t) => [t.threat.toLowerCase(), t]));

  // Points per threat, so a threat's exposure is reduced by what is actually deployed.
  // Microsoft's weighting again: a 40-point control mitigating account breach counts for
  // four times a 10-point one, because that is the judgement Microsoft published.
  const buckets = new Map<string, { max: number; score: number; controls: number }>();
  for (const r of tagged) {
    for (const raw of threatsByControl.get(r.controlName) ?? []) {
      const key = raw.toLowerCase();
      const b = buckets.get(key) ?? { max: 0, score: 0, controls: 0 };
      b.max += r.maxScore;
      b.score += r.score;
      b.controls += 1;
      buckets.set(key, b);
    }
  }

  const threats: ThreatExposure[] = [];
  for (const [key, b] of buckets) {
    const a = assumptions.get(key);
    const annualLikelihood = a?.annualLikelihood ?? riskModel.defaults.annualLikelihood;
    const impactUsd = a?.impactUsd ?? riskModel.defaults.impactUsd;
    const expectedLoss = annualLikelihood * impactUsd;
    const coverage = b.max > 0 ? Math.max(0, Math.min(1, b.score / b.max)) : 0;

    threats.push({
      threat: key,
      displayName: a?.displayName ?? key,
      annualLikelihood,
      impactUsd,
      expectedLoss,
      maxScore: b.max,
      score: b.score,
      coverage,
      avoided: expectedLoss * coverage,
      retained: expectedLoss * (1 - coverage),
      controls: b.controls,
    });
  }

  // Most left on the table first: the order a remediation conversation should follow.
  threats.sort((x, y) => y.retained - x.retained);

  // Per control: the share of each threat's retained loss this control's own gap carries.
  const byControl = new Map<string, ControlRisk>();
  const exposureByThreat = new Map(threats.map((t) => [t.threat, t]));
  for (const r of tagged) {
    const tags = (threatsByControl.get(r.controlName) ?? []).map((t) => t.toLowerCase());
    let retired = 0;
    for (const t of tags) {
      const e = exposureByThreat.get(t);
      if (!e || e.maxScore <= 0) continue;
      // The points this control has yet to earn, as a share of the threat's total.
      const gapShare = (r.maxScore - r.score) / e.maxScore;
      retired += e.expectedLoss * gapShare;
    }
    byControl.set(r.controlName, {
      controlName: r.controlName,
      retiredIfDeployed: retired,
      threats: tags,
    });
  }

  const expectedLossAnnual = threats.reduce((s, t) => s + t.expectedLoss, 0);
  const avoidedAnnual = threats.reduce((s, t) => s + t.avoided, 0);

  return {
    analysis: {
      available: true,
      unavailableReason: null,
      threats,
      expectedLossAnnual,
      avoidedAnnual,
      retainedAnnual: expectedLossAnnual - avoidedAnnual,
      controlsWithoutThreatTag: untagged,
    },
    byControl,
  };
}

/** Effort as a number, so a roadmap can divide by it. Microsoft supplies the words. */
export function effortWeight(implementationCost: string | null, userImpact: string | null): number {
  const rank = (v: string | null): number => {
    switch ((v ?? '').toLowerCase()) {
      case 'low':
        return 1;
      case 'moderate':
        return 2;
      case 'high':
        return 3;
      default:
        // Unknown effort must not look cheap. Treated as moderate so an unrated control
        // neither jumps the queue nor sinks to the bottom of it.
        return 2;
    }
  };
  return rank(implementationCost) + rank(userImpact);
}

export interface RoadmapStep {
  controlName: string;
  displayName: string;
  service: string;
  /** Expected loss this step retires, per the stated assumptions. */
  riskRetired: number;
  /** Licence spend this step starts earning. */
  spendUnlocked: number | null;
  /** Secure Score points gained. */
  pointsGained: number;
  implementationCost: string | null;
  userImpact: string | null;
  effort: number;
  /** Value per unit of effort. The ordering, not a figure to quote. */
  ratio: number;
  costSkuName: string | null;
  actionUrl: string | null;
  remediation: string | null;
}

/**
 * The order to work in: value against effort.
 *
 * Value is risk retired plus licence spend that starts earning, because both are real and
 * a customer weighs them together. Effort is Microsoft's own implementation cost and user
 * impact — the two things that decide whether a change survives contact with a change
 * board.
 */
export function buildRoadmap(
  rows: CapabilityRow[],
  byControl: Map<string, ControlRisk>,
): RoadmapStep[] {
  return rows
    .filter((r) => r.state !== 'deployed')
    .map((r) => {
      const riskRetired = byControl.get(r.controlName)?.retiredIfDeployed ?? 0;
      const spendUnlocked = r.unlockableSpend;
      const effort = effortWeight(r.implementationCost, r.userImpact);
      return {
        controlName: r.controlName,
        displayName: r.displayName,
        service: r.service,
        riskRetired,
        spendUnlocked,
        pointsGained: r.maxScore - r.score,
        implementationCost: r.implementationCost,
        userImpact: r.userImpact,
        effort,
        ratio: (riskRetired + (spendUnlocked ?? 0)) / effort,
        costSkuName: r.costSkuName,
        actionUrl: r.actionUrl,
        remediation: r.remediation,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || b.pointsGained - a.pointsGained);
}
