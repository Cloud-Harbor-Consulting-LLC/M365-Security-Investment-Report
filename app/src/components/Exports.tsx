import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import {
  exportManifest,
  exportSections,
  toJsonExport,
  type ReportModel,
  type SessionFile,
} from '@/engine';
import { downloadJson, downloadText } from '@/download';
import { count } from '@/format';
import { useDialog } from '@/a11y';

interface Props {
  model: ReportModel;
  sourceLabel: string;
  session: () => SessionFile;
  open: boolean;
  onClose: () => void;
  /** Inside the one-file report itself, where there is no template to build another. */
  standalone?: boolean;
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tenant';

/**
 * Getting the analysis out.
 *
 * Presented as a list of what each file contains rather than a row of buttons, because
 * the person exporting is about to forward these to someone who was not in the room. The
 * manifest is offered first and described plainly: it is the sheet that keeps a caveated
 * figure caveated once the folder is on someone else's desk.
 */
export function Exports({
  model,
  sourceLabel,
  session,
  open,
  onClose,
  standalone = false,
}: Props): JSX.Element | null {
  const [note, setNote] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  // Above the early return: a hook cannot be called conditionally, and this one is
  // written to do nothing while the panel is closed.
  const panel = useDialog(open, onClose);
  if (!open) return null;

  const sections = exportSections(model);
  const stem = `${slug(model.tenant.DisplayName)}-${model.generatedAt.slice(0, 10)}`;

  const report = (result: { ok: boolean; reason?: string }, what: string) => {
    setNote(result.ok ? `${what} saved to your downloads.` : (result.reason ?? 'The browser refused the download.'));
    setTimeout(() => setNote(null), 6000);
  };

  /**
   * The template is fetched only when asked for.
   *
   * It is the entire report bundle inlined — several hundred kilobytes that most sessions
   * never need — so it is a dynamic import and therefore its own chunk. The hosted app
   * loads no faster or slower for this feature existing until someone uses it.
   */
  const saveStandalone = async () => {
    setBuilding(true);
    try {
      const { buildOneFileReport } = await import('@/standalone/build');
      const built = buildOneFileReport(model, session(), sourceLabel);
      report(downloadText(built.fileName, built.html, 'text/html'), 'One-file report');
    } catch (e) {
      report(
        { ok: false, reason: e instanceof Error ? e.message : String(e) },
        'One-file report',
      );
    } finally {
      setBuilding(false);
    }
  };

  const saveAll = () => {
    // Sequential rather than parallel: browsers throttle or silently drop a burst of
    // downloads, and a missing file is worse than a slower click.
    const results = [
      downloadText(`${stem}-README.txt`, exportManifest(model, sourceLabel, sections), 'text/plain'),
      ...sections.map((s) => downloadText(`${stem}-${s.id}.csv`, s.csv(), 'text/csv')),
    ];
    const failed = results.filter((r) => !r.ok);
    report(
      failed.length === 0
        ? { ok: true }
        : { ok: false, reason: `${failed.length} of ${results.length} files were refused by the browser.` },
      `${results.length} files`,
    );
  };

  return (
    <>
      <div class={open ? 'scrim on' : 'scrim'} onClick={onClose} />
      <aside
        ref={panel}
        class={open ? 'over on' : 'over'}
        role="dialog"
        aria-modal="true"
        aria-label="Export"
      >
        <div class="overhead">
          <h3>Export</h3>
          <button class="x" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div class="overbody">
        <p class="over-intro">
          Everything is produced here in the browser and saved by your browser. Nothing is uploaded, and
          these files carry tenant data, including user principal names in the waste breakdown.
        </p>

        <div class="exportlist">
          {!standalone && (
            <div class="exportrow">
              <div>
                <strong>The whole report, as one file</strong>
                <span class="sub">
                  HTML. Interactive, opens offline, reaches no network, and still shows the board
                  figures on a machine that blocks scripts. This is the one to leave behind.
                </span>
              </div>
              <button class="btn" disabled={building} onClick={() => void saveStandalone()}>
                {building ? 'Building…' : 'Download HTML'}
              </button>
            </div>
          )}

          <div class="exportrow">
            <div>
              <strong>Full report</strong>
              <span class="sub">
                JSON. The whole model including provenance and the assumptions behind every risk figure.
              </span>
            </div>
            <button
              class="btn"
              onClick={() => report(downloadJson(`${stem}-report.json`, toJsonExport(model, sourceLabel)), 'Report JSON')}
            >
              Download JSON
            </button>
          </div>

          {sections.map((s) => (
            <div class="exportrow" key={s.id}>
              <div>
                <strong>{s.label}</strong>
                <span class="sub">
                  {count(s.rowCount)} row{s.rowCount === 1 ? '' : 's'}. {s.description}
                </span>
              </div>
              <button class="btn" onClick={() => report(downloadText(`${stem}-${s.id}.csv`, s.csv(), 'text/csv'), s.label)}>
                Download CSV
              </button>
            </div>
          ))}
        </div>

        <div class="exportfoot">
          <button class="btn btn--primary" onClick={saveAll}>
            Download all {sections.length + 1} files
          </button>
          {note && <span class="savenote" role="status">{note}</span>}
        </div>

        <div class="note">
          <strong>A README travels with the export</strong>
          It names which figures are measured, which are supplied, and which are assumed, and it says
          plainly that the per-control cost column must never be summed. A folder of CSVs with no context
          is how a caveated figure becomes an uncaveated one.
        </div>
        </div>
      </aside>
    </>
  );
}
