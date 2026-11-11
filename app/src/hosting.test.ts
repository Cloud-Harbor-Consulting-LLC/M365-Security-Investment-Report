/**
 * The HTTP headers the hosted app is served with.
 *
 * Each page carries its Content-Security-Policy twice: in a meta tag, which travels with the
 * file wherever it is opened, and as a header from Azure Static Web Apps, which is the only
 * place a policy can forbid framing (browsers ignore frame-ancestors in a meta tag). Two
 * copies drift, so these tests hold the header to the meta tag plus exactly one directive.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(`${appRoot}${file}`, 'utf8');

interface Route {
  route: string;
  headers?: Record<string, string>;
}
interface HostingConfig {
  globalHeaders: Record<string, string>;
  routes: Route[];
}
const config = JSON.parse(read('staticwebapp.config.json')) as HostingConfig;

/** The policy in a page's meta tag, as a sorted list of directives. */
function metaPolicy(file: string): string[] {
  const match = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read(file));
  if (!match?.[1]) throw new Error(`${file} has no Content-Security-Policy meta tag`);
  return directives(match[1]);
}

function directives(policy: string): string[] {
  return policy
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort();
}

function routeHeaders(path: string): Record<string, string> {
  const route = config.routes.find((r) => r.route === path);
  if (!route?.headers) throw new Error(`No headers for ${path}`);
  return route.headers;
}

describe('hosting headers', () => {
  it('serves the app with its own policy, and forbids framing it', () => {
    const header = config.globalHeaders['Content-Security-Policy'] ?? '';
    expect(directives(header)).toEqual([...metaPolicy('index.html'), "frame-ancestors 'none'"].sort());
    expect(config.globalHeaders['X-Frame-Options']).toBe('DENY');
  });

  // MSAL's silent token renewal loads the redirect page in a hidden iframe inside the app,
  // so this one page has to accept being framed by its own origin, and nothing else.
  it('lets only the app itself frame the sign-in redirect page', () => {
    const headers = routeHeaders('/redirect.html');
    expect(directives(headers['Content-Security-Policy'] ?? '')).toEqual(
      [...metaPolicy('redirect.html'), "frame-ancestors 'self'"].sort(),
    );
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('sends HSTS and the other baseline headers', () => {
    expect(config.globalHeaders['Strict-Transport-Security']).toMatch(/^max-age=\d{7,}/);
    expect(config.globalHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(config.globalHeaders['Referrer-Policy']).toBe('no-referrer');
  });
});
