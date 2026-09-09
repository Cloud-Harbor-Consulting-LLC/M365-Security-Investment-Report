import scopesJson from '@data/graph-scopes.json';
import { stripDocKeys } from '@/model/reference';

export interface GraphScope {
  scope: string;
  required: boolean;
  purpose: string;
  leastPrivilegeRole: string;
}

interface ScopeFile {
  schemaVersion: string;
  scopes: GraphScope[];
}

/**
 * The read-only scopes this tool requests — the same file the PowerShell module reads,
 * so the consent screen and the docs cannot drift apart.
 */
export const graphScopes: GraphScope[] = stripDocKeys(scopesJson as unknown as ScopeFile).scopes;

/** Every scope the tool can use, in the order shown on the pre-flight screen. */
export const scopeNames: string[] = graphScopes.map((s) => s.scope);

/**
 * Asked for at sign-in: everything, so one consent screen buys a complete collection.
 *
 * The optional two are gated on tenant entitlements — AuditLog.Read.All needs Entra ID
 * P1 for sign-in activity, SecurityEvents.Read.All needs the Security Reader role for
 * Secure Score — but that gate bites when the API is called, as a 403 the collectors
 * already degrade around. It is not a gate on *consent*: both are ordinary delegated
 * Graph permissions that any tenant can grant. Asking for them up front therefore costs
 * a tenant nothing and is what the PowerShell tier has always done.
 */
export const signInScopeNames: string[] = graphScopes.map((s) => s.scope);

/**
 * The fallback if an admin declines the full set.
 *
 * Entra's consent screen is all-or-nothing, so an admin uneasy about one permission
 * would otherwise get no report at all. Retrying with these three keeps the licence
 * inventory and spend analysis, and the missing sections report themselves as not
 * measured — the auth-layer expression of the rule the whole report follows: an optional
 * signal degrades a section, it never fails the run.
 */
export const loginScopeNames: string[] = graphScopes.filter((s) => s.required).map((s) => s.scope);

/** Entitlement-gated. Present at sign-in, but a collection must survive their absence. */
export const optionalScopeNames: string[] = graphScopes.filter((s) => !s.required).map((s) => s.scope);

export const requiredScopeNames: string[] = loginScopeNames;

/**
 * True only for scopes that grant read access. Used by a test that fails the build if a
 * write scope is ever added to the shared file.
 */
export function isReadOnlyScope(scope: string): boolean {
  return /\.Read(\.All)?$/.test(scope);
}
