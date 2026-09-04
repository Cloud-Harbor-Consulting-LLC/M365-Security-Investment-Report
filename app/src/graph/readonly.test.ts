/**
 * The read-only guarantee, enforced in the browser tier.
 *
 * The PowerShell equivalent is tests/ReadOnly.Guard.Tests.ps1. Both exist because the
 * claim "this tool cannot write to your tenant" is the product, and a claim a CISO is
 * asked to trust should be enforced by CI rather than by review.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { graphScopes, isReadOnlyScope, scopeNames, requiredScopeNames } from './scopes';

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

const files = sourceFiles(srcRoot);
const read = (f: string) => readFileSync(f, 'utf8');

describe('Graph traffic is GET-only', () => {
  it('finds source files to inspect', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('calls fetch() from exactly one module', () => {
    const callers = files.filter((f) => /\bfetch\s*\(/.test(read(f))).map((f) => basename(f));
    expect(callers).toEqual(['client.ts']);
  });

  it('hardcodes the GET method in the client', () => {
    const client = read(join(srcRoot, 'graph', 'client.ts'));
    expect(client).toMatch(/method:\s*'GET'/);
  });

  it('never names a mutating HTTP method anywhere in src', () => {
    for (const file of files) {
      const body = read(file);
      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(body, `${file} must not issue a ${verb}`).not.toMatch(new RegExp(`method:\\s*['"\`]${verb}`, 'i'));
      }
    }
  });

  it('exposes no way for a caller to choose a method', () => {
    const client = read(join(srcRoot, 'graph', 'client.ts'));
    // GraphGetOptions is the entire public surface for tuning a request.
    expect(client).not.toMatch(/method\s*[?:]\s*string/);
    expect(client).not.toMatch(/options\.method/);
  });

  it('refuses to send a token to a non-Graph origin', () => {
    const client = read(join(srcRoot, 'graph', 'client.ts'));
    expect(client).toMatch(/Refusing to call a non-Graph origin/);
  });
});

describe('Requested scopes', () => {
  it('requests only read scopes', () => {
    for (const scope of scopeNames) {
      expect(isReadOnlyScope(scope), `${scope} is not a read-only scope`).toBe(true);
    }
  });

  it('matches the set the PowerShell module requests', () => {
    // Both read src/CloudHarbor.M365SecurityInvestment/Data/graph-scopes.json, so this
    // asserts the shared file is actually shared rather than shadowed by a local copy.
    expect(scopeNames).toEqual([
      'Organization.Read.All',
      'Directory.Read.All',
      'User.Read.All',
      'AuditLog.Read.All',
      'SecurityEvents.Read.All',
    ]);
  });

  it('marks the entitlement-gated scopes optional so a tenant without them still reports', () => {
    expect(requiredScopeNames).toEqual(['Organization.Read.All', 'Directory.Read.All', 'User.Read.All']);
    const optional = graphScopes.filter((s) => !s.required).map((s) => s.scope);
    expect(optional).toContain('AuditLog.Read.All');
    expect(optional).toContain('SecurityEvents.Read.All');
  });

  it('explains every scope, since the consent screen is the trust pitch', () => {
    for (const scope of graphScopes) {
      expect(scope.purpose.length, `${scope.scope} has no purpose`).toBeGreaterThan(20);
      expect(scope.leastPrivilegeRole.length).toBeGreaterThan(0);
    }
  });
});
