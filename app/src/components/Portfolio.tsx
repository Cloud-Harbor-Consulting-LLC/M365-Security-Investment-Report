import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { count, money, percent, percentagePointChange, shortDate } from '@/format';
import { byOpportunity, totalOf, type DroppedFile, type Portfolio as PortfolioData, type PortfolioRow } from '@/portfolio';
import { readFiles } from '@/readFiles';
import { useScrollableRegions } from '@/a11y';
import { TenantMark } from './TenantMark';

interface Props {
  rows: PortfolioRow[];
  rejected: PortfolioData['rejected'];
  onOpen: (tenantId: string) => void;
  onAddFiles: (files: DroppedFile[]) => void;
  /** Returns null on success, or a reason the browser refused the download. */
  onDownloadCsv: () => string | null;
  onReset: () => void;
}

/**
 * Every client the consultant dropped in, one line each, largest opportunity first.
 *
 * The figures are each client's own headline figures, drawn from the same model as that
 * client's report, so nothing here can disagree with what opening the client shows.
 */
export function Portfolio({ rows, rejected, onOpen, onAddFiles, onDownloadCsv, onReset }: Props): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useScrollableRegions();
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const sorted = byOpportunity(rows);
  const cur = rows[0]?.currency ?? 'USD';

  const add = async (files: FileList | null | undefined) => {
    if (files && files.length > 0) onAddFiles(await readFiles(files));
  };

  const total = (pick: (r: PortfolioRow) => number | null, floor = false) => {
    const t = totalOf(rows, pick);
    if (t === null) return 'Not available';
    return (
      <>
        {floor ? 'at least ' : ''}
        {money(t.total, cur)}
        {t.counted < rows.length && (
          <>
            <br />
            <span class="hint">
              {t.counted} of {rows.length} clients
            </span>
          </>
        )}
      </>
    );
  };
  const wasteFloor = rows.some((r) => r.waste.floor);

  return (
    <div class="landing portfolio">
      <h2>
        Portfolio, {count(rows.length)} client{rows.length === 1 ? '' : 's'}
      </h2>
      <p class="lede">
        Each client&rsquo;s newest run, side by side. These files stay in this browser tab: nothing is stored or
        sent anywhere, and closing the tab forgets the portfolio. Drop the same files again to rebuild it.
      </p>

      <div class="note warn">
        <strong>Every client in this list is on screen</strong>
        Open one client before sharing your screen with them.
      </div>

      <div class="panel">
        <div class="tw">
          <table>
            <caption>Clients ordered by licence spend not yet switched on, largest first</caption>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col" class="num">Spend realized</th>
                <th scope="col" class="num">Annual commitment</th>
                <th scope="col" class="num">Not switched on</th>
                <th scope="col" class="num">Seat waste</th>
                <th scope="col" class="num">Newly entitled</th>
                <th scope="col">
                  <span class="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const since = r.comparison?.headline.spendRealized.change ?? null;
                return (
                  <tr key={r.tenant.tenantId}>
                    <td class="client-cell">
                      <TenantMark name={r.name} logo={r.model.tenant.Logo} />
                      <span>
                        <span class="prod">{r.name}</span>
                        <br />
                        <span class="hint">
                          {r.domain} &middot; collected {shortDate(r.collected)}
                          {r.notCollected > 0 && (
                            <>
                              {' '}
                              &middot; {r.notCollected} collector{r.notCollected === 1 ? '' : 's'} not collected
                            </>
                          )}
                        </span>
                      </span>
                    </td>
                    <td class="num">
                      {percent(r.realized.ratio)}
                      {r.realized.label !== 'Spend realized' && (
                        <>
                          <br />
                          <span class="hint">{r.realized.label.toLowerCase()}</span>
                        </>
                      )}
                      {r.comparison && (
                        <>
                          <br />
                          <span class="hint">
                            {since === null ? 'not comparable' : percentagePointChange(since)} since{' '}
                            {shortDate(r.comparison.baselineCollected)}
                          </span>
                        </>
                      )}
                    </td>
                    <td class="num">{r.commitment === null ? 'Not available' : money(r.commitment, r.currency)}</td>
                    <td class="num">{r.notSwitchedOn === null ? 'Not measured' : money(r.notSwitchedOn, r.currency)}</td>
                    <td class="num">
                      {r.waste.total === null
                        ? 'Not available'
                        : r.waste.floor
                          ? `at least ${money(r.waste.total, r.currency)}`
                          : money(r.waste.total, r.currency)}
                    </td>
                    <td class="num">{r.newlyEntitled === 0 ? 'None' : count(r.newlyEntitled)}</td>
                    <td>
                      <button class="btn" type="button" onClick={() => onOpen(r.tenant.tenantId)}>
                        Open<span class="sr-only"> {r.name}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total, {count(rows.length)} clients</td>
                  <td />
                  <td class="num">{total((r) => r.commitment)}</td>
                  <td class="num">{total((r) => r.notSwitchedOn)}</td>
                  <td class="num">{total((r) => r.waste.total, wasteFloor)}</td>
                  <td class="num">{count(rows.reduce((n, r) => n + r.newlyEntitled, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p class="basis-note">
          <strong>Newly entitled</strong> counts controls a recent Microsoft packaging change brought into a licence
          the client already owns, and that are not switched on yet. <strong>Not switched on</strong> is licence
          spend that deploying what each client already owns would put to work, not a saving. A total that could
          not include every client says how many it covers.
        </p>
        {sorted
          .filter((r) => r.tenant.notes.length > 0)
          .map((r) => (
            <p class="basis-note" key={r.tenant.tenantId}>
              <strong>{r.name}.</strong> {r.tenant.notes.join(' ')}
            </p>
          ))}
      </div>

      {rejected.length > 0 && (
        <div class="error" role="alert">
          <strong>
            {rejected.length} file{rejected.length === 1 ? ' was' : 's were'} left out
          </strong>
          <ul>
            {rejected.map((r) => (
              <li key={r.file}>
                <code>{r.file}</code>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        class={dragging ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void add(e.dataTransfer?.files);
        }}
      >
        <p>
          <strong>Drop more snapshots or sessions here</strong>, or{' '}
          <button type="button" class="linkbtn pick" onClick={() => picker.current?.click()}>
            choose files
          </button>
          <input
            ref={picker}
            type="file"
            accept="application/json,.json"
            multiple
            onChange={(e) => void add(e.currentTarget.files)}
            hidden
          />
        </p>
        <p class="hint">An earlier run of a client already listed becomes its comparison.</p>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;align-items:center">
        <button
          class="btn"
          type="button"
          onClick={() => {
            const failure = onDownloadCsv();
            setDownloadNote(failure ?? 'Saved to your downloads. The file names every client in this list.');
          }}
        >
          Download as CSV
        </button>
        <button class="btn" type="button" onClick={onReset}>
          Start over
        </button>
        {downloadNote && (
          <span role="status" class="hint">
            {downloadNote}
          </span>
        )}
      </div>
    </div>
  );
}
