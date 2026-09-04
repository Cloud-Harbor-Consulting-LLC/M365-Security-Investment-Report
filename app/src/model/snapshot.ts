/**
 * The snapshot contract — the seam between the PowerShell collector and this engine.
 *
 * Property names are PascalCase because that is what `Get-CHSISnapshot` emits. Do not
 * "tidy" them to camelCase: these types describe a file format produced by another
 * program, and renaming them here would silently stop matching real snapshots.
 */

export interface CollectorResult<T> {
  Name: string;
  /** False when the signal could not be collected at all. */
  Available: boolean;
  /** True when collected but incomplete — e.g. users without sign-in activity. */
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
