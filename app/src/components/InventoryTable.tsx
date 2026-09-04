import type { JSX } from 'preact';
import type { ReportModel } from '@/engine';
import { count, money } from '@/format';
import { PriceCell } from './PriceCell';

/**
 * The per-SKU inventory, shared by the executive and evidence views.
 *
 * The totals row is labelled only "Total": seat columns cover every non-excluded SKU
 * while money columns cover priced ones, so no single qualifier is true of the whole
 * row. The note below states both bases instead.
 */
interface Props {
  model: ReportModel;
  /** Omit to render the table read-only, as the evidence view does. */
  onPriceChange?: (partNumber: string, price: number | null) => void;
}

export function InventoryTable({ model, onPriceChange }: Props): JSX.Element {
  const { spend, inventory } = model;
  const cur = spend.currency;

  const rows = [...inventory].sort(
    (a, b) => Number(a.excluded) - Number(b.excluded) || (b.annualCommitment ?? 0) - (a.annualCommitment ?? 0),
  );

  return (
    <>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Part number</th>
              <th class="num">Purchased</th>
              <th class="num">Assigned</th>
              <th class="num">Unassigned</th>
              <th class="num">Unit / mo</th>
              <th class="num">Commitment</th>
              <th class="num">Idle cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.skuId} class={row.excluded ? 'muted' : undefined}>
                <td>
                  <span class="prod">{row.displayName}</span>{' '}
                  {row.namingTrap && (
                    <span class="pill attention" title={row.namingTrap}>
                      naming trap
                    </span>
                  )}
                  {!row.inCatalog && <span class="pill">unrecognized</span>}
                </td>
                <td>
                  <code class="sku">{row.skuPartNumber}</code>
                </td>
                <td class="num">{count(row.purchasedUnits)}</td>
                <td class="num">{count(row.consumedUnits)}</td>
                <td class="num">{count(row.unassignedUnits)}</td>
                <td class="num">
                  {onPriceChange ? (
                    <PriceCell
                      partNumber={row.skuPartNumber}
                      price={row.unitPriceMonthly}
                      overridden={row.priceOverridden}
                      currency={cur}
                      onChange={onPriceChange}
                      disabled={row.excluded}
                    />
                  ) : row.priceKnown ? (
                    money(row.unitPriceMonthly, cur, 2)
                  ) : (
                    <span class="pill">no price</span>
                  )}
                </td>
                <td class="num">{row.excluded ? '—' : money(row.annualCommitment, cur)}</td>
                <td class="num">{row.excluded ? '—' : money(row.unassignedSeatCost, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td class="num">{count(spend.seatsPurchased)}</td>
              <td class="num">{count(spend.seatsConsumed)}</td>
              <td class="num">{count(spend.seatsUnassigned)}</td>
              <td class="num">—</td>
              <td class="num">{money(spend.annualCommitment, cur)}</td>
              <td class="num">{money(spend.unassignedSeatCost, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p class="basis-note">
        Seat totals cover every SKU except the {count(spend.skuCountExcluded)} excluded below.{' '}
        {spend.skuCountUnpriced > 0 ? (
          <>
            Dollar totals cover the {count(spend.skuCountPriced)} priced{' '}
            {spend.skuCountPriced === 1 ? 'SKU' : 'SKUs'} only, so the {count(spend.skuCountUnpriced)} unpriced{' '}
            {spend.skuCountUnpriced === 1 ? 'SKU contributes seats' : 'SKUs contribute seats'} but no cost.
          </>
        ) : (
          <>Every one of them is priced, so the dollar totals are complete.</>
        )}
      </p>

      {spend.skuCountExcluded > 0 && (
        <div class="note">
          <strong>
            {spend.skuCountExcluded} SKU{spend.skuCountExcluded === 1 ? '' : 's'} excluded from all totals
          </strong>
          Free and self-service SKUs report implausible seat counts that would otherwise dominate every figure.
          Listed so the exclusion is visible rather than silent:
          <ul>
            {spend.excludedSkus.map((s) => (
              <li key={s.skuPartNumber}>
                <code>{s.skuPartNumber}</code> — {s.exclusionReason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
