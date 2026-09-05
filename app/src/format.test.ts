import { describe, expect, it } from 'vitest';

import { plainText } from './format';

describe('Microsoft remediation guidance is reduced to readable text', () => {
  // Verbatim shape of what Graph returned for AdminMFAV2 on a live tenant, which the
  // report previously rendered as raw markup in front of a customer.
  const real =
    '<ol><li>We provide step-by-step guidance in the ' +
    '<a href="https://admin.microsoft.com/adminportal/home">Microsoft 365 admin center</a>&nbsp;</li>' +
    '<li>If you&rsquo;ve invested in Entra ID P1 &amp; P2, create a policy</li></ol>';

  it('drops the tags and keeps the words', () => {
    const out = plainText(real);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('step-by-step guidance');
    expect(out).toContain('Microsoft 365 admin center');
  });

  it('keeps list structure as bullets, so instructions stay ordered', () => {
    const lines = plainText(real).split('\n');
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.startsWith('•'))).toBe(true);
  });

  it('decodes the entities Graph emits rather than showing them raw', () => {
    const out = plainText(real);
    expect(out).not.toMatch(/&nbsp;|&rsquo;|&amp;/);
    expect(out).toContain('you\u2019ve');
    expect(out).toContain('P1 & P2');
  });

  it('survives null, which is what an unprofiled control carries', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
    expect(plainText('')).toBe('');
  });
});
