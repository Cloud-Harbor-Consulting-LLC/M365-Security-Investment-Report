import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { overrideCount, type Overrides, type ReportModel } from '@/engine';
import { Assumptions } from './Assumptions';
import { shortDate } from '@/format';
import {
  BoardView,
  FeaturesView,
  EvidenceView,
  ExecutiveView,
  NotMeasuredView,
  PendingView,
  WasteView,
} from './views';

interface Props {
  model: ReportModel;
  sourceLabel: string;
  overrides: Overrides;
  onPriceChange: (partNumber: string, price: number | null) => void;
  onResetOverrides: () => void;
  onReset: () => void;
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
  onReset,
}: Props): JSX.Element {
  const [view, setView] = useState<ViewId>('board');
  const [presenting, setPresenting] = useState(false);
  const [redacted, setRedacted] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const overridden = overrideCount(overrides);

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]!;
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
            <button class="chip act" onClick={onReset}>
              Start over
            </button>
          </div>
        </header>

        <div class="canvas">
          <div class="section-head">
            <h2>{current.label}</h2>
            <span class="aud">{current.audience}</span>
          </div>

          {view === 'board' && <BoardView model={model} onPriceChange={onPriceChange} />}
          {view === 'exec' && <ExecutiveView model={model} onPriceChange={onPriceChange} />}
          {view === 'waste' && <WasteView model={model} />}
          {view === 'features' && <FeaturesView model={model} />}
          {view === 'roadmap' && (
            <PendingView
              title="The remediation roadmap"
              why="A sequence of the gaps worth closing, ranked by risk reduction against effort. It cannot be produced before the gaps themselves are known."
              needs="Feature-gap analysis, which needs Secure Score control evidence"
            />
          )}
          {view === 'notmeasured' && <NotMeasuredView model={model} />}
          {view === 'evidence' && <EvidenceView model={model} />}

          <footer class="foot">
            <p>
              Microsoft Graph does not expose contract pricing; every monetary figure derives from the supplied
              price table.
            </p>
            <p>M365 Security Investment Report — open source, MIT licensed.</p>
          </footer>
        </div>
      </div>

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
