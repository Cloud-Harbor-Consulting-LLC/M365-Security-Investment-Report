/**
 * A tenant that approved an earlier version, signing in to one that asks for more.
 *
 * Sign-in succeeds on what the tenant approved, so without a check nobody would be told.
 * What is guarded is that the gap is found, that the administrator is told exactly which
 * permission and why, and that the way forward is one button rather than a trip to the
 * Entra admin center.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact-render-to-string';

import { Connect, OutstandingConsent } from './Connect';
import { loginScopeNames, missingScopes, scopeNames } from '@/graph/scopes';
import { forgetDeclined, rememberDeclined, wasDeclined } from '@/graph/session';

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

  it('says it will not ask again', () => {
    expect(screen).toContain('This browser will not ask again about this permission.');
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

describe('asking once per browser', () => {
  const tenant = '0f1e2d3c-aaaa-bbbb-cccc-000000000001';
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks until someone chooses to go on without', () => {
    expect(wasDeclined(tenant, ['Reports.Read.All'])).toBe(false);
    rememberDeclined(tenant, ['Reports.Read.All']);
    expect(wasDeclined(tenant, ['Reports.Read.All'])).toBe(true);
  });

  it('asks again when a permission it has not seen goes missing', () => {
    rememberDeclined(tenant, ['Reports.Read.All']);
    expect(wasDeclined(tenant, ['Reports.Read.All', 'AuditLog.Read.All'])).toBe(false);
  });

  it('keeps each tenant separate', () => {
    rememberDeclined(tenant, ['Reports.Read.All']);
    expect(wasDeclined('0f1e2d3c-aaaa-bbbb-cccc-000000000002', ['Reports.Read.All'])).toBe(false);
  });

  it('forgets once consent is granted, so a later withdrawal is asked about', () => {
    rememberDeclined(tenant, ['Reports.Read.All']);
    forgetDeclined(tenant);
    expect(wasDeclined(tenant, ['Reports.Read.All'])).toBe(false);
    expect(localStorage.getItem('chsi.declinedScopes')).toBeNull();
  });

  it('keeps nothing but the tenant and the permission names', () => {
    rememberDeclined(tenant, ['Reports.Read.All']);
    expect(JSON.parse(localStorage.getItem('chsi.declinedScopes') ?? '')).toEqual({ [tenant]: ['Reports.Read.All'] });
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
