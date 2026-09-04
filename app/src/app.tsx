import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { Landing } from '@/components/Landing';
import { Board } from '@/components/Board';
import { analyze, type ReportModel } from '@/engine';
import { catalog, cloneConfig, listPriceList } from '@/data/reference';
import { parseSnapshot } from '@/model/snapshot';

export function App(): JSX.Element {
  const [model, setModel] = useState<ReportModel | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSnapshot = (raw: unknown, label: string) => {
    if (raw === null) {
      setError('It is not valid JSON.');
      return;
    }

    const parsed = parseSnapshot(raw);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    try {
      setModel(
        analyze({
          snapshot: parsed.snapshot,
          config: cloneConfig(),
          catalog,
          priceList: listPriceList,
        }),
      );
      setSourceLabel(label);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!model) {
    return (
      <div class="page">
        <Landing onSnapshot={onSnapshot} error={error} />
      </div>
    );
  }

  return (
    <Board
      model={model}
      sourceLabel={sourceLabel}
      onReset={() => {
        setModel(null);
        setError(null);
      }}
    />
  );
}
