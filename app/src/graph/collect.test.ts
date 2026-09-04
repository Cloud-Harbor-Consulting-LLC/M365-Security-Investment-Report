import { describe, expect, it } from 'vitest';

import { assessScopes } from './collect';

describe('Scope assessment', () => {
  const full = [
    'Organization.Read.All',
    'Directory.Read.All',
    'User.Read.All',
    'AuditLog.Read.All',
    'SecurityEvents.Read.All',
  ];

  it('is satisfied when every requested scope is granted', () => {
    const a = assessScopes(full);
    expect(a.Satisfied).toBe(true);
    expect(a.MissingRequired).toEqual([]);
    expect(a.MissingOptional).toEqual([]);
  });

  it('treats a missing optional scope as degradation, not failure', () => {
    // A tenant without Entra ID P1 or Security Reader still gets the report it can have.
    const a = assessScopes(['Organization.Read.All', 'Directory.Read.All', 'User.Read.All']);
    expect(a.Satisfied).toBe(true);
    expect(a.MissingOptional).toContain('AuditLog.Read.All');
    expect(a.MissingOptional).toContain('SecurityEvents.Read.All');
  });

  it('fails when a required scope is absent', () => {
    const a = assessScopes(['User.Read.All']);
    expect(a.Satisfied).toBe(false);
    expect(a.MissingRequired).toContain('Organization.Read.All');
  });

  it('normalises the fully-qualified scope URIs Entra returns', () => {
    // MSAL commonly returns https://graph.microsoft.com/Directory.Read.All
    const a = assessScopes(full.map((s) => `https://graph.microsoft.com/${s}`));
    expect(a.Satisfied).toBe(true);
    expect(a.MissingRequired).toEqual([]);
  });

  it('discloses session scopes beyond what the tool requests', () => {
    const a = assessScopes([...full, 'Sites.Read.All', 'DelegatedPermissionGrant.ReadWrite.All']);
    expect(a.ExtraScopes).toContain('Sites.Read.All');
    expect(a.ExtraScopes).toContain('DelegatedPermissionGrant.ReadWrite.All');
  });

  it('singles out write scopes present in the session', () => {
    // The tool never uses them, but a report claiming least privilege must not stay
    // silent about a write scope in the presented session.
    const a = assessScopes([...full, 'DelegatedPermissionGrant.ReadWrite.All']);
    expect(a.ExtraWriteScopes).toEqual(['DelegatedPermissionGrant.ReadWrite.All']);
  });

  it('does not flag standard OIDC scopes as extra', () => {
    const a = assessScopes([...full, 'openid', 'profile', 'email', 'offline_access', 'User.Read']);
    expect(a.ExtraScopes).toEqual([]);
  });
});
