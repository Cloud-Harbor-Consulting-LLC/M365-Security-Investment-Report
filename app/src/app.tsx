import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Landing } from '@/components/Landing';
import { Connect } from '@/components/Connect';
import { Dashboard } from '@/components/Dashboard';
import {
  analyze,
  buildSession,
  clearOverrides,
  parseSession,
  sessionFileName,
  setOverride,
  type Overrides,
  type ReportModel,
} from '@/engine';
import { downloadJson } from '@/download';
import { catalog, cloneConfig, featureMap, listPriceList, riskModel } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';
import { compareWith, readEarlierRun } from '@/comparison';
import type { RunComparison } from '@/engine/compare';

type Screen = 'landing' | 'connect' | 'report';

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('landing');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [overrides, setOverrides] = useState<Overrides>(clearOverrides());
  const [error, setError] = useState<string | null>(null);
  /** An earlier run of the same tenant, while the report is being compared with one. */
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  /** Something to tell the reader about the comparison, such as prices left behind. */
  const [compareNote, setCompareNote] = useState<string | null>(null);

  /**
   * The model is derived, never stored.
   *
   * Every price change recomputes the whole report from the snapshot rather than
   * patching figures in place, which is what makes an override reach spend, waste,
   * realization and the pricing basis at once. The engine is pure and takes single-digit
   * milliseconds, so there is nothing to gain from doing it incrementally and a great
   * deal to lose in correctness.
   */
  const model: ReportModel | null = useMemo(() => {
    if (!snapshot) return null;
    try {
      return analyze({ snapshot, config: cloneConfig(), catalog, priceList: listPriceList,
      featureMap,
      riskModel, overrides });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [snapshot, overrides]);

  // Derived on the same rule as the model, so a price typed mid-meeting reprices both runs.
  const comparison: RunComparison | null = useMemo(() => {
    if (!snapshot || !baseline) return null;
    const result = compareWith(baseline, snapshot, overrides);
    return result.ok ? result.comparison : null;
  }, [snapshot, baseline, overrides]);

  /** Returns null when the earlier run was accepted, or the reason it was not. */
  const compare = (raw: unknown): string | null => {
    if (!snapshot) return 'Open a report before comparing it with an earlier run.';
    const earlier = readEarlierRun(raw);
    if (!earlier.ok) return earlier.reason;
    const result = compareWith(earlier.snapshot, snapshot, overrides);
    if (!result.ok) return result.reason;
    setBaseline(earlier.snapshot);
    setCompareNote(earlier.note);
    return null;
  };

  const accept = (next: Snapshot, label: string, restored?: Overrides): string | null => {
    const parsed = parseSnapshot(next);
    if (!parsed.ok) return parsed.reason;

    try {
      // Analyse once up front so a bad snapshot fails here rather than on the dashboard.
      analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap, riskModel });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }

    setSnapshot(parsed.snapshot);
    setSourceLabel(label);
    setOverrides(restored ?? clearOverrides());
    // A new report starts uncompared. A session that carried an earlier run puts it back
    // straight after this.
    setBaseline(null);
    setCompareNote(null);
    setError(null);
    setScreen('report');
    return null;
  };

  const onLoadedFile = (raw: unknown, label: string) => {
    if (raw === null) {
      setError('It is not valid JSON.');
      return;
    }

    // One drop target, two kinds of file. A session is identified by its own marker
    // rather than by guessing at shape, so a snapshot is never half-read as a session.
    if (raw !== null && typeof raw === 'object' && 'kind' in (raw as object)) {
      const session = parseSession(raw);
      if (!session.ok) {
        setError(session.reason);
        return;
      }
      const failure = accept(
        session.session.snapshot,
        session.session.sourceLabel,
        session.session.overrides,
      );
      if (failure) {
        setError(failure);
        return;
      }
      // Restore the comparison the session was saved with, if it still holds. A file
      // edited into an impossible pair opens without it, and says so.
      const prior = session.session.baseline;
      if (prior) {
        const restored = compareWith(prior, session.session.snapshot, session.session.overrides);
        if (restored.ok) setBaseline(prior);
        else setCompareNote(`The earlier run saved with this session was not restored. ${restored.reason}`);
      } else if (session.session.notice) {
        setCompareNote(session.session.notice);
      }
      return;
    }

    const failure = accept(raw as Snapshot, label);
    if (failure) setError(failure);
  };

  if (screen === 'connect') {
    return (
      <div class="page">
        <Connect onSnapshot={accept} onCancel={() => setScreen('landing')} />
      </div>
    );
  }

  if (screen === 'report' && model) {
    return (
      <Dashboard
        model={model}
        sourceLabel={sourceLabel}
        overrides={overrides}
        comparison={comparison}
        compareNote={compareNote}
        onCompare={compare}
        onStopComparing={() => {
          setBaseline(null);
          setCompareNote(null);
        }}
        onPriceChange={(partNumber, price) => setOverrides((o) => setOverride(o, partNumber, price))}
        onResetOverrides={() => setOverrides(clearOverrides())}
        onSaveSession={() => {
          const file = sessionFileName(model.tenant.DisplayName);
          const result = downloadJson(file, buildSession(snapshot!, overrides, sourceLabel, baseline));
          return result.ok ? null : result.reason;
        }}
        session={() => buildSession(snapshot!, overrides, sourceLabel, baseline)}
        onReset={() => {
          setSnapshot(null);
          setOverrides(clearOverrides());
          setBaseline(null);
          setCompareNote(null);
          setError(null);
          setScreen('landing');
        }}
      />
    );
  }

  return (
    <div class="page">
      <Landing
        onSnapshot={onLoadedFile}
        onConnect={() => {
          setError(null);
          setScreen('connect');
        }}
        error={error}
      />
    </div>
  );
}
