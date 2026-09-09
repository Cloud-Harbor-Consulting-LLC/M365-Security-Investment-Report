import { describe, expect, it } from 'vitest';

import { money, plainText } from './format';

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

describe('a real amount never prints as zero', () => {
  it('shows sub-dollar amounts as less-than rather than $0', () => {
    // $0 is a claim that a control costs nothing. 26 cents is not that claim, and
    // printing it as $0 also made "only with spend to unlock" look broken: the filter
    // matched correctly while every row it returned displayed as zero.
    expect(money(0.26)).toBe('<$1');
    expect(money(0.49)).toBe('<$1');
  });

  it('still prints a true zero as zero, because that is a measurement', () => {
    expect(money(0)).toBe('$0');
  });

  it('rounds normally once there is a dollar to round', () => {
    expect(money(0.5)).toBe('$1');
    expect(money(1234.4)).toBe('$1,234');
  });

  it('keeps null as not-available', () => {
    expect(money(null)).toBe('n/a');
  });

  it('respects an explicit decimal request rather than second-guessing it', () => {
    expect(money(0.26, 'USD', 2)).toBe('$0.26');
  });
});
