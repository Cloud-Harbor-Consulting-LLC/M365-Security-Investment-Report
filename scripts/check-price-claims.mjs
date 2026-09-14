/**
 * Keeps the counts the docs state about the price table equal to the price table.
 *
 * README.md and METHODOLOGY.md tell a reader how many SKUs are priced and how many of those
 * were actually checked. Those sentences exist so a consultant can judge how much to
 * re-verify before a client engagement, which makes a wrong count worse than no count.
 *
 * They are also the most staleable thing in the repository. Adding one SKU to pricelist.json
 * silently falsifies two documents, and nothing about editing a JSON file reminds anyone that
 * prose elsewhere quotes its length. This turns that into a failing build.
 *
 *   node scripts/check-price-claims.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * Reads a document as one long line, with blockquote markers removed.
 *
 * Markdown prose gets rewrapped every time someone edits a sentence, and a claim that
 * happens to straddle a line break is still the same claim. Matching the raw file made this
 * check fail on a pure reflow, which is the behaviour that gets a check deleted rather than
 * fixed. Flattening first means the patterns below describe the sentence, not its layout.
 */
const prose = (rel) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\s+/g, ' ');

// Raw, because flattening whitespace inside JSON string values would quietly rewrite them.
const raw = (rel) => readFileSync(join(root, rel), 'utf8');

const list = JSON.parse(raw('src/CloudHarbor.M365SecurityInvestment/Data/pricelist.json'));

const total = list.prices.length;
const count = (c) => list.prices.filter((e) => e.$confidence === c).length;
const actual = {
  total,
  verified: count('verified'),
  reasoned: count('reasoned'),
  unverified: count('unverified'),
};

const problems = [];

// Every entry must declare one, or the totals below quietly stop adding up.
const undeclared = list.prices.filter((e) => !e.$confidence).map((e) => e.skuPartNumber);
if (undeclared.length) {
  problems.push(`entries with no $confidence: ${undeclared.join(', ')}`);
}
const known = new Set(['verified', 'reasoned', 'unverified']);
const odd = list.prices.filter((e) => e.$confidence && !known.has(e.$confidence));
for (const e of odd) {
  problems.push(`${e.skuPartNumber} has unknown $confidence "${e.$confidence}"`);
}
if (actual.verified + actual.reasoned + actual.unverified !== total) {
  problems.push('the confidence counts do not sum to the number of entries');
}

// A priced entry must say where the price came from. An unsourced figure in a board pack is
// the thing this whole project refuses to produce.
const unsourced = list.prices.filter((e) => !e.$source).map((e) => e.skuPartNumber);
if (unsourced.length) {
  problems.push(`entries with no $source: ${unsourced.join(', ')}`);
}

/**
 * The claims, as the docs phrase them.
 *
 * Matched loosely on purpose. Pinning the exact sentence would fail on a rewording that is
 * still true, and a check that fires on correct prose is a check someone deletes.
 */
const CLAIMS = [
  { file: 'README.md', rx: /prices (\d+) SKUs/, key: 'total' },
  { file: 'README.md', rx: /(\d+) checked against Microsoft's published/, key: 'verified' },
  { file: 'README.md', rx: /(\d+) inferred from a related/, key: 'reasoned' },
  { file: 'README.md', rx: /(\d+) carried forward unchecked/, key: 'unverified' },
  { file: 'docs/METHODOLOGY.md', rx: /table prices (\d+) SKUs/, key: 'total' },
  { file: 'docs/METHODOLOGY.md', rx: /\|\s*`verified`\s*\|\s*(\d+)\s*\|/, key: 'verified' },
  { file: 'docs/METHODOLOGY.md', rx: /\|\s*`reasoned`\s*\|\s*(\d+)\s*\|/, key: 'reasoned' },
  { file: 'docs/METHODOLOGY.md', rx: /\|\s*`unverified`\s*\|\s*(\d+)\s*\|/, key: 'unverified' },
  { file: 'docs/METHODOLOGY.md', rx: /The (\d+) are mostly the standalone Defender/, key: 'unverified' },
];

for (const { file, rx, key } of CLAIMS) {
  const m = rx.exec(prose(file));
  if (!m) {
    problems.push(`${file}: could not find the claim about ${key} (pattern ${rx})`);
    continue;
  }
  const claimed = Number(m[1]);
  if (claimed !== actual[key]) {
    problems.push(`${file}: claims ${claimed} ${key}, the price list has ${actual[key]}`);
  }
}

if (problems.length) {
  console.error('Price claims: FAILED');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\n  The docs quote the shape of the price table so a consultant can judge how much to\n' +
      '  re-verify. Update the prose to match the data, or give the new entry its provenance.',
  );
  process.exit(1);
}

console.log(
  `Price claims: docs agree with the price table ` +
    `(${actual.total} priced: ${actual.verified} verified, ${actual.reasoned} reasoned, ${actual.unverified} unverified)`,
);
