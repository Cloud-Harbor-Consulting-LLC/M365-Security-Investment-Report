import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { overrideCount, type Overrides, type ReportModel, type SessionFile } from '@/engine';
import { Assumptions } from './Assumptions';
import { BoardPack } from './BoardPack';
import { useAnnounce } from '@/a11y';
import { Exports } from './Exports';
import { shortDate } from '@/format';
import {
  BoardView,
  FeaturesView,
  EvidenceView,
  ExecutiveView,
  NotMeasuredView,
  PendingView,
  RoadmapView,
  WasteView,
} from './views';

interface Props {
  model: ReportModel;
  sourceLabel: string;
  overrides: Overrides;
  onPriceChange: (partNumber: string, price: number | null) => void;
  onResetOverrides: () => void;
  /** Returns null on success, or a reason the browser refused the download. */
  onSaveSession: () => string | null;
  /**
   * The tenant data and the consultant's prices, on demand. The dashboard renders the
   * model rather than the snapshot, but the one-file export has to embed the snapshot
   * itself so the report it produces can be re-derived rather than merely re-displayed.
   */
  session: () => SessionFile;
  onReset: () => void;
  /**
   * True inside the exported one-file report, where there is no landing screen to
   * return to and no way to build another export from a file that is already one.
   */
  standalone?: boolean;
}

type ViewId = 'board' | 'exec' | 'waste' | 'features' | 'roadmap' | 'notmeasured' | 'evidence';

interface ViewDef {
  id: ViewId;
  label: string;
  audience: string;
  group: 'audience' | 'transparency';
}

const VIEWS: ViewDef[] = [
  { id: 'board', label: 'Board', audience: 'Board · CFO', group: 'audience' },
  { id: 'exec', label: 'Executive', audience: 'CISO · CIO · CFO', group: 'audience' },
  { id: 'waste', label: 'Wasted spend', audience: 'CFO · IT operations', group: 'audience' },
  { id: 'features', label: 'Security features', audience: 'Security architect', group: 'audience' },
  { id: 'roadmap', label: 'Roadmap', audience: 'Security architect · CISO', group: 'audience' },
  { id: 'notmeasured', label: 'Not measured', audience: 'Everyone', group: 'transparency' },
  { id: 'evidence', label: 'Evidence', audience: 'Security architect', group: 'transparency' },
];

export function Dashboard({
  model,
  sourceLabel,
  overrides,
  onPriceChange,
  onResetOverrides,
  onSaveSession,
  session,
  onReset,
  standalone = false,
}: Props): JSX.Element {
  const [view, setView] = useState<ViewId>('board');
  const [presenting, setPresenting] = useState(false);
  const [redacted, setRedacted] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
  const overridden = overrideCount(overrides);

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]!;
  // Sighted users see the panel swap. Without this, pressing a navigation button gives a
  // screen-reader user no indication that anything happened at all.
  useAnnounce(`${current.label} view. For ${current.audience}.`);
  const shellClasses = ['shell'];
  if (presenting) shellClasses.push('shell--presenting');
  if (redacted) shellClasses.push('shell--redacted');

  const nav = (group: ViewDef['group']) =>
    VIEWS.filter((v) => v.group === group).map((v) => (
      <button
        key={v.id}
        class="nav"
        aria-current={v.id === view ? 'true' : 'false'}
        onClick={() => setView(v.id)}
      >
        <i class="dot" aria-hidden="true" />
        {v.label}
      </button>
    ));

  return (
    <div class={shellClasses.join(' ')}>
      <nav class="rail" aria-label="Report sections">
        <div class="rail-brand">
          M365 Security
          <span>Investment Report</span>
        </div>

        <div class="navgroup">
          <div class="navlabel">Audience views</div>
          {nav('audience')}
        </div>

        <div class="navgroup">
          <div class="navlabel">Transparency</div>
          {nav('transparency')}
        </div>

        <div class="railfoot">
          <div class="readonly-badge">Read-only. Graph GET requests only.</div>
          <div>
            Snapshot {shortDate(model.provenance.snapshotCollected)}
            <br />
            from <span class="redactable">{sourceLabel}</span>
          </div>
        </div>
      </nav>

      <div class="main">
        <header class="topbar">
          <div class="tenant">
            <strong class="redactable">{model.tenant.DisplayName}</strong>
            <span class="redactable">{model.tenant.DefaultDomain ?? model.tenant.TenantId}</span>
          </div>

          <div class="chips">
            {presenting && (
              <div class="presenter-nav">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    aria-current={v.id === view ? 'true' : 'false'}
                    onClick={() => setView(v.id)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
            <button
              class={overridden > 0 ? 'chip act on' : 'chip act'}
              onClick={() => setAssumptionsOpen(true)}
              title="Review and change the prices behind every figure"
            >
              {overridden > 0 ? (
                <>
                  <b>{overridden}</b> price{overridden === 1 ? '' : 's'} overridden
                </>
              ) : (
                <>Pricing</>
              )}
            </button>
            <button
              class={redacted ? 'chip act on' : 'chip act'}
              aria-pressed={redacted}
              onClick={() => setRedacted(!redacted)}
              title="Blur tenant identity for screen-sharing"
            >
              Redact
            </button>
            <button
              class={presenting ? 'chip act on' : 'chip act'}
              aria-pressed={presenting}
              onClick={() => setPresenting(!presenting)}
              title="Larger type, no sidebar"
            >
              Presenter
            </button>
            <button
              class="chip act"
              onClick={() => window.print()}
              title="Six pages for a board: the position, waste, what is not switched on, what to do first, and how every figure was made"
            >
              Board pack
            </button>
            <button class="chip act" onClick={() => setExportsOpen(true)} title="JSON and CSV for the whole analysis">
              Export
            </button>
            <button
              class="chip act"
              onClick={() => {
                const failure = onSaveSession();
                // A blocked download must say so. Believing prices are safely on disk
                // when nothing was written is the one outcome worse than not offering it.
                setSaveNote(failure ?? 'Session saved to your downloads.');
                setTimeout(() => setSaveNote(null), 6000);
              }}
              title="Save the tenant data and your prices to a file you can reopen later"
            >
              Save session
            </button>
            {!standalone && (
              <button class="chip act" onClick={onReset}>
                Start over
              </button>
            )}
          </div>
        </header>

        {saveNote && (
          <div class="savebar" role="status">
            {saveNote}
          </div>
        )}

        <main class="canvas" id="report" aria-labelledby="view-heading">
          <div class="section-head">
            <h2 id="view-heading">{current.label}</h2>
            <span class="aud">{current.audience}</span>
          </div>

          {view === 'board' && <BoardView model={model} onPriceChange={onPriceChange} />}
          {view === 'exec' && <ExecutiveView model={model} onPriceChange={onPriceChange} />}
          {view === 'waste' && <WasteView model={model} />}
          {view === 'features' && <FeaturesView model={model} />}
          {view === 'roadmap' && <RoadmapView model={model} />}
          {view === 'notmeasured' && <NotMeasuredView model={model} />}
          {view === 'evidence' && <EvidenceView model={model} />}

          <footer class="foot">
            <p>
              Microsoft Graph does not expose contract pricing; every monetary figure derives from the supplied
              price table.
            </p>
            <p>M365 Security Investment Report — open source, MIT licensed.</p>
          </footer>
        </main>
      </div>

      {/*
        Rendered always, hidden on screen by the print stylesheet, rather than built when
        the button is clicked. A reader who simply presses Ctrl+P must get the board pack
        and not a mangled screenshot of the dashboard -- and that is the person most
        likely to be printing this in a hurry, minutes before a meeting.
      */}
      <BoardPack model={model} sourceLabel={sourceLabel} />

      <Exports
        model={model}
        sourceLabel={sourceLabel}
        session={session}
        standalone={standalone}
        open={exportsOpen}
        onClose={() => setExportsOpen(false)}
      />

      <Assumptions
        model={model}
        open={assumptionsOpen}
        overriddenCount={overridden}
        onClose={() => setAssumptionsOpen(false)}
        onPriceChange={onPriceChange}
        onResetOverrides={onResetOverrides}
      />
    </div>
  );
}
