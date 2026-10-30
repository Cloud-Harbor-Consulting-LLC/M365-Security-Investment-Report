/**
 * How the risk figures were sized, as a reader sees it.
 *
 * An impact of "$400,000" means nothing without the number of people it is for, so
 * every surface that prints one also says how it was sized.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';

import { BoardPack } from './BoardPack';
import { RoadmapView } from './views';
import { analyze } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const parsed = parseSnapshot(premiumSnapshot);
if (!parsed.ok) throw new Error(parsed.reason);
const model = analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });

/** Markup stripped and whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');

const sizing =
  "Impact is sized to 288 people, the most seats assigned on any one paid licence, which is a floor on headcount. The risk model's impacts describe an organisation of 500, so each is multiplied by 0.76.";

describe('the sizing is stated wherever an impact is printed', () => {
  it('on the roadmap, beside the impact per threat', () => {
    expect(text(render(<RoadmapView model={model} />))).toContain(sizing);
  });

  it('in the board pack, with the other assumptions', () => {
    expect(text(render(<BoardPack model={model} sourceLabel="test" />))).toContain(sizing);
  });
});
