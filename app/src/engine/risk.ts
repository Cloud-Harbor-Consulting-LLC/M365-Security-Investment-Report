import type { CapabilityRow, NewlyEntitled } from './features';
import type { InventoryRow } from './inventory';
import type { TenantUser } from '@/model/snapshot';

/**
 * Expected loss, and what deployment would retire.
 *
 * Two numbers a customer will argue with, how likely and how much, so they live in
 * one editable file and every figure derived from them is labelled an assumption. The
 * report never presents this as a measurement; it is the arithmetic of a stated model,
 * shown so the customer can push back on the inputs rather than the conclusion.
 */

/**
 * Normalises a threat name to a lookup key: letters only, lowercased.
 *
 * Graph documents these values as camelCase (accountBreach) and returns them as Title
 * Case with spaces ("Account breach"), and inconsistently, so one production tenant carries
 * both "Account breach" and "Account Breach" in the same response. Matching on the
 * documented spelling found none of the nine values that tenant actually returned, which
 * would have silently fallen back to the default likelihood and impact for every control
 * while looking entirely healthy.
 */
export const threatKey = (raw: string): string => raw.toLowerCase().replace(/[^a-z]/g, '');

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
  /** Absent from a risk model written before v1.1, which then applies its impacts unscaled. */
  sizeScaling?: { referenceHeadcount: number; exponent: number };
  defaults: { annualLikelihood: number; impactUsd: number; impactBasis: string };
  threats: ThreatAssumption[];
}

/** Where the headcount came from, so the report can say. */
export type HeadcountBasis = 'licensedAccounts' | 'assignedSeats';

export interface Headcount {
  count: number;
  basis: HeadcountBasis;
}

/** How the shipped impacts were sized to this tenant. */
export interface RiskScale {
  /** Null when no headcount could be established, so the impacts stand as shipped. */
  headcount: number | null;
  basis: HeadcountBasis | null;
  /** The size the shipped impacts describe. Null when the model does not scale. */
  referenceHeadcount: number | null;
  exponent: number | null;
  /** Multiplier on every shipped impact. Exactly 1 when unscaled. */
  factor: number;
}

export interface ThreatExposure {
  threat: string;
  displayName: string;
  annualLikelihood: number;
  /** The impact used here: the shipped figure sized to this tenant. */
  impactUsd: number;
  /** The shipped figure, for an organisation of the reference size. */
  baseImpactUsd: number;
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
  scale: RiskScale;
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
  /** The tenant's size, or null when it could not be established. */
  headcount: Headcount | null;
}

/**
 * How many people the tenant has, as near as the snapshot can say.
 *
 * Enabled accounts holding a licence are the people a breach would reach. That count is
 * never taken as lower than the most seats assigned on any one paid licence, because each
 * of those seats is held by a different account, so a user list that came back short
 * cannot shrink the tenant. Free licences are left out of that floor: a free Power BI
 * or Power Automate seat is handed to anyone who clicks a trial, guests included.
 */
export function estimateHeadcount(
  users: readonly TenantUser[] | null,
  inventory: readonly InventoryRow[],
): Headcount | null {
  const seats = Math.max(
    0,
    ...inventory.filter((r) => !r.isFreeSku && !r.excluded).map((r) => r.consumedUnits),
  );
  const accounts = users ? users.filter((u) => u.AccountEnabled && u.AssignedSkuIds.length > 0).length : 0;

  if (accounts > 0 && accounts >= seats) return { count: accounts, basis: 'licensedAccounts' };
  if (seats > 0) return { count: seats, basis: 'assignedSeats' };
  return null;
}

/**
 * Sizes the shipped impacts to this tenant.
 *
 * A power of headcount below 1, so impact grows with size but more slowly: a fraudulent
 * payment costs the same at 50 people as at 5,000, and downtime does not. The reference
 * size and the exponent are assumptions, kept in risk-model.json beside the impacts they
 * qualify.
 */
export function riskScale(riskModel: RiskModel, headcount: Headcount | null): RiskScale {
  const s = riskModel.sizeScaling;
  const usable = s && s.referenceHeadcount > 0 && Number.isFinite(s.exponent);
  if (!headcount || !usable) {
    return {
      headcount: headcount?.count ?? null,
      basis: headcount?.basis ?? null,
      referenceHeadcount: usable ? s.referenceHeadcount : null,
      exponent: usable ? s.exponent : null,
      factor: 1,
    };
  }
  return {
    headcount: headcount.count,
    basis: headcount.basis,
    referenceHeadcount: s.referenceHeadcount,
    exponent: s.exponent,
    factor: (headcount.count / s.referenceHeadcount) ** s.exponent,
  };
}

/**
 * The sizing, said in a sentence. Every surface that shows an impact says how it was
 * sized, because "$400,000" means nothing to a reader who does not know for how many people.
 */
export function describeScale(scale: RiskScale): string {
  const n = (v: number) => v.toLocaleString('en-US');
  if (scale.referenceHeadcount === null) {
    return 'The risk model sets no reference size, so impacts are not sized to this tenant.';
  }
  if (scale.headcount === null) {
    return `No headcount could be established, so impacts stand as the risk model states them, for an organisation of ${n(scale.referenceHeadcount)} people.`;
  }
  const who =
    scale.basis === 'licensedAccounts'
      ? 'the enabled accounts holding a licence'
      : 'the most seats assigned on any one paid licence, which is a floor on headcount';
  return `Impact is sized to ${n(scale.headcount)} people, ${who}. The risk model's impacts describe an organisation of ${n(scale.referenceHeadcount)}, so each is multiplied by ${scale.factor.toFixed(2)}.`;
}

export function analyzeRisk(input: RiskInput): {
  analysis: RiskAnalysis;
  byControl: Map<string, ControlRisk>;
} {
  const { riskModel, rows, threatsByControl } = input;
  const scale = riskScale(riskModel, input.headcount);

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
        scale,
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
        scale,
      },
      byControl: new Map(),
    };
  }

  const assumptions = new Map(riskModel.threats.map((t) => [threatKey(t.threat), t]));

  // Points per threat, so a threat's exposure is reduced by what is actually deployed.
  // Microsoft's weighting again: a 40-point control mitigating account breach counts for
  // four times a 10-point one, because that is the judgement Microsoft published.
  const buckets = new Map<string, { max: number; score: number; controls: number }>();
  for (const r of tagged) {
    for (const raw of threatsByControl.get(r.controlName) ?? []) {
      const key = threatKey(raw);
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
    const baseImpactUsd = a?.impactUsd ?? riskModel.defaults.impactUsd;
    const impactUsd = baseImpactUsd * scale.factor;
    const expectedLoss = annualLikelihood * impactUsd;
    const coverage = b.max > 0 ? Math.max(0, Math.min(1, b.score / b.max)) : 0;

    threats.push({
      threat: key,
      // Fall back to the vendor's own wording rather than the normalised key, so an
      // unmapped threat still reads as a threat rather than as "accountbreach".
      displayName: a?.displayName ?? key,
      annualLikelihood,
      impactUsd,
      baseImpactUsd,
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
    const tags = (threatsByControl.get(r.controlName) ?? []).map(threatKey);
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
      scale,
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
  /** Set when a recent packaging change is the only reason the tenant has this control. */
  newlyEntitled: NewlyEntitled | null;
}

/**
 * The order to work in: value against effort.
 *
 * Value is risk retired plus licence spend that starts earning, because both are real and
 * a customer weighs them together. Effort is Microsoft's own implementation cost and user
 * impact, the two things that decide whether a change survives contact with a change
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
        newlyEntitled: r.newlyEntitled,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || b.pointsGained - a.pointsGained);
}
