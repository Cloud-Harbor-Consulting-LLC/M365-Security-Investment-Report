/**
 * The client's logo beside its name, or its initial.
 *
 * Guarded: a logo is redacted with the name, the dark-theme logo is used only in the dark
 * theme, and a tenant with no branding still gets a mark.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import { TenantMark } from './TenantMark';

const LIGHT = 'data:image/png;base64,bGlnaHQ=';
const DARK = 'data:image/png;base64,ZGFyaw==';

describe('the tenant mark', () => {
  it('shows the logo, redacted with the name', () => {
    const html = render(<TenantMark name="Contoso Ltd" logo={{ Light: LIGHT, Dark: null }} />);
    expect(html).toContain(`src="${LIGHT}"`);
    expect(html).toContain('redactable');
    expect(html).not.toContain('<source');
  });

  it('offers the dark-theme logo only to the dark theme', () => {
    const html = render(<TenantMark name="Contoso Ltd" logo={{ Light: LIGHT, Dark: DARK }} />);
    expect(html).toContain(`<source media="(prefers-color-scheme: dark)" srcset="${DARK}"`);
    expect(html).toContain(`src="${LIGHT}"`);
  });

  it('uses a dark-only logo in both themes rather than none', () => {
    expect(render(<TenantMark name="Contoso Ltd" logo={{ Light: null, Dark: DARK }} />)).toContain(`src="${DARK}"`);
  });

  it('falls back to the initial', () => {
    for (const logo of [null, undefined]) {
      const html = render(<TenantMark name="  contoso" logo={logo} />);
      expect(html).toContain('>C</span>');
      expect(html).toContain('redactable');
    }
  });
});
