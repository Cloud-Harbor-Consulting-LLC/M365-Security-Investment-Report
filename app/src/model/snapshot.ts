/**
 * The snapshot contract: the seam between the PowerShell collector and this engine.
 *
 * Property names are PascalCase because that is what `Get-CHSISnapshot` emits. Do not
 * "tidy" them to camelCase: these types describe a file format produced by another
 * program, and renaming them here would silently stop matching real snapshots.
 */

export interface CollectorResult<T> {
  Name: string;
  /** False when the signal could not be collected at all. */
  Available: boolean;
  /** True when collected but incomplete, such as users without sign-in activity. */
  Degraded: boolean;
  Reason: string | null;
  Notes: string[];
  CollectedAt: string;
  Data: T;
}

export interface VerifiedDomain {
  Name: string;
  IsDefault: boolean;
  IsInitial: boolean;
}

export interface OrganizationData {
  TenantId: string;
  DisplayName: string;
  CountryLetterCode: string | null;
  CreatedDateTime: string | null;
  VerifiedDomains: VerifiedDomain[];
  DefaultDomain: string | null;
  /**
   * The square logo from the tenant's Entra company branding, as data URIs, so a saved
   * snapshot and the one-file report show it without calling Graph again. Absent from
   * snapshots made before it was collected, and null when the tenant set none.
   */
  Logo?: TenantLogo | null;
}

export interface TenantLogo {
  /** The square logo, for a light background. */
  Light: string | null;
  /** The dark-theme square logo, when the tenant set one. */
  Dark: string | null;
}

export interface ServicePlan {
  ServicePlanId: string;
  ServicePlanName: string;
  ProvisioningStatus: string;
  AppliesTo: string;
}

export interface SubscribedSku {
  SkuId: string;
  SkuPartNumber: string;
  AppliesTo: string | null;
  CapabilityStatus: string | null;
  ConsumedUnits: number;
  /** Purchased seats. Graph calls this prepaidUnits.enabled. */
  PrepaidEnabled: number;
  PrepaidSuspended: number;
  PrepaidWarning: number;
  ServicePlans: ServicePlan[];
}

export interface ScopeEvaluation {
  Scope: string;
  Required: boolean;
  Granted: boolean;
  Purpose: string;
  LeastPrivilegeRole: string;
}

export interface ScopeAssessment {
  Scopes: ScopeEvaluation[];
  GrantedScopes: string[];
  MissingRequired: string[];
  MissingOptional: string[];
  ExtraScopes?: string[];
  ExtraWriteScopes?: string[];
  Satisfied: boolean;
}

export interface TenantUser {
  Id: string;
  DisplayName: string | null;
  UserPrincipalName: string | null;
  AccountEnabled: boolean;
  UserType: string | null;
  CreatedDateTime: string | null;
  Department: string | null;
  /** SKU ids assigned to this account, matching subscribedSkus[].SkuId. */
  AssignedSkuIds: string[];
  /** Null when the tenant lacks Entra ID P1, which is a different thing from never. */
  LastSignIn: string | null;
  LastNonInteractiveSignIn: string | null;
}

export interface ControlScore {
  ControlName: string;
  ControlCategory: string | null;
  Score: number;
  Description: string | null;
  State: string | null;
}

export interface ControlProfile {
  ControlName: string;
  Title: string | null;
  /** The denominator. Without it a raw control score cannot be read as deployed or not. */
  MaxScore: number;
  Service: string | null;
  Tier: string | null;
  Rank: number | null;
  Remediation: string | null;
  ImplementationCost: string | null;
  UserImpact: string | null;
  ActionUrl: string | null;
  /** accountBreach, dataExfiltration, elevationOfPrivilege, phishingOrWhaling, … */
  Threats?: string[];
  /** Identity, Data, Device, Apps, Infrastructure. */
  ControlCategory?: string | null;
  Deprecated?: boolean;
}

export interface SecureScoreData {
  CurrentScore: number;
  MaxScore: number;
  CreatedDateTime: string | null;
  ControlScores: ControlScore[];
  /** Peer averages by seat count and industry, straight from Graph. */
  Comparative: Array<{ Basis: string; AverageScore: number }>;
  History: Array<{ CreatedDateTime: string; CurrentScore: number; MaxScore: number }>;
  ControlProfiles: ControlProfile[];
}

/** One account's use of the Microsoft 365 apps, by platform, over the report period. */
export interface AppUsageUser {
  /** An opaque value instead of a name when the tenant conceals names in usage reports. */
  UserPrincipalName: string;
  Windows: boolean;
  Mac: boolean;
  Mobile: boolean;
  Web: boolean;
}

export interface AppUsageData {
  PeriodDays: number;
  ReportRefreshDate: string | null;
  /** True when Microsoft replaced every name, so rows cannot be matched to accounts. */
  Concealed: boolean;
  Users: AppUsageUser[];
}

export interface SnapshotContext {
  TenantId: string;
  Account: string | null;
  ClientId: string | null;
  AuthType: string;
  Scopes: string[];
}

export interface Snapshot {
  SchemaVersion: string;
  GeneratedAt: string;
  Tool: { Name: string; Version: string };
  /** 'Graph' when collected live; identifies provenance, not this run. */
  Source: string;
  Context: SnapshotContext;
  ScopeAssessment?: ScopeAssessment;
  Collectors: {
    organization: CollectorResult<OrganizationData | null>;
    subscribedSkus: CollectorResult<SubscribedSku[] | null>;
    /** Absent in snapshots taken before user collection existed. */
    users?: CollectorResult<TenantUser[] | null>;
    /** Absent without SecurityEvents.Read.All, or in older snapshots. */
    secureScore?: CollectorResult<SecureScoreData | null>;
    /** Absent without Reports.Read.All, or in snapshots taken before v1.1. */
    appUsage?: CollectorResult<AppUsageData | null>;
  };
  RunLog?: unknown[];
}

/**
 * Validates enough of an unknown object to trust it as a snapshot, and explains what is
 * wrong when it is not. Users drop arbitrary JSON onto this app; a blank screen is not
 * an acceptable answer to the wrong file.
 */
export function parseSnapshot(value: unknown): { ok: true; snapshot: Snapshot } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'That file does not contain a JSON object.' };
  }

  const candidate = value as Partial<Snapshot>;

  if (!candidate.Collectors) {
    return {
      ok: false,
      reason: 'That JSON has no "Collectors" section, so it is not a snapshot. Produce one with Get-CHSISnapshot -Path <file>.',
    };
  }

  const skus = candidate.Collectors.subscribedSkus;
  if (!skus) {
    return { ok: false, reason: 'The snapshot has no subscribedSkus collector. It may be from an incompatible version.' };
  }

  if (!skus.Available || !Array.isArray(skus.Data)) {
    const why = skus.Reason ? ` ${skus.Reason}` : '';
    return {
      ok: false,
      reason: `The snapshot was collected but its SKU inventory is unavailable, so there is nothing to analyse.${why}`,
    };
  }

  return { ok: true, snapshot: candidate as Snapshot };
}
