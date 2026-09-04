import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { count } from '@/format';
import { PriceCell } from './PriceCell';

interface Props {
  model: ReportModel;
  open: boolean;
  overriddenCount: number;
  onClose: () => void;
  onPriceChange: (partNumber: string, price: number | null) => void;
  onResetOverrides: () => void;
}

/**
 * Every price behind the report, in one place.
 *
 * The secondary path deliberately: the primary one is editing a figure where it appears.
 * This exists for reviewing what has been changed, for pricing several SKUs in one pass
 * before a meeting, and for putting everything back.
 */
export function Assumptions({
  model,
  open,
  overriddenCount,
  onClose,
  onPriceChange,
  onResetOverrides,
}: Props): JSX.Element {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const rows = model.inventory.filter((r) => !r.excluded);
  const cur = model.spend.currency;

  return (
    <>
      <div class={open ? 'scrim on' : 'scrim'} onClick={onClose} />
      <aside class={open ? 'over on' : 'over'} aria-hidden={!open} aria-label="Pricing assumptions">
        <div class="overhead">
          <h3>Pricing</h3>
          <button class="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div class="overbody">
          <p class="over-intro">
            Microsoft Graph does not expose contract pricing, so every dollar figure in this report comes from
            these numbers. Change one and the whole report recalculates.
          </p>

          <div class="basis-state">
            <span class="lab">Current basis</span>
            <strong>{model.spend.basisLabel}</strong>
          </div>

          <div class="tw">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th class="num">Seats</th>
                  <th class="num">Per seat / mo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.skuId}>
                    <td>
                      <span class="prod">{row.displayName}</span>
                      <br />
                      <code class="sku">{row.skuPartNumber}</code>
                    </td>
                    <td class="num">{count(row.purchasedUnits)}</td>
                    <td class="num">
                      <PriceCell
                        partNumber={row.skuPartNumber}
                        price={row.unitPriceMonthly}
                        overridden={row.priceOverridden}
                        currency={cur}
                        onChange={onPriceChange}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button class="btn" onClick={onResetOverrides} disabled={overriddenCount === 0}>
            {overriddenCount === 0
              ? 'Nothing overridden'
              : `Reset ${overriddenCount} price${overriddenCount === 1 ? '' : 's'} to the shipped table`}
          </button>

          <p class="over-note">
            Prices live only in this browser tab and are lost when it closes. Nothing is written anywhere, and
            nothing is sent anywhere.
          </p>
        </div>
      </aside>
    </>
  );
}
