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
 * Requested at sign-in. Required scopes only, deliberately.
 *
 * The two optional scopes are gated on tenant entitlements — AuditLog.Read.All needs
 * Entra ID P1, SecurityEvents.Read.All needs Security Reader — so asking for them up
 * front makes sign-in fail outright in tenants that cannot grant them, taking the
 * licence inventory and spend analysis down with it. Those need none of it.
 *
 * This is the auth-layer expression of the same rule the report follows: an optional
 * signal degrades a section, it never fails the whole run.
 */
export const loginScopeNames: string[] = graphScopes.filter((s) => s.required).map((s) => s.scope);

/** Requested incrementally, when a feature that needs them is actually used. */
export const optionalScopeNames: string[] = graphScopes.filter((s) => !s.required).map((s) => s.scope);

export const requiredScopeNames: string[] = loginScopeNames;

/**
 * True only for scopes that grant read access. Used by a test that fails the build if a
 * write scope is ever added to the shared file.
 */
export function isReadOnlyScope(scope: string): boolean {
  return /\.Read(\.All)?$/.test(scope);
}
