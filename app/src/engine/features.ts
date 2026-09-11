import type { SecureScoreData } from '@/model/snapshot';
import type { PriceList, SkuCatalog } from '@/model/reference';
import type { InventoryRow } from './inventory';

/**
 * Entitled versus deployed: the question the whole tool exists to answer.
 *
 * Owning a licence and having the capability switched on are different things, and the
 * gap between them is what a customer is paying for and not receiving. Deployment comes
 * from Secure Score, which already knows whether a control is enforced and costs no
 * scope beyond SecurityEvents.Read.All.
 *
 * One row per control Microsoft scores for the tenant. An earlier version listed only
 * the capabilities named in feature-map.json, which meant two tenants with different
 * licensing and different configuration produced an identical table, because the file was being
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
  /** Graph service code (normalised) to the product name a customer recognises. */
  serviceLabels?: { labels: Record<string, string> };
  /** Researched control-to-licence mapping. See the $research note in the JSON. */
  controlEntitlements?: {
    controls?: Record<string, string[]>;
    serviceDefaults?: Record<string, string[]>;
    /** SKUs that license agents, bots or sandboxes rather than the tenant's people. */
    nonUserLicensing?: {
      markerServicePlans?: string[];
      markerServicePlanPatterns?: string[];
      /** A SKU is agent-licensing only if its part number matches too. */
      markerPartNumberPatterns?: string[];
      skuPartNumbers?: string[];
    };
  };
}

export type DeploymentState = 'deployed' | 'partial' | 'notDeployed' | 'unknown';

/** How confident the Entitled by column is, which is not the same for every row. */
export type EntitlementBasis =
  /** Named SKUs the tenant owns, matched on the service plans that unlock the control. */
  | 'servicePlans'
  /** Needs no paid licence, so no licence spend is attributed to it. */
  | 'noLicenceRequired'
  /** A licence is required and the tenant owns none of them: scored, but not paid for. */
  | 'notEntitled'
  /** No entitlement research covers this control yet. Not the same as needing nothing. */
  | 'unmapped';

export interface CapabilityRow {
  controlName: string;
  displayName: string;
  /** Exchange Online, Microsoft Entra ID, Defender for Office, and so on. */
  service: string;
  /** SKU part numbers that entitle it. Empty when the basis is inference. */
  entitledBy: string[];
  entitlementBasis: EntitlementBasis;
  /** Service plans that unlock it. Empty when none are needed, or none are known. */
  requiredPlans: string[];
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
  /** The SKU whose cost this control carries. */
  costSku: string | null;
  /** That SKU's product name, so the table never shows a bare part number. */
  costSkuName: string | null;
  /**
   * 'owned': spend in use on an assigned licence.
   * 'unassigned': the licence is bought but assigned to nobody, so this is the annual
   *   commitment. Still money leaving the account, and still the cost of the capability.
   * 'listPrice': not owned. What buying it would cost.
   */
  costBasis: 'owned' | 'unassigned' | 'listPrice' | null;
  rank: number | null;
  implementationCost: string | null;
  userImpact: string | null;
  remediation: string | null;
  actionUrl: string | null;
  learnUrl: string | null;
}

/** One licence, and whether every control it enables is actually switched on. */
export interface LicenceRollup {
  skuPartNumber: string;
  /** Product name for display; part number remains the identifier. */
  displayName: string;
  annualCost: number;
  basis: 'owned' | 'unassigned' | 'listPrice';
  controls: number;
  deployed: number;
}

export interface FeatureAnalysis {
  available: boolean;
  unavailableReason: string | null;
  rows: CapabilityRow[];
  /** Per-licence rollup. The additive view, since the per-control column is not. */
  licences: LicenceRollup[];
  /** Licence spend allocated across scored controls. Null when nothing could be priced. */
  attributedSpend: number | null;
  /** Of that, the part already earned. */
  realizedSpend: number | null;
  /** Of that, the part deployment would unlock. */
  unlockableSpend: number | null;
  /**
   * Share of the security posture Microsoft measures for this tenant that is in place,
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
   * a stated maximum of 1,215, because the profile list is wider than the set that actually
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
 * Normalises a Graph service code to a lookup key: uppercase, with spaces, underscores
 * and hyphens removed. "Azure AD", "AzureAD" and "azure_ad" are the same service, and
 * mapping each spelling separately would mean fixing this once per variant Microsoft
 * happens to emit.
 */
const serviceKey = (raw: string): string => raw.toUpperCase().replace(/[\s_-]+/g, '');

function serviceLabel(raw: string | null, labels: Record<string, string>): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 'Other';
  // Unmapped codes pass through exactly as Graph returned them. Guessing at a product
  // name would put a label in a customer's report that Microsoft never used.
  return labels[serviceKey(trimmed)] ?? trimmed;
}

export interface FeatureAnalysisInput {
  featureMap: FeatureMap;
  inventory: InventoryRow[];
  /** Needed to price a licence the tenant does not own but would have to buy. */
  priceList: PriceList;
  /** Names a licence the tenant does not own, so a not-licensed row is still readable. */
  catalog: SkuCatalog;
  /** Seats a hypothetical purchase would have to cover: the tenant's assigned seats. */
  seatsConsumed: number;
  secureScore: SecureScoreData | null;
  secureScoreAvailable: boolean;
  secureScoreReason: string | null;
}

const EMPTY: Omit<FeatureAnalysis, 'available' | 'unavailableReason' | 'rows' | 'licences'> = {
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
  const { featureMap, inventory, priceList, catalog, seatsConsumed, secureScore, secureScoreAvailable, secureScoreReason } =
    input;

  if (!secureScoreAvailable || !secureScore) {
    return {
      available: false,
      unavailableReason:
        secureScoreReason ??
        'Secure Score was not collected, so whether these capabilities are deployed cannot be established.',
      rows: [],
      licences: [],
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
  const serviceLabels = featureMap.serviceLabels?.labels ?? {};

  /**
   * What a licence the tenant does not own would cost per year, at list price, sized to
   * the seats they actually assign. Priced by the service plan name, which for standalone
   * security SKUs is usually also the SKU part number (INTUNE_A, AAD_PREMIUM).
   */
  const catalogName = (part: string): string =>
    catalog.skus.find((k) => k.skuPartNumber === part)?.displayName ?? part;

  function listPriceFor(plan: string): { skuPartNumber: string; annual: number } | null {
    const entry = priceList.prices.find((p) => p.skuPartNumber === plan);
    if (!entry || entry.monthlyPerSeat === null || entry.monthlyPerSeat === undefined) return null;
    return { skuPartNumber: plan, annual: entry.monthlyPerSeat * 12 * Math.max(seatsConsumed, 1) };
  }

  // ── Entitlement ────────────────────────────────────────────────────────────
  //
  // Which licence actually unlocks each control, researched against Microsoft's own
  // licensing documentation and held in feature-map.json. This replaces splitting one
  // tenant-wide pot across every control: a control's spend now comes from the SKU that
  // entitles it, which is the only basis on which "what am I paying for this capability"
  // has an answer.
  const entitlements = featureMap.controlEntitlements;

  // Some SKUs license identities that are not the tenant's people. Microsoft Agent 365
  // Frontier carries an E5-grade plan list: AAD_PREMIUM_P2, MIP_S_CLP2,
  // ADALLOM_S_STANDALONE. So on plan names alone it read as the licence entitling 60
  // tenant controls, when what it entitles is Agent 365. Graph gives nothing to separate
  // them: appliesTo is "User" on every plan in that SKU, including the ones whose own
  // names end in FOR_AGENTS. Detected by those marker plans, so a future agent SKU is
  // covered without an edit here.
  const nonUser = entitlements?.nonUserLicensing;
  const markerPlans = new Set(nonUser?.markerServicePlans ?? []);
  const markerPatterns = (nonUser?.markerServicePlanPatterns ?? []).map((p) => new RegExp(p, 'i'));
  const excludedSkus = new Set(nonUser?.skuPartNumbers ?? []);

  const partPatterns = (nonUser?.markerPartNumberPatterns ?? []).map((p) => new RegExp(p, 'i'));

  const licensesUsers = (row: InventoryRow): boolean => {
    if (excludedSkus.has(row.skuPartNumber)) return false;

    const carriesAgentPlans = row.servicePlans.some(
      (p) =>
        markerPlans.has(p.ServicePlanName) ||
        markerPatterns.some((rx) => rx.test(p.ServicePlanName)),
    );
    if (!carriesAgentPlans) return true;

    // Carrying agent capability is not the same as being an agent licence. Microsoft 365
    // E7 bundles Agent 365 into a full user suite, carrying AGENT_365 and twelve *_FOR_AGENTS
    // plans among its 124, so the plan markers alone disqualified it from entitling
    // anything, and a demo tenant read 251 of 263 controls as not licensed. The part
    // number is what separates the two: MICROSOFT_AGENT_365_TIER_3 is an agent licence,
    // MICROSOFT_365_E7 is a user suite that happens to include agents.
    const looksLikeAgentSku = partPatterns.some((rx) => rx.test(row.skuPartNumber));
    return !looksLikeAgentSku;
  };

  const entitlingSkuPool = owned.filter(licensesUsers);

  const planIndex = new Map<string, InventoryRow[]>();
  for (const row of entitlingSkuPool) {
    for (const plan of row.servicePlans) {
      const list = planIndex.get(plan.ServicePlanName) ?? [];
      list.push(row);
      planIndex.set(plan.ServicePlanName, list);
    }
  }

  // Microsoft is inconsistent about the case of its own control names. One tenant
  // returns MDO_SafeLinksForOfficeApps where another returns mdo_safelinksforOfficeApps,
  // so the lookup is case-insensitive rather than needing an entry per spelling.
  const entitlementByControl = new Map(
    Object.entries(entitlements?.controls ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  /** The plans that unlock a control: an explicit entry, else the service default. */
  function requiredPlans(controlName: string, service: string | null): string[] | null {
    const explicit = entitlementByControl.get(controlName.toLowerCase());
    if (explicit) return explicit;
    const byService = entitlements?.serviceDefaults?.[serviceKey(service ?? '')];
    return byService ?? null;
  }

  function entitlingSkusFor(plans: string[]): InventoryRow[] {
    const found = new Set<InventoryRow>();
    for (const plan of plans) for (const row of planIndex.get(plan) ?? []) found.add(row);
    return [...found];
  }

  // The row set is what Microsoft SCORES for this tenant, not every profile it publishes.
  //
  // A production tenant returned 460 control profiles summing to 2,613 points against a
  // stated maximum of 1,215. The 210 profiles that also carry a score row sum to exactly
  // 1,215, and their scores sum to exactly the tenant's current score. The other 250 are
  // controls Microsoft describes but does not score here: not licensed, not applicable,
  // or retired. Including them inflated the attribution denominator by more than
  // double while filling the table with capabilities the tenant does not even have.
  //
  // Score rows include controls sitting at zero (39 of the 210 on that tenant), so
  // driving from them keeps every not-deployed gap. That was the risk worth checking
  // before making this change, and the data settled it.
  const profileByName = new Map(secureScore.ControlProfiles.map((p) => [p.ControlName, p]));
  const profiles = secureScore.ControlScores.map((s) => profileByName.get(s.ControlName)).filter(
    (p): p is NonNullable<typeof p> => Boolean(p) && p!.MaxScore > 0,
  );
  const profileMaxTotal = profiles.reduce((sum, p) => sum + p.MaxScore, 0);

  const rows: CapabilityRow[] = profiles.map((p) => {
    const curated = curatedByControl.get(p.ControlName);
    const score = scoreByControl.get(p.ControlName)?.Score ?? 0;
    const ratio = Math.max(0, Math.min(1, score / p.MaxScore));
    const state: DeploymentState = ratio >= 0.9 ? 'deployed' : ratio > 0 ? 'partial' : 'notDeployed';

    const plans = requiredPlans(p.ControlName, p.Service);
    // An empty requirement means the control needs no paid licence. A missing one means
    // nobody has mapped it yet, which is a different thing and must not be shown as free.
    const isBaseline = plans !== null && plans.length === 0;
    const skus = plans && plans.length > 0 ? entitlingSkusFor(plans) : [];

    const basis: EntitlementBasis = isBaseline
      ? 'noLicenceRequired'
      : plans === null
        ? 'unmapped'
        : skus.length > 0
          ? 'servicePlans'
          : 'notEntitled';

    return {
      controlName: p.ControlName,
      displayName: curated?.displayName ?? p.Title ?? p.ControlName,
      service: serviceLabel(p.Service, serviceLabels),
      entitledBy: skus.map((r) => r.skuPartNumber).sort(),
      entitlementBasis: basis,
      requiredPlans: plans ?? [],
      state,
      score,
      maxScore: p.MaxScore,
      scoreRatio: ratio,
      // Filled in below, once the enabling licence is resolved.
      costSku: null,
      costSkuName: null,
      costBasis: null,
      attributedSpend: null,
      realizedSpend: null,
      unlockableSpend: null,
      baseline: isBaseline,
      rank: p.Rank,
      implementationCost: p.ImplementationCost,
      userImpact: p.UserImpact,
      remediation: p.Remediation,
      actionUrl: p.ActionUrl,
      learnUrl: curated?.learnUrl ?? null,
    } satisfies CapabilityRow;
  });

  // ── Cost of a control = cost of the licence that enables it ────────────────
  //
  // Not a share of anything. A control's spend is the whole annual cost of the cheapest
  // SKU the tenant owns that enables it, because that is the number the question is
  // really asking: mailbox auditing is off, and Exchange Online Plan 1 is what you pay to
  // have it. Dividing that across the nine controls the same SKU enables produced figures
  // under a dollar and answered nothing.
  //
  // The consequence, stated because it governs how this may be displayed: the column is
  // NOT additive. Nine controls needing one SKU each carry that SKU's full cost, and
  // summing them would multiply one licence by nine. Totals are rolled up per SKU below,
  // counting each licence once.
  let anyPriced = false;

  for (const r of rows) {
    if (r.entitlementBasis === 'noLicenceRequired' || r.entitlementBasis === 'unmapped') continue;

    // The minimum qualifying licence: the cheaper PRODUCT, since a tenant holding both E5
    // and Exchange Online Plan 1 is not spending E5 money to audit mailboxes.
    //
    // Ranked by per-seat price, not by total annual cost. Total cost scales with seat
    // count, so ranking on it made a one-seat premium SKU look cheaper than a fifty-seat
    // basic one, and worse, made any SKU assigned to nobody cost zero and therefore win
    // every comparison. A tenant with an unassigned trial SKU saw every control it touched
    // priced at $0.
    //
    // Licences with no assigned seats are excluded outright: a licence nobody holds is not
    // what enables a capability for the people who do. They are unassigned spend, which is
    // the seat-waste analysis's subject, not this one's.
    const qualifying = owned
      .filter(
        (s) =>
          r.entitledBy.includes(s.skuPartNumber) &&
          s.annualSpendConsumed !== null &&
          s.consumedUnits > 0 &&
          s.unitPriceMonthly !== null,
      )
      // Dearest first. A capability bundled into several licences is attributed to the
      // most expensive one the tenant holds, because that is the licence whose value is
      // most at stake if the capability stays switched off.
      .sort(
        (a, b) =>
          (b.annualSpendConsumed ?? 0) - (a.annualSpendConsumed ?? 0) ||
          (b.unitPriceMonthly ?? 0) - (a.unitPriceMonthly ?? 0),
      );

    // A licence bought and assigned to nobody is still money leaving the account, so it
    // is a fallback rather than an exclusion. Excluding it outright, which was the first fix for
    // the zero-cost defect, meant a tenant that had bought Defender for Endpoint and not
    // yet rolled it out saw no figure at all against 118 controls. The original defect
    // stays fixed because ranking is by per-seat price now, so a zero-seat SKU can only
    // be reached when no assigned licence qualifies at all.
    const unassignedFallback = owned
      .filter(
        (s) =>
          r.entitledBy.includes(s.skuPartNumber) &&
          s.consumedUnits === 0 &&
          s.purchasedUnits > 0 &&
          s.annualCommitment !== null &&
          s.unitPriceMonthly !== null,
      )
      .sort((a, b) => (b.annualCommitment ?? 0) - (a.annualCommitment ?? 0));

    if (qualifying.length > 0) {
      const chosen = qualifying[0]!;
      r.costSku = chosen.skuPartNumber;
      r.costSkuName = chosen.displayName;
      r.costBasis = 'owned';
      r.attributedSpend = chosen.annualSpendConsumed;
      anyPriced = true;
    } else if (unassignedFallback.length > 0) {
      const chosen = unassignedFallback[0]!;
      r.costSku = chosen.skuPartNumber;
      r.costSkuName = chosen.displayName;
      r.costBasis = 'unassigned';
      r.attributedSpend = chosen.annualCommitment;
      anyPriced = true;
    } else if (r.entitlementBasis === 'notEntitled') {
      // Not owned. What closing this would cost, at list price, flagged as new spend so
      // it is never mistaken for money already committed.
      const priced = r.requiredPlans
        .map((plan) => listPriceFor(plan))
        .filter((x): x is { skuPartNumber: string; annual: number } => x !== null)
        .sort((a, b) => a.annual - b.annual);
      if (priced.length > 0) {
        r.costSku = priced[0]!.skuPartNumber;
        r.costSkuName = catalogName(priced[0]!.skuPartNumber);
        r.costBasis = 'listPrice';
        r.attributedSpend = priced[0]!.annual;
      }
    }

    if (r.attributedSpend !== null) {
      const deployed = r.state === 'deployed';
      r.realizedSpend = deployed ? r.attributedSpend : 0;
      r.unlockableSpend = deployed ? 0 : r.attributedSpend;
    }
  }

  // Most money on the table first: the order the conversation should follow. Deployed
  // rows have nothing left to unlock, so they fall to the bottom on their own.
  rows.sort(
    (a, b) =>
      (b.unlockableSpend ?? 0) - (a.unlockableSpend ?? 0) ||
      b.maxScore - a.maxScore ||
      a.displayName.localeCompare(b.displayName),
  );

  // ── Totals, rolled up per licence ──────────────────────────────────────────
  //
  // Each control carries the whole cost of the SKU that enables it, so the column cannot
  // be summed. Nine controls needing Exchange Online Plan 1 would multiply one licence
  // by nine. Rolled up per SKU instead, counting each licence once and asking of each:
  // is every control it enables actually switched on?
  const licences = new Map<string, LicenceRollup>();
  for (const r of rows) {
    if (!r.costSku || r.attributedSpend === null) continue;
    const existing = licences.get(r.costSku);
    const entry: LicenceRollup = existing ?? {
      skuPartNumber: r.costSku,
      displayName: r.costSkuName ?? r.costSku,
      annualCost: r.attributedSpend,
      basis: r.costBasis ?? 'owned',
      controls: 0,
      deployed: 0,
    };
    entry.controls += 1;
    if (r.state === 'deployed') entry.deployed += 1;
    licences.set(r.costSku, entry);
  }
  const rollup = [...licences.values()].sort((a, b) => b.annualCost - a.annualCost);

  // Both count as committed: an unassigned licence is still invoiced.
  const owningRollup = rollup.filter((l) => l.basis === 'owned' || l.basis === 'unassigned');
  const committed = owningRollup.reduce((t, l) => t + l.annualCost, 0);
  // A licence is earned in proportion to how many of the controls it enables are actually
  // in place. All-or-nothing was the first attempt and it reported zero earned on a tenant
  // with 134 of 162 controls deployed. Technically defensible, useless to act on, and
  // wrong in the direction that overstates the problem.
  const earned = owningRollup.reduce(
    (t, l) => t + (l.controls > 0 ? (l.annualCost * l.deployed) / l.controls : 0),
    0,
  );

  return {
    available: true,
    unavailableReason: null,
    rows,
    licences: rollup,
    attributedSpend: owningRollup.length > 0 ? committed : null,
    realizedSpend: owningRollup.length > 0 ? earned : null,
    unlockableSpend: owningRollup.length > 0 ? committed - earned : null,
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
