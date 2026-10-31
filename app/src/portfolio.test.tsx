/**
 * Local portfolio mode: several clients side by side, from files dropped in one go.
 *
 * What is guarded is what a consultant would get wrong by hand, or not notice: the newest
 * run shown and the one before it compared with, whatever order the files arrive in;
 * prices following the client; a damaged file costing only itself; and a total that
 * would quietly leave a client out reading "not available" instead.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';

import premiumSnapshot from '@fixtures/premium-snapshot.json';
import baselineSnapshot from '@fixtures/premium-baseline-snapshot.json';
import unpricedSnapshot from '@fixtures/unpriced-snapshot.json';
import e7Snapshot from '@fixtures/e7-snapshot.json';

import { buildPortfolio, byOpportunity, portfolioCsv, rowFor, totalOf, type DroppedFile } from './portfolio';
import { Portfolio } from './components/Portfolio';
import { buildSession, setOverride, clearOverrides } from '@/engine';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

const snap = (raw: unknown): Snapshot => {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.snapshot;
};
const file = (name: string, raw: unknown): DroppedFile => ({ name, raw: structuredClone(raw) });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');

const CONTOSO = '8f4b2c19-6d3a-4e57-9b81-2a7c5d0e3f64';
const priced = setOverride(clearOverrides(), 'SPE_E3', 30);

describe('putting the files together', () => {
  it('gives each tenant one line', () => {
    const p = buildPortfolio([
      file('contoso.json', premiumSnapshot),
      file('demo.json', unpricedSnapshot),
      file('fabrikam.json', e7Snapshot),
    ]);
    expect(p.rejected).toEqual([]);
    expect(p.tenants.map((t) => t.snapshot.Collectors.organization.Data!.DisplayName).sort()).toEqual([
      'Contoso Ltd',
      'Example Demo Tenant',
      'Fabrikam E7',
    ]);
  });

  it('shows the newest run and compares with the one before, in whatever order they arrive', () => {
    for (const order of [
      [file('sep.json', premiumSnapshot), file('jun.json', baselineSnapshot)],
      [file('jun.json', baselineSnapshot), file('sep.json', premiumSnapshot)],
    ]) {
      const [contoso] = buildPortfolio(order).tenants;
      expect(contoso!.snapshot.GeneratedAt).toBe('2026-09-03T18:00:00Z');
      expect(contoso!.baseline?.GeneratedAt).toBe('2026-06-03T18:00:00Z');
      expect(contoso!.sourceLabel).toBe('sep.json');
      expect(rowFor(contoso!).comparison?.daysBetween).toBe(92);
    }
  });

  it('uses the earlier run saved inside a session', () => {
    const session = buildSession(snap(premiumSnapshot), clearOverrides(), 'contoso', snap(baselineSnapshot));
    const [contoso] = buildPortfolio([file('contoso.m365session.json', session)]).tenants;
    expect(contoso!.baseline?.GeneratedAt).toBe('2026-06-03T18:00:00Z');
  });

  it('keeps the newest of 3 runs, compares with the next, and says the oldest was left out', () => {
    const march = structuredClone(baselineSnapshot) as any;
    march.GeneratedAt = '2026-03-03T18:00:00Z';
    const [contoso] = buildPortfolio([
      file('mar.json', march),
      file('sep.json', premiumSnapshot),
      file('jun.json', baselineSnapshot),
    ]).tenants;
    expect(contoso!.baseline?.GeneratedAt).toBe('2026-06-03T18:00:00Z');
    expect(contoso!.notes.join(' ')).toContain('1 older run was left out');
  });

  it("carries a client's prices forward from an earlier session, and says where they came from", () => {
    const june = buildSession(snap(baselineSnapshot), priced, 'contoso june');
    const [contoso] = buildPortfolio([file('june.m365session.json', june), file('sep.json', premiumSnapshot)]).tenants;
    expect(contoso!.overrides).toEqual(priced);
    expect(contoso!.notes.join(' ')).toContain('Prices came from june.m365session.json, saved with the run of 3 June 2026.');
  });

  it('counts the same run once when it arrives as a snapshot and inside a session', () => {
    const session = buildSession(snap(premiumSnapshot), priced, 'contoso');
    const [contoso] = buildPortfolio([file('sep.json', premiumSnapshot), file('sep.m365session.json', session)]).tenants;
    expect(contoso!.baseline).toBeNull();
    expect(contoso!.overrides).toEqual(priced);
    expect(contoso!.notes).toEqual([]);
  });

  it('leaves out a damaged file and says why, without losing the rest', () => {
    const newer = { ...buildSession(snap(unpricedSnapshot), clearOverrides(), 'demo'), version: 99 };
    const p = buildPortfolio([
      file('broken.json', null),
      file('newer.m365session.json', newer),
      file('contoso.json', premiumSnapshot),
    ]);
    expect(p.tenants).toHaveLength(1);
    expect(p.rejected.map((r) => r.file)).toEqual(['broken.json', 'newer.m365session.json']);
    expect(p.rejected[0]!.reason).toBe('It is not valid JSON.');
    expect(p.rejected[1]!.reason).toMatch(/newer version of this tool/);
  });
});

describe('the figures', () => {
  const rows = buildPortfolio([file('contoso.json', premiumSnapshot), file('demo.json', unpricedSnapshot)]).tenants.map(
    rowFor,
  );
  const contoso = rows.find((r) => r.tenant.tenantId === CONTOSO)!;
  const demo = rows.find((r) => r.tenant.tenantId !== CONTOSO)!;

  it("are each client's own report figures", () => {
    expect(contoso.commitment).toBe(contoso.model.spend.annualCommitment);
    expect(contoso.waste.total).toBe(contoso.model.seatWaste.totalAnnualCost);
    expect(contoso.notSwitchedOn).toBe(contoso.model.features.unlockableSpend);
  });

  it('totals the clients with a figure, and says how many that is', () => {
    expect(demo.commitment).toBeNull();
    expect(totalOf(rows, (r) => r.commitment)).toEqual({ total: contoso.commitment, counted: 1 });
    expect(totalOf([demo], (r) => r.commitment)).toBeNull();
  });

  it('will not add different currencies', () => {
    expect(totalOf([contoso, { ...contoso, currency: 'EUR' }], (r) => r.commitment)).toBeNull();
  });

  it('puts the largest spend not switched on first', () => {
    expect(byOpportunity(rows)[0]!.tenant.tenantId).toBe(CONTOSO);
  });

  it('exports one CSV line per client', () => {
    const csv = portfolioCsv(rows).trim().split('\n');
    expect(csv).toHaveLength(3);
    expect(csv[0]).toContain('Not switched on');
    expect(csv[1]).toContain('Contoso Ltd');
  });
});

describe('the screen', () => {
  const rows = buildPortfolio([
    file('sep.json', premiumSnapshot),
    file('jun.json', baselineSnapshot),
    file('demo.json', unpricedSnapshot),
  ]).tenants.map(rowFor);
  const noop = () => null;
  const screen = text(
    render(<Portfolio rows={rows} rejected={[]} onOpen={noop} onAddFiles={noop} onDownloadCsv={noop} onReset={noop} />),
  );

  it('lists every client and says the list is on screen', () => {
    expect(screen).toContain('Portfolio, 2 clients');
    expect(screen).toContain('Contoso Ltd');
    expect(screen).toContain('Example Demo Tenant');
    expect(screen).toContain('Every client in this list is on screen');
    expect(screen).toContain('nothing is stored or sent anywhere');
  });

  it('says when a total covers only some of the clients', () => {
    expect(screen).toMatch(/Total, 2 clients .*1 of 2 clients/);
  });

  it('shows the change since the last review beside the figure', () => {
    expect(screen).toMatch(/percentage points? since 3 Jun 2026|no change since 3 Jun 2026/);
  });

  it('names a file it left out', () => {
    const shown = text(
      render(
        <Portfolio
          rows={rows}
          rejected={[{ file: 'broken.json', reason: 'It is not valid JSON.' }]}
          onOpen={noop}
          onAddFiles={noop}
          onDownloadCsv={noop}
          onReset={noop}
        />,
      ),
    );
    expect(shown).toContain('1 file was left out');
    expect(shown).toContain('broken.json : It is not valid JSON.');
  });
});
