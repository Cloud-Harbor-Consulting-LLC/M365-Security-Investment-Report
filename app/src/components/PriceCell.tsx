import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { money } from '@/format';

interface Props {
  partNumber: string;
  /** Current effective price, or null when the table does not cover this SKU. */
  price: number | null;
  overridden: boolean;
  currency: string;
  onChange: (partNumber: string, price: number | null) => void;
  /** Excluded SKUs carry no cost, so there is nothing to price. */
  disabled?: boolean;
}

/**
 * A price, editable where it appears.
 *
 * Deliberately in the table rather than only in a settings panel. The moment this exists
 * for is a CFO saying "we don't pay list, we pay 28" — and the answer to that should be
 * typing 28 next to the number they are looking at, not navigating away to a form and
 * back. An unpriced SKU shows "Add price" for the same reason: the gap is visible
 * exactly where it matters.
 */
export function PriceCell({
  partNumber,
  price,
  overridden,
  currency,
  onChange,
  disabled,
}: Props): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  if (disabled) return <>—</>;

  const begin = () => {
    setDraft(price === null ? '' : String(price));
    setEditing(true);
  };

  const commit = () => {
    // Read the field rather than the draft state. A keystroke and Enter arriving in the
    // same frame would otherwise commit a stale value — the state update has not been
    // rendered yet, so the handler still closes over the previous draft.
    const raw = (input.current?.value ?? draft).trim();
    // An emptied field means "I do not know this price", which is different from zero
    // and must return the SKU to unpriced rather than valuing it at nothing.
    onChange(partNumber, raw === '' ? null : Number(raw));
    setEditing(false);
  };

  if (editing) {
    return (
      <span class="price-edit">
        <input
          ref={input}
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={draft}
          aria-label={`Monthly price per seat for ${partNumber}`}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </span>
    );
  }

  if (price === null) {
    return (
      <button class="pill pill--add" onClick={begin} title={`Add a price for ${partNumber}`}>
        Add price
      </button>
    );
  }

  return (
    <button
      class={overridden ? 'price-btn price-btn--overridden' : 'price-btn'}
      onClick={begin}
      title={
        overridden
          ? `Your price for ${partNumber}. Click to change, clear the field to revert.`
          : `Shipped list price for ${partNumber}. Click to override.`
      }
    >
      {money(price, currency, 2)}
      {overridden && <span class="price-mark" aria-label="customer-supplied" />}
    </button>
  );
}
