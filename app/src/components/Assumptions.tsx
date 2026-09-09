import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { count } from '@/format';
import { useDialog } from '@/a11y';
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
  // Escape, a focus trap, and focus returned to whatever opened this. The panel stays
  // in the DOM when closed so it can animate, which is exactly why the trap matters:
  // without it every price input in here sits in the tab order of the page behind.
  const panel = useDialog(open, onClose);

  const rows = model.inventory.filter((r) => !r.excluded);
  const cur = model.spend.currency;

  return (
    <>
      <div class={open ? 'scrim on' : 'scrim'} onClick={onClose} />
      <aside
        ref={panel}
        class={open ? 'over on' : 'over'}
        aria-hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Pricing assumptions"
      >
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
              <caption>Every priced licence and the per-seat rate behind it</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" class="num">Seats</th>
                  <th scope="col" class="num">Per seat / mo</th>
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
