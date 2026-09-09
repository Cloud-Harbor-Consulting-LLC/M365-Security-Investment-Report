import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Landing } from '@/components/Landing';
import { Connect } from '@/components/Connect';
import { Dashboard } from '@/components/Dashboard';
import { analyze, clearOverrides, setOverride, type Overrides, type ReportModel } from '@/engine';
import { catalog, cloneConfig, featureMap, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

type Screen = 'landing' | 'connect' | 'report';

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('landing');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [overrides, setOverrides] = useState<Overrides>(clearOverrides());
  const [error, setError] = useState<string | null>(null);

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
      featureMap, overrides });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [snapshot, overrides]);

  const accept = (next: Snapshot, label: string): string | null => {
    const parsed = parseSnapshot(next);
    if (!parsed.ok) return parsed.reason;

    try {
      // Analyse once up front so a bad snapshot fails here rather than on the dashboard.
      analyze({ snapshot: parsed.snapshot, config: cloneConfig(), catalog, priceList: listPriceList, featureMap });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }

    setSnapshot(parsed.snapshot);
    setSourceLabel(label);
    setOverrides(clearOverrides());
    setError(null);
    setScreen('report');
    return null;
  };

  const onLoadedFile = (raw: unknown, label: string) => {
    if (raw === null) {
      setError('It is not valid JSON.');
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
        onPriceChange={(partNumber, price) => setOverrides((o) => setOverride(o, partNumber, price))}
        onResetOverrides={() => setOverrides(clearOverrides())}
        onReset={() => {
          setSnapshot(null);
          setOverrides(clearOverrides());
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
