import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Landing } from '@/components/Landing';
import { Connect } from '@/components/Connect';
import { Board } from '@/components/Board';
import { analyze, type ReportModel } from '@/engine';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot, type Snapshot } from '@/model/snapshot';

type Screen = 'landing' | 'connect' | 'report';

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('landing');
  const [model, setModel] = useState<ReportModel | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (snapshot: Snapshot, label: string) => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScreen('landing');
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
    run(parsed.snapshot, label);
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
      <Board
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
