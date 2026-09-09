import type {
  CollectorResult,
  OrganizationData,
  ScopeAssessment,
  ScopeEvaluation,
  SecureScoreData,
  Snapshot,
  SubscribedSku,
  TenantUser,
} from '@/model/snapshot';
import { graphGet, GraphError } from './client';
import { graphScopes } from './scopes';
import type { SignedInContext } from './auth';

/**
 * Browser-side collection.
 *
 * Deliberately produces the exact snapshot shape `Get-CHSISnapshot` emits, PascalCase
 * and all, so the engine, the fixtures and the parity tests are shared by both paths.
 * A snapshot collected here is interchangeable with one collected by PowerShell.
 */

export interface CollectionStep {
  key: string;
  label: string;
  endpoint: string;
}

export const COLLECTION_STEPS: CollectionStep[] = [
  { key: 'organization', label: 'Tenant identity and verified domains', endpoint: '/v1.0/organization' },
  { key: 'subscribedSkus', label: 'Subscribed licences and service plans', endpoint: '/v1.0/subscribedSkus' },
  { key: 'users', label: 'Accounts, licence assignment and sign-in activity', endpoint: '/v1.0/users' },
  {
    key: 'secureScore',
    label: 'Secure Score, history and control-level status',
    endpoint: '/v1.0/security/secureScores',
  },
];

export type StepState = 'pending' | 'running' | 'done' | 'degraded' | 'failed';

export interface StepProgress {
  key: string;
  state: StepState;
  detail: string | null;
}

export type ProgressHandler = (progress: StepProgress) => void;

function envelope<T>(
  name: string,
  data: T,
  options: { available?: boolean; degraded?: boolean; reason?: string | null } = {},
): CollectorResult<T> {
  return {
    Name: name,
    Available: options.available ?? true,
    Degraded: options.degraded ?? false,
    Reason: options.reason ?? null,
    Notes: [],
    CollectedAt: new Date().toISOString(),
    Data: data,
  };
}

/** Explains a Graph failure in terms of what it means for the report. */
function describeFailure(error: unknown): string {
  if (error instanceof GraphError) {
    if (error.status === 403) {
      return `Access denied (403${error.code ? `, ${error.code}` : ''}). The signed-in account or the consented permissions do not cover this data.`;
    }
    if (error.status === 401) {
      return 'The access token was rejected (401). Sign in again.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function collectOrganization(token: string, signal?: AbortSignal): Promise<CollectorResult<OrganizationData | null>> {
  try {
    const body = await graphGet<{ value?: Array<Record<string, unknown>> }>('/v1.0/organization', token, { signal });
    const org = body.value?.[0];
    if (!org) {
      return envelope('organization', null, {
        available: false,
        reason: 'Graph returned no organization object for this tenant.',
      });
    }

    const domains = Array.isArray(org['verifiedDomains'])
      ? (org['verifiedDomains'] as Array<Record<string, unknown>>).map((d) => ({
          Name: String(d['name'] ?? ''),
          IsDefault: Boolean(d['isDefault']),
          IsInitial: Boolean(d['isInitial']),
        }))
      : [];

    return envelope('organization', {
      TenantId: String(org['id'] ?? ''),
      DisplayName: String(org['displayName'] ?? ''),
      CountryLetterCode: (org['countryLetterCode'] as string | undefined) ?? null,
      CreatedDateTime: (org['createdDateTime'] as string | undefined) ?? null,
      VerifiedDomains: domains,
      DefaultDomain: domains.find((d) => d.IsDefault)?.Name ?? null,
    });
  } catch (error) {
    return envelope<OrganizationData | null>('organization', null, {
      available: false,
      reason: `Could not read /organization: ${describeFailure(error)}`,
    });
  }
}

async function collectSubscribedSkus(token: string, signal?: AbortSignal): Promise<CollectorResult<SubscribedSku[] | null>> {
  try {
    const raw = await graphGet<Array<Record<string, unknown>>>('/v1.0/subscribedSkus', token, {
      all: true,
      signal,
    });

    const skus: SubscribedSku[] = raw.map((sku) => {
      const prepaid = (sku['prepaidUnits'] ?? {}) as Record<string, unknown>;
      const plans = Array.isArray(sku['servicePlans']) ? (sku['servicePlans'] as Array<Record<string, unknown>>) : [];

      return {
        SkuId: String(sku['skuId'] ?? ''),
        SkuPartNumber: String(sku['skuPartNumber'] ?? ''),
        AppliesTo: (sku['appliesTo'] as string | undefined) ?? null,
        CapabilityStatus: (sku['capabilityStatus'] as string | undefined) ?? null,
        ConsumedUnits: Number(sku['consumedUnits'] ?? 0),
        PrepaidEnabled: Number(prepaid['enabled'] ?? 0),
        PrepaidSuspended: Number(prepaid['suspended'] ?? 0),
        PrepaidWarning: Number(prepaid['warning'] ?? 0),
        ServicePlans: plans.map((p) => ({
          ServicePlanId: String(p['servicePlanId'] ?? ''),
          ServicePlanName: String(p['servicePlanName'] ?? ''),
          ProvisioningStatus: String(p['provisioningStatus'] ?? ''),
          AppliesTo: String(p['appliesTo'] ?? ''),
        })),
      };
    });

    return envelope('subscribedSkus', skus);
  } catch (error) {
    return envelope<SubscribedSku[] | null>('subscribedSkus', null, {
      available: false,
      reason: `Could not read /subscribedSkus: ${describeFailure(error)}`,
    });
  }
}

/**
 * Collects accounts, with sign-in activity where the tenant is entitled to it.
 *
 * signInActivity is gated on Entra ID P1, and Graph does not merely omit the field
 * without it — it returns 403 for the ENTIRE query. Failing there would cost the
 * disabled-but-licensed analysis too, which needs no premium licence at all. So the
 * query is attempted with the field and retried without it on 403, mirroring the
 * PowerShell collector so both paths produce interchangeable snapshots.
 */
async function collectUsers(
  token: string,
  signal?: AbortSignal,
): Promise<CollectorResult<TenantUser[] | null>> {
  const select =
    'id,displayName,userPrincipalName,accountEnabled,userType,createdDateTime,assignedLicenses,department';
  const withActivity = `/v1.0/users?$select=${select},signInActivity&$top=999`;
  const withoutActivity = `/v1.0/users?$select=${select}&$top=999`;

  const toUser = (raw: Record<string, unknown>): TenantUser => {
    const activity = (raw['signInActivity'] ?? null) as Record<string, unknown> | null;
    const licences = Array.isArray(raw['assignedLicenses'])
      ? (raw['assignedLicenses'] as Array<Record<string, unknown>>)
      : [];

    return {
      Id: String(raw['id'] ?? ''),
      DisplayName: (raw['displayName'] as string | undefined) ?? null,
      UserPrincipalName: (raw['userPrincipalName'] as string | undefined) ?? null,
      AccountEnabled: Boolean(raw['accountEnabled']),
      UserType: (raw['userType'] as string | undefined) ?? null,
      CreatedDateTime: (raw['createdDateTime'] as string | undefined) ?? null,
      Department: (raw['department'] as string | undefined) ?? null,
      AssignedSkuIds: licences.map((l) => String(l['skuId'] ?? '')).filter(Boolean),
      LastSignIn: (activity?.['lastSignInDateTime'] as string | undefined) ?? null,
      LastNonInteractiveSignIn: (activity?.['lastNonInteractiveSignInDateTime'] as string | undefined) ?? null,
    };
  };

  try {
    const raw = await graphGet<Array<Record<string, unknown>>>(withActivity, token, { all: true, signal });
    return envelope('users', raw.map(toUser));
  } catch (error) {
    if (!(error instanceof GraphError) || error.status !== 403) {
      return envelope<TenantUser[] | null>('users', null, {
        available: false,
        reason: `Could not read /users: ${describeFailure(error)}`,
      });
    }

    try {
      const raw = await graphGet<Array<Record<string, unknown>>>(withoutActivity, token, { all: true, signal });
      return envelope('users', raw.map(toUser), {
        degraded: true,
        reason:
          'Sign-in activity requires Entra ID P1 and AuditLog.Read.All. Graph refuses the whole user query ' +
          'without them, so it was re-run without that field. Account state and licence assignment are ' +
          'complete; the never-signed-in and inactive categories are not measured.',
      });
    } catch (retryError) {
      return envelope<TenantUser[] | null>('users', null, {
        available: false,
        reason: `Could not read /users even without sign-in activity: ${describeFailure(retryError)}`,
      });
    }
  }
}

/**
 * Collects Secure Score, its history, peer benchmarks and control-level detail.
 *
 * The evidence source for entitled-versus-deployed. Gated on SecurityEvents.Read.All,
 * which is optional — a tenant that has not granted it still gets licence inventory,
 * spend and seat waste, so a failure here degrades the feature analysis rather than
 * ending the run.
 */
async function collectSecureScore(
  token: string,
  signal?: AbortSignal,
): Promise<CollectorResult<SecureScoreData | null>> {
  let scores: Array<Record<string, unknown>>;

  try {
    // Newest first; 90 days is what the endpoint retains and what a trend line needs.
    scores = await graphGet<Array<Record<string, unknown>>>('/v1.0/security/secureScores?$top=90', token, {
      all: true,
      signal,
    });
  } catch (error) {
    const denied = error instanceof GraphError && error.status === 403;
    return envelope<SecureScoreData | null>('secureScore', null, {
      available: false,
      reason: denied
        ? 'Secure Score requires SecurityEvents.Read.All, which was not granted. The deployed-versus-entitled analysis cannot be produced without it; everything else in this report is unaffected.'
        : `Could not read Secure Score: ${describeFailure(error)}`,
    });
  }

  const latest = scores[0];
  if (!latest) {
    return envelope<SecureScoreData | null>('secureScore', null, {
      available: false,
      reason: 'Graph returned no Secure Score history for this tenant.',
    });
  }

  // Profiles carry the denominator. Without them a raw control score cannot be read as
  // deployed or not, so their absence degrades rather than fails.
  let profiles: Array<Record<string, unknown>> = [];
  let profileReason: string | null = null;
  try {
    profiles = await graphGet<Array<Record<string, unknown>>>(
      '/v1.0/security/secureScoreControlProfiles',
      token,
      { all: true, signal },
    );
  } catch (error) {
    profileReason = `Control profiles could not be read, so control scores cannot be interpreted as deployed or not: ${describeFailure(error)}`;
  }

  const controlScores = Array.isArray(latest['controlScores'])
    ? (latest['controlScores'] as Array<Record<string, unknown>>)
    : [];
  const comparative = Array.isArray(latest['averageComparativeScores'])
    ? (latest['averageComparativeScores'] as Array<Record<string, unknown>>)
    : [];

  const data: SecureScoreData = {
    CurrentScore: Number(latest['currentScore'] ?? 0),
    MaxScore: Number(latest['maxScore'] ?? 0),
    CreatedDateTime: (latest['createdDateTime'] as string | undefined) ?? null,
    ControlScores: controlScores.map((c) => ({
      ControlName: String(c['controlName'] ?? ''),
      ControlCategory: (c['controlCategory'] as string | undefined) ?? null,
      Score: Number(c['score'] ?? 0),
      Description: (c['description'] as string | undefined) ?? null,
      State: (c['implementationStatus'] as string | undefined) ?? null,
    })),
    Comparative: comparative.map((c) => ({
      Basis: String(c['basis'] ?? ''),
      AverageScore: Number(c['averageScore'] ?? 0),
    })),
    History: scores.map((s) => ({
      CreatedDateTime: String(s['createdDateTime'] ?? ''),
      CurrentScore: Number(s['currentScore'] ?? 0),
      MaxScore: Number(s['maxScore'] ?? 0),
    })),
    ControlProfiles: profiles.map((p) => ({
      ControlName: String(p['id'] ?? ''),
      Title: (p['title'] as string | undefined) ?? null,
      MaxScore: Number(p['maxScore'] ?? 0),
      Service: (p['service'] as string | undefined) ?? null,
      Tier: (p['tier'] as string | undefined) ?? null,
      Rank: p['rank'] === undefined ? null : Number(p['rank']),
      Remediation: (p['remediation'] as string | undefined) ?? null,
      ImplementationCost: (p['implementationCost'] as string | undefined) ?? null,
      UserImpact: (p['userImpact'] as string | undefined) ?? null,
      ActionUrl: (p['actionUrl'] as string | undefined) ?? null,
    })),
  };

  return envelope('secureScore', data, { degraded: Boolean(profileReason), reason: profileReason });
}

/**
 * Compares granted scopes against what the tool asks for, and discloses anything extra
 * the session happens to carry — including write scopes, which this tool never uses but
 * which a report claiming least privilege must not stay silent about.
 */
export function assessScopes(granted: string[]): ScopeAssessment {
  const ignorable = new Set(['openid', 'profile', 'email', 'offline_access', 'User.Read']);
  const normalise = (s: string) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '');
  const grantedShort = granted.map(normalise);

  const evaluated: ScopeEvaluation[] = graphScopes.map((s) => ({
    Scope: s.scope,
    Required: s.required,
    Granted: grantedShort.includes(s.scope),
    Purpose: s.purpose,
    LeastPrivilegeRole: s.leastPrivilegeRole,
  }));

  const requested = new Set(graphScopes.map((s) => s.scope));
  const extra = grantedShort.filter((s) => !requested.has(s) && !ignorable.has(s));
  const extraWrite = extra.filter((s) => /\.(ReadWrite|Write|Manage|FullControl)/.test(s));

  const missingRequired = evaluated.filter((s) => s.Required && !s.Granted).map((s) => s.Scope);

  return {
    Scopes: evaluated,
    GrantedScopes: grantedShort,
    MissingRequired: missingRequired,
    MissingOptional: evaluated.filter((s) => !s.Required && !s.Granted).map((s) => s.Scope),
    ExtraScopes: extra,
    ExtraWriteScopes: extraWrite,
    Satisfied: missingRequired.length === 0,
  };
}

export interface CollectOptions {
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
  toolVersion?: string;
}

/** Runs every collector and assembles a snapshot identical in shape to the PowerShell one. */
export async function collectSnapshot(
  context: SignedInContext,
  options: CollectOptions = {},
): Promise<Snapshot> {
  const { onProgress, signal, toolVersion = '0.1.0' } = options;

  const report = (key: string, state: StepState, detail: string | null = null) =>
    onProgress?.({ key, state, detail });

  report('organization', 'running');
  const organization = await collectOrganization(context.accessToken, signal);
  report(
    'organization',
    organization.Available ? 'done' : 'failed',
    organization.Available ? (organization.Data?.DisplayName ?? null) : organization.Reason,
  );

  report('subscribedSkus', 'running');
  const subscribedSkus = await collectSubscribedSkus(context.accessToken, signal);
  report(
    'subscribedSkus',
    subscribedSkus.Available ? 'done' : 'failed',
    subscribedSkus.Available ? `${subscribedSkus.Data?.length ?? 0} SKUs` : subscribedSkus.Reason,
  );

  report('users', 'running');
  const users = await collectUsers(context.accessToken, signal);
  report(
    'users',
    !users.Available ? 'failed' : users.Degraded ? 'degraded' : 'done',
    users.Available
      ? `${users.Data?.length ?? 0} accounts${users.Degraded ? ', without sign-in activity' : ''}`
      : users.Reason,
  );

  report('secureScore', 'running');
  const secureScore = await collectSecureScore(context.accessToken, signal);
  report(
    'secureScore',
    !secureScore.Available ? 'failed' : secureScore.Degraded ? 'degraded' : 'done',
    secureScore.Available
      ? `${secureScore.Data?.CurrentScore ?? 0} of ${secureScore.Data?.MaxScore ?? 0}`
      : secureScore.Reason,
  );

  return {
    SchemaVersion: '1.0',
    GeneratedAt: new Date().toISOString(),
    Tool: { Name: 'M365SecurityInvestmentReport.App', Version: toolVersion },
    Source: 'Graph',
    Context: {
      TenantId: context.tenantId,
      Account: context.account.username ?? null,
      ClientId: null,
      AuthType: 'Delegated',
      Scopes: context.grantedScopes,
    },
    ScopeAssessment: assessScopes(context.grantedScopes),
    Collectors: { organization, subscribedSkus, users, secureScore },
    RunLog: [],
  };
}
