import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import type { RunComparison } from '@/engine/compare';
import { shortDate } from '@/format';
import { useDialog } from '@/a11y';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The comparison in force, if there is one. */
  comparison: RunComparison | null;
  /** Returns null when the earlier run was accepted, or the reason it was not. */
  onCompare: (raw: unknown) => string | null;
  onStop: () => void;
  /** Called once an earlier run has been accepted, so the dashboard can show it. */
  onCompared: () => void;
}

/**
 * Choosing an earlier run to compare the report with.
 *
 * The question it opens is a quarterly review's: since we last looked, what changed? The
 * file is read here in the browser and goes nowhere, on the same terms as every other file
 * this tool opens, and the dialog says so before asking for one.
 */
export function Compare({ open, onClose, comparison, onCompare, onStop, onCompared }: Props): JSX.Element | null {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Above the early return: a hook cannot be called conditionally, and this one does
  // nothing while the dialog is closed.
  const panel = useDialog(open, () => {
    setError(null);
    onClose();
  });
  if (!open) return null;

  const read = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let raw: unknown = null;
      try {
        raw = JSON.parse(String(reader.result));
      } catch {
        raw = null;
      }
      const failure = onCompare(raw);
      if (failure) {
        setError(failure);
        return;
      }
      setError(null);
      onCompared();
    };
    reader.onerror = () => setError('That file could not be read.');
    reader.readAsText(file);
  };

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <>
      <div class={open ? 'scrim on' : 'scrim'} onClick={close} />
      <aside
        ref={panel}
        class={open ? 'over on' : 'over'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-heading"
      >
        <div class="overhead">
          <h3 id="compare-heading">Compare with an earlier run</h3>
          <button class="x" onClick={close} aria-label="Close">
            &times;
          </button>
        </div>

        <div class="overbody">
          <p class="over-intro">
            Choose a snapshot or a saved session from an earlier collection of this tenant. The report then
            shows what changed since: spend realized, the controls that closed or regressed, licences bought
            and dropped, and waste. The file is read here in your browser and is not uploaded.
          </p>

          {comparison && (
            <div class="note">
              <strong>Comparing with the run collected on {shortDate(comparison.baselineCollected)}</strong>
              {comparison.daysBetween} days before this one. Choose another file to compare with a different
              run instead.
              <div class="compare-actions">
                <button
                  class="btn"
                  onClick={() => {
                    onStop();
                    close();
                  }}
                >
                  Stop comparing
                </button>
              </div>
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
              const file = e.dataTransfer?.files?.[0];
              if (file) read(file);
            }}
          >
            <p>
              <strong>Drop the earlier snapshot or session here</strong>
            </p>
            {/* A real button, so a keyboard reaches it. The input it opens is hidden. */}
            <button class="btn" onClick={() => picker.current?.click()}>
              Choose a file
            </button>
            <input
              ref={picker}
              id="compare-file"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) read(file);
                e.currentTarget.value = '';
              }}
            />
          </div>

          {error && (
            <div class="error" role="alert">
              <strong>That file could not be compared</strong>
              {error}
            </div>
          )}

          <div class="note">
            <strong>Both runs are priced the same way</strong>
            The earlier run is priced at the prices this report uses now, and analysed with the same reference
            data, so a difference always means something changed in the tenant rather than in a price list.
            Prices saved inside an earlier session are not used.
          </div>
        </div>
      </aside>
    </>
  );
}
