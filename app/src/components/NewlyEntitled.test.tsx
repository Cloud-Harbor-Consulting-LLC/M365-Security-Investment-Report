/**
 * "New in your licence", as a reader sees it.
 *
 * Asserted against rendered text, as the Since last review tests are. What is guarded is
 * that the change is named with its date and licence, that the controls it unlocked are
 * marked where the reader works through them, and that what cannot be detected is said.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';

import { FeaturesView, NotMeasuredView, RoadmapView } from './views';
import { analyze } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const run = (raw: unknown) => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
};

/** An E3-only tenant after July 2026, when Defender for Office 365 Plan 1 arrived in E3. */
const e3Only = (() => {
  const s = structuredClone(premiumSnapshot) as any;
  const skus = s.Collectors.subscribedSkus.Data as any[];
  skus
    .find((k) => k.SkuPartNumber === 'SPE_E3')
    .ServicePlans.push({ ServicePlanId: 'f20fedf3-f3c3-43c3-8267-2bfdd51c0939', ServicePlanName: 'ATP_ENTERPRISE', ProvisioningStatus: 'Success', AppliesTo: 'User' });
  s.Collectors.subscribedSkus.Data = skus.filter((k) => !['SPE_E5', 'ATP_ENTERPRISE'].includes(k.SkuPartNumber));
  return run(s);
})();
const sample = run(premiumSnapshot);

/** Markup stripped and whitespace collapsed, inline tags without a trace. */
const text = (html: string) =>
  html
    .replace(/<\/?(strong|em|b|i|span|code|a)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** The pills themselves, not the filter label that shares their words. */
const pills = (html: string) => html.match(/class="pill new"[^>]*>new in your licence</g) ?? [];

describe('security features', () => {
  const html = render(<FeaturesView model={e3Only} />);
  const screen = text(html);

  it('names the change, its date and the licence it arrived in', () => {
    expect(screen).toContain('New in licences this tenant already holds');
    expect(screen).toContain(
      'Microsoft added Microsoft Defender for Office 365 Plan 1 to Microsoft 365 E3 on 1 Jul 2026. It unlocks 2 controls Microsoft scores here, and neither is deployed yet.',
    );
  });

  it('marks each control it unlocked, and offers to show only those', () => {
    expect(pills(html)).toHaveLength(2);
    expect(screen).toContain('Only new in your licence');
  });

  it('says nothing of it on a tenant that already paid for these controls', () => {
    const plain = render(<FeaturesView model={sample} />);
    expect(text(plain)).not.toContain('New in licences');
    expect(text(plain)).not.toContain('new in your licence');
    expect(pills(plain)).toHaveLength(0);
  });
});

describe('the roadmap', () => {
  it('carries the same mark, where the work is planned', () => {
    expect(pills(render(<RoadmapView model={e3Only} />))).toHaveLength(2);
  });
});

describe('not measured', () => {
  it('says what it cannot detect, for a licence the tenant holds', () => {
    const gaps = text(render(<NotMeasuredView model={sample} />));
    expect(gaps).toContain('Whether URL time-of-click protection has reached Microsoft 365 Business Standard');
    expect(gaps).toContain('publishes no service plan for it in that licence');
  });
});
