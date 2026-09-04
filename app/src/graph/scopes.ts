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

/** Scope strings for MSAL, in the order shown on the pre-flight screen. */
export const scopeNames: string[] = graphScopes.map((s) => s.scope);

export const requiredScopeNames: string[] = graphScopes.filter((s) => s.required).map((s) => s.scope);

/**
 * True only for scopes that grant read access. Used by a test that fails the build if a
 * write scope is ever added to the shared file.
 */
export function isReadOnlyScope(scope: string): boolean {
  return /\.Read(\.All)?$/.test(scope);
}
