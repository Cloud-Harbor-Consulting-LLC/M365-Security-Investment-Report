import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Landing } from '@/components/Landing';
import { Connect } from '@/components/Connect';
import { Dashboard } from '@/components/Dashboard';
import { analyze, type ReportModel } from '@/engine';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

type Screen = 'landing' | 'connect' | 'report';

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('landing');
  const [model, setModel] = useState<ReportModel | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Analyses a snapshot and shows the report.
   *
   * Returns an error message instead of navigating on failure, so the caller decides
   * where the reader ends up. Bouncing to the landing screen used to discard a
   * successful sign-in along with the error that caused it, which made a failure after
   * authentication look like the app had simply forgotten what it was doing.
   */
  const run = (snapshot: Snapshot, label: string): string | null => {
    try {
      setModel(
        analyze({
          snapshot,
          config: cloneConfig(),
          catalog,
          priceList: listPriceList,
        }),
      );
      setSourceLabel(label);
      setError(null);
      setScreen('report');
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const onLoadedFile = (raw: unknown, label: string) => {
    if (raw === null) {
      setError('It is not valid JSON.');
      return;
    }
    const parsed = parseSnapshot(raw);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    const failure = run(parsed.snapshot, label);
    if (failure) setError(failure);
  };

  if (screen === 'connect') {
    return (
      <div class="page">
        <Connect onSnapshot={run} onCancel={() => setScreen('landing')} />
      </div>
    );
  }

  if (screen === 'report' && model) {
    return (
      <Dashboard
        model={model}
        sourceLabel={sourceLabel}
        onReset={() => {
          setModel(null);
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
