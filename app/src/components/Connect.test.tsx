/**
 * A tenant that approved an earlier version, signing in to one that asks for more.
 *
 * Sign-in succeeds on what the tenant approved, so without a check nobody would be told.
 * What is guarded is that the gap is found, that the administrator is told exactly which
 * permission and why, and that the way forward is one button rather than a trip to the
 * Entra admin center.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import { Connect, OutstandingConsent } from './Connect';
import { loginScopeNames, missingScopes, scopeNames } from '@/graph/scopes';

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');

const before = scopeNames.filter((s) => s !== 'Reports.Read.All');

describe('finding what the tenant has not approved', () => {
  it('names a permission added since the tenant consented', () => {
    expect(missingScopes(before)).toEqual(['Reports.Read.All']);
  });

  it('finds nothing outstanding once everything is approved', () => {
    expect(missingScopes(scopeNames)).toEqual([]);
  });

  it('reads scopes the way Entra returns them', () => {
    // Fully qualified, in any case, alongside the sign-in scopes MSAL always adds.
    const granted = [
      'openid',
      'profile',
      'offline_access',
      ...scopeNames.map((s) => `https://graph.microsoft.com/${s.toUpperCase()}`),
    ];
    expect(missingScopes(granted)).toEqual([]);
  });

  it('lists every optional permission for a tenant on the reduced set', () => {
    expect(missingScopes(loginScopeNames)).toEqual(scopeNames.filter((s) => !loginScopeNames.includes(s)));
  });
});

describe('the prompt', () => {
  const noop = () => {};
  const screen = text(render(<OutstandingConsent missing={['Reports.Read.All']} onGrant={noop} onContinue={noop} />));

  it('names the permission and why it is needed', () => {
    expect(screen).toContain('This version needs 1 permission your tenant has not approved yet');
    expect(screen).toContain('Reports.Read.All');
    expect(screen).toContain('over-provisioned waste category');
  });

  it('offers consent in one step, and a way on without it', () => {
    expect(screen).toContain('Grant admin consent and collect');
    expect(screen).toContain('Continue without it');
    expect(screen).toContain('Nothing needs adding by hand.');
    expect(screen).toContain('the ones already approved stay as they are');
  });

  it('says nothing has been read before anyone decides', () => {
    expect(screen).toContain('Nothing has been read yet.');
  });

  it('counts more than 1', () => {
    const two = text(
      render(
        <OutstandingConsent missing={['AuditLog.Read.All', 'Reports.Read.All']} onGrant={noop} onContinue={noop} />,
      ),
    );
    expect(two).toContain('needs 2 permissions');
    expect(two).toContain('Continue without them');
  });
});

describe('the Connect page', () => {
  it('counts the permissions from the scope file rather than in prose', () => {
    const page = text(render(<Connect onSnapshot={() => null} onCancel={() => {}} />));
    expect(page).toContain(`All ${scopeNames.length} are requested at sign-in, and ${loginScopeNames.length} of them are enough`);
    expect(page).toContain('Reports Reader');
    expect(page).not.toMatch(/\bfive\b|\blast two\b/i);
  });
});
