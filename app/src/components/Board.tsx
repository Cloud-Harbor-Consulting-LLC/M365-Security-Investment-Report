import type { JSX } from 'preact';
import type { ReportModel } from '@/engine';
import { count, money, percent, shortDate } from '@/format';

interface Props {
  model: ReportModel;
  sourceLabel: string;
  onReset: () => void;
}

/**
 * The board strip: the four figures a CFO reads first, plus the inventory behind them.
 *
 * Every claim about seats is derived from seat counts and every claim about money from
 * money — never one from the other. That inversion is what once produced "carries $0 a
 * year, with every purchased seat assigned" for a tenant with 26 of 27 seats idle.
 */
export function Board({ model, sourceLabel, onReset }: Props): JSX.Element {
  const { spend, realization, tenant, inventory } = model;
  const cur = spend.currency;

  const seatSentence =
    spend.seatsUnassigned > 0
      ? `${count(spend.seatsUnassigned)} of its ${count(spend.seatsPurchased)} purchased seats are not assigned to anyone.`
      : spend.seatsPurchased > 0
        ? `All ${count(spend.seatsPurchased)} of its purchased seats are assigned.`
        : 'No purchased seats were found.';

  return (
    <>
      <header class="masthead">
        <div class="masthead-inner">
          <div>
            <h1>Microsoft 365 Security Investment Report</h1>
            <div class="sub">
              {tenant.DisplayName}
              {tenant.DefaultDomain ? ` · ${tenant.DefaultDomain}` : ''}
            </div>
          </div>
          <div class="meta">
            <div>
              Snapshot <strong>{shortDate(model.provenance.snapshotCollected)}</strong>
            </div>
            <div>
              Pricing basis <strong>{spend.basisLabel}</strong>
            </div>
            <div>from {sourceLabel}</div>
          </div>
        </div>
      </header>

      <div class="page">
        <div class="section-head">
          <h2>Board one-pager</h2>
          <span class="aud">Board · CFO</span>
          <span class="spacer" />
          <button class="btn" onClick={onReset}>
            Load another snapshot
          </button>
        </div>

        <p class="lede-line">
          {spend.anyPriced ? (
            <>
              This tenant carries <strong>{money(spend.annualCommitment, cur)}</strong> a year in Microsoft 365
              licence commitment. <strong>{money(spend.unassignedSeatCost, cur)}</strong> of that pays for seats
              nobody is using.
            </>
          ) : (
            <>
              None of this tenant&rsquo;s {spend.skuCountTotal} subscribed SKUs could be priced, so no spend figure
              can be produced yet. {seatSentence}
            </>
          )}
        </p>

        <div class="tiles">
          <Tile
            label="Annual commitment"
            value={spend.anyPriced ? money(spend.annualCommitment, cur) : 'Not available'}
            unavailable={!spend.anyPriced}
            sub={`${count(spend.seatsPurchased)} purchased seats`}
          />
          <Tile
            label="Spend in use"
            value={spend.anyPriced ? money(spend.annualSpendConsumed, cur) : 'Not available'}
            unavailable={!spend.anyPriced}
            sub={`${count(spend.seatsConsumed)} assigned seats`}
          />
          <Tile
            label="Idle seat spend"
            value={spend.anyPriced ? money(spend.unassignedSeatCost, cur) : 'Not available'}
            unavailable={!spend.anyPriced}
            sub={`${count(spend.seatsUnassigned)} unassigned seats`}
            idle={spend.anyPriced}
          />
          <Tile
            label="Seat realization"
            value={percent(realization.seat.ratio)}
            sub={realization.seat.detail}
          />
        </div>

        {!spend.anyPriced && (
          <div class="note warn">
            <strong>No spend figures in this report</strong>
            Not one subscribed SKU matched an entry in the price table, so every monetary figure reads &ldquo;not
            available&rdquo; rather than zero. Add these part numbers to the price list to produce a spend analysis:
            <ul>
              {spend.unpricedSkus.map((s) => (
                <li key={s.skuPartNumber}>
                  <code>{s.skuPartNumber}</code> — {count(s.consumedUnits)} assigned seats
                </li>
              ))}
            </ul>
          </div>
        )}

        {spend.anyPriced && spend.skuCountUnpriced > 0 && (
          <div class="note warn">
            <strong>
              {spend.skuCountUnpriced} SKU{spend.skuCountUnpriced === 1 ? '' : 's'} have no price and are excluded
              from every dollar figure
            </strong>
            Their seats are counted but their cost is not, so the totals above are a floor rather than a complete
            picture.
            <ul>
              {spend.unpricedSkus.map((s) => (
                <li key={s.skuPartNumber}>
                  <code>{s.skuPartNumber}</code> — {count(s.consumedUnits)} assigned seats
                </li>
              ))}
            </ul>
          </div>
        )}

        <div class="note">
          <strong>Feature realization is not in this build</strong>
          How many of the security controls these licences entitle you to are actually deployed requires Secure
          Score control evidence, which is not collected yet. It shows as not measured rather than assumed
          complete, because reporting a seat-only figure as &ldquo;spend realized&rdquo; would overstate this
          tenant&rsquo;s position.
        </div>

        <div class="panel">
          <h3>Licence inventory</h3>
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
                {[...inventory]
                  .sort((a, b) => Number(a.excluded) - Number(b.excluded) || (b.annualCommitment ?? 0) - (a.annualCommitment ?? 0))
                  .map((row) => (
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
                        {row.priceKnown ? money(row.unitPriceMonthly, cur, 2) : <span class="pill">no price</span>}
                      </td>
                      <td class="num">{row.excluded ? '—' : money(row.annualCommitment, cur)}</td>
                      <td class="num">{row.excluded ? '—' : money(row.unassignedSeatCost, cur)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total · priced, non-excluded</td>
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
        </div>

        <footer class="foot">
          <div class="readonly-badge">
            Read-only: Microsoft Graph GET requests exclusively. Never writes to the tenant.
          </div>
          <p>
            Tenant {tenant.TenantId}. Microsoft Graph does not expose contract pricing; every monetary figure
            derives from the supplied price table.
          </p>
          <p>M365 Security Investment Report — open source, MIT licensed.</p>
        </footer>
      </div>
    </>
  );
}

function Tile(props: {
  label: string;
  value: string;
  sub: string;
  idle?: boolean;
  unavailable?: boolean;
}): JSX.Element {
  return (
    <div class={props.idle ? 'tile idle' : 'tile'}>
      <div class="lab">{props.label}</div>
      <div class={props.unavailable ? 'val na' : 'val'}>{props.value}</div>
      <div class="sub">{props.sub}</div>
    </div>
  );
}
