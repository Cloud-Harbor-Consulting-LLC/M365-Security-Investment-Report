import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { ReportModel } from '@/engine';
import { count, money, percent, plainText } from '@/format';
import { Tile } from './Tile';
import { InventoryTable } from './InventoryTable';
import { PriceCell } from './PriceCell';

/**
 * The dashboard views.
 *
 * Sections whose data is not collected yet say so explicitly and name what is missing,
 * rather than rendering an empty table or a zero. "Not measured" is a state this report
 * treats as first-class — it is the same discipline that stops a $0 appearing where the
 * truth is that nothing could be priced.
 */

export interface ViewProps {
  model: ReportModel;
  /** Present on the views where a price can be edited in place. */
  onPriceChange?: (partNumber: string, price: number | null) => void;
}

/* ── Board ────────────────────────────────────────────────────────────── */

export function BoardView({ model, onPriceChange }: ViewProps): JSX.Element {
  const { spend, realization } = model;
  const cur = spend.currency;

  const seatSentence =
    spend.seatsUnassigned > 0
      ? `${count(spend.seatsUnassigned)} of its ${count(spend.seatsPurchased)} purchased seats are not assigned to anyone.`
      : spend.seatsPurchased > 0
        ? `All ${count(spend.seatsPurchased)} of its purchased seats are assigned.`
        : 'No purchased seats were found.';

  return (
    <>
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
        {/* Show the composite once it is real; fall back to seat realization so the
            board still gets a number when Secure Score was refused. */}
        <Tile
          label={realization.composite.available ? realization.composite.label : realization.seat.label}
          value={percent(
            realization.composite.available ? realization.composite.ratio : realization.seat.ratio,
          )}
          sub={
            realization.composite.available ? realization.composite.detail : realization.seat.detail
          }
          caveat={realization.seat.caveat}
        />
      </div>

      {spend.skuCountUnpriced > 0 && (
        <div class="note warn">
          <strong>
            {spend.anyPriced
              ? `${spend.skuCountUnpriced} SKU${spend.skuCountUnpriced === 1 ? '' : 's'} contribute seats but no cost`
              : 'No spend figures in this report'}
          </strong>
          {spend.anyPriced
            ? 'Their seats are counted but their price is unknown, so the totals above are a floor rather than a complete picture. Give each one a price and every figure recalculates.'
            : 'Not one subscribed SKU matched an entry in the price table, so every monetary figure reads “not available” rather than zero. Give these a price and the report becomes a spend analysis.'}
          <ul class="priceable">
            {spend.unpricedSkus.map((s) => (
              <li key={s.skuPartNumber}>
                <code>{s.skuPartNumber}</code>
                <span class="priceable-seats">{count(s.consumedUnits)} assigned seats</span>
                {onPriceChange && (
                  <PriceCell
                    partNumber={s.skuPartNumber}
                    price={null}
                    overridden={false}
                    currency={cur}
                    onChange={onPriceChange}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {realization.composite.available ? (
        <div class="note">
          <strong>How {realization.composite.label.toLowerCase()} is derived</strong>
          The share of licence commitment sitting on assigned seats, multiplied by the share of the
          security posture Microsoft scores for this tenant that is actually in place. Buying a
          licence, assigning it, and switching on what it carries are three separate things, and
          this figure only counts spend that survived all three.
        </div>
      ) : (
        <div class="note">
          <strong>{realization.composite.label} is not available for this tenant</strong>
          {realization.feature.detail} It shows as not measured rather than assumed complete, because
          reporting a seat-only figure as &ldquo;spend realized&rdquo; would overstate this
          tenant&rsquo;s position.
        </div>
      )}
    </>
  );
}

/* ── Executive ────────────────────────────────────────────────────────── */

export function ExecutiveView({ model, onPriceChange }: ViewProps): JSX.Element {
  const { spend } = model;

  return (
    <>
      <p class="lede-line">
        {spend.skuCountPriced} of {spend.skuCountBillable} billable SKUs carry a price
        {spend.skuCountExcluded > 0 && <>, and {spend.skuCountExcluded} free or self-service SKUs are excluded</>}
        . {spend.complete ? 'The dollar totals are complete.' : 'The dollar totals are therefore a floor.'}
      </p>

      <div class="panel">
        <h3>Licence inventory</h3>
        <InventoryTable model={model} onPriceChange={onPriceChange} />
      </div>

      <div class={spend.pricingVerified ? 'note' : 'note warn'}>
        <strong>Pricing basis: {spend.basisLabel}</strong>
        {spend.pricingWarning ??
          'Microsoft Graph does not expose contract pricing; every dollar figure comes from the price table supplied to this tool.'}
      </div>

      <div class="note">
        <strong>Still to come</strong>
        <ul>
          <li>Dollarized risk reduction for the highest-impact undeployed control</li>
          <li>A remediation roadmap ranking those gaps by value against effort</li>
          <li>
            Dollar attribution for more of the scored controls, which needs verified SKU-to-service-plan
            entitlement
          </li>
          <li>Over-provisioning, which needs per-user service-plan usage rather than seat counts</li>
        </ul>
      </div>
    </>
  );
}

/* ── Wasted spend ─────────────────────────────────────────────────────── */

export function WasteView({ model }: ViewProps): JSX.Element {
  const { seatWaste, spend } = model;
  const cur = spend.currency;
  const measured = seatWaste.categories.filter((c) => c.available);

  return (
    <>
      <p class="lede-line">
        {seatWaste.totalAnnualCost === null ? (
          <>
            {measured.length} of the five waste categories could be measured, but the seats involved belong to
            SKUs with no price, so no figure can be produced. Price them and this becomes a number.
          </>
        ) : (
          <>
            <strong>
              {seatWaste.totalIsFloor ? `at least ${money(seatWaste.totalAnnualCost, cur)}` : money(seatWaste.totalAnnualCost, cur)}
            </strong>{' '}
            a year is going to seats that are not earning it, across {measured.length} of the five categories.
          </>
        )}
        {seatWaste.incomplete && <> The rest are named below with what each would need.</>}
      </p>

      <div class="panel">
        <h3>Seat-level waste</h3>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th class="num">Seats</th>
                <th class="num">Annual cost</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {seatWaste.categories.map((c) => (
                <tr key={c.id} class={c.available ? undefined : 'muted'}>
                  <td class="prod">{c.label}</td>
                  <td class="num">{c.seats === null ? '—' : count(c.seats)}</td>
                  <td class="num">
                    {c.annualCost === null
                      ? c.available
                        ? 'Not available'
                        : '—'
                      : c.costIsFloor
                        ? `at least ${money(c.annualCost, cur)}`
                        : money(c.annualCost, cur)}
                  </td>
                  <td>
                    {c.available ? (
                      <span class="pill ok">measured</span>
                    ) : (
                      <span class="pill attention" title={c.unavailableReason ?? undefined}>
                        not measured
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total · measured categories</td>
                <td class="num">{seatWaste.totalSeats === null ? '—' : count(seatWaste.totalSeats)}</td>
                <td class="num">
                  {seatWaste.totalAnnualCost === null
                    ? 'Not available'
                    : seatWaste.totalIsFloor
                      ? `at least ${money(seatWaste.totalAnnualCost, cur)}`
                      : money(seatWaste.totalAnnualCost, cur)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {seatWaste.totalIsFloor && !seatWaste.incomplete && (
          <div class="note warn">
            <strong>This total is a floor</strong>
            Some of the seats counted above belong to SKUs with no price, so their cost is missing from the
            figure. Give those SKUs a price and the total becomes complete.
          </div>
        )}

        {seatWaste.incomplete && (
          <div class="note warn">
            <strong>This total is a floor</strong>
            <ul>
              {seatWaste.categories
                .filter((c) => !c.available)
                .map((c) => (
                  <li key={c.id}>
                    <strong style="display:inline">{c.label}</strong> — {c.unavailableReason}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {seatWaste.exemptedAccounts > 0 && (
          <p class="basis-note">
            {count(seatWaste.exemptedAccounts)} account
            {seatWaste.exemptedAccounts === 1 ? ' was' : 's were'} exempted by configuration — service accounts,
            shared mailboxes and room resources hold licences legitimately and rarely sign in. Counting them as
            waste produces a report the customer disputes on the first line.
          </p>
        )}
      </div>

      {measured
        .filter((c) => c.accounts.length > 0)
        .map((c) => (
          <div class="panel" key={c.id}>
            <h3>
              {c.label} — {count(c.accounts.length)} account{c.accounts.length === 1 ? '' : 's'}
            </h3>
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Licences</th>
                    <th>Why</th>
                    <th class="num">Annual cost</th>
                  </tr>
                </thead>
                <tbody>
                  {c.accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span class="prod redactable">{a.displayName ?? a.id}</span>
                        <br />
                        <code class="sku redactable">{a.userPrincipalName ?? ''}</code>
                      </td>
                      <td>
                        {a.skuPartNumbers.map((p) => (
                          <code class="sku" key={p}>
                            {p}{' '}
                          </code>
                        ))}
                      </td>
                      <td>{a.detail}</td>
                      <td class="num">{money(a.annualCost, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {model.features.available ? (
        <div class="note">
          <strong>This page counts seats, not capabilities</strong>
          A seat can be assigned to an active person and still pay for security features nobody switched on.
          That second kind of waste is measured separately, on the Security features page.
        </div>
      ) : (
        <div class="note">
          <strong>Feature-level idle spend is not measured</strong>
          {model.features.unavailableReason ??
            'The dollar value of security capabilities that are entitled but switched off requires Secure Score control evidence to establish what is actually deployed.'}{' '}
          No figure is shown rather than a zero.
        </div>
      )}
    </>
  );
}


/* ── Security features ────────────────────────────────────────────────── */

const STATE_PILL: Record<string, { cls: string; label: string }> = {
  deployed: { cls: 'pill ok', label: 'deployed' },
  partial: { cls: 'pill attention', label: 'partial' },
  notDeployed: { cls: 'pill crit', label: 'not deployed' },
  unknown: { cls: 'pill', label: 'unknown' },
};

type StateFilter = 'all' | 'notDeployed' | 'partial' | 'deployed';

/** Graph returns the string "Unknown" rather than omitting the field. Not worth a column inch. */
const known = (v: string | null): string | null => (v && v !== 'Unknown' ? v : null);

export function FeaturesView({ model }: ViewProps): JSX.Element {
  const { features, spend } = model;
  const cur = spend.currency;
  const peers = features.comparative;

  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [withSpendOnly, setWithSpendOnly] = useState(false);
  const [service, setService] = useState('all');
  const [query, setQuery] = useState('');

  const services = [...new Set(features.rows.map((r) => r.service))].sort();

  const shown = features.rows.filter((r) => {
    if (stateFilter !== 'all' && r.state !== stateFilter) return false;
    if (withSpendOnly && !(r.unlockableSpend && r.unlockableSpend > 0)) return false;
    if (service !== 'all' && r.service !== service) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!r.displayName.toLowerCase().includes(q) && !r.controlName.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const filtered = shown.length !== features.rows.length;

  return (
    <>
      <p class="lede-line">
        {features.available && features.unlockableSpend !== null ? (
          <>
            <strong>{money(features.unlockableSpend, cur)}</strong> a year in security licensing is not fully earned, because
            capabilities those licences pay for are not switched on.
          </>
        ) : features.available ? (
          <>
            {features.rows.filter((r) => r.state !== 'deployed').length} of {features.rows.length} security
            controls Microsoft scores for this tenant are not fully in place. No SKU could be priced, so what
            that is worth cannot be established.
          </>
        ) : (
          <>{features.unavailableReason}</>
        )}
      </p>

      {features.available && (
        <div class="tiles">
          <Tile
            label="Secure Score"
            value={
              features.currentScore === null
                ? 'n/a'
                : `${Math.round(features.currentScore)} / ${Math.round(features.maxScore ?? 0)}`
            }
            sub={features.scorePercent === null ? '' : `${percent(features.scorePercent)} of the maximum`}
          />
          {peers.slice(0, 2).map((p) => (
            <Tile
              key={p.basis}
              label={
                p.basis === 'TotalSeats'
                  ? 'Peers of similar size'
                  : p.basis === 'IndustryTypes'
                    ? 'Peers in your industry'
                    : 'All tenants'
              }
              value={Math.round(p.averageScore).toString()}
              // Deliberately not "you are N points ahead". Graph returns the peer average
              // in raw points but never the maximum it was scored against.
              sub="Average points. Microsoft does not publish the maximum this was scored against."
            />
          ))}
          <Tile
            label="Feature realization"
            value={percent(features.featureRealization)}
            // Explains the number above it. An earlier version put a control count here
            // ("165 of 460"), which reads as 36% directly beneath a tile showing 84% —
            // two different ratios stacked, inviting the reader to distrust both.
            sub={
              features.currentScore === null
                ? ''
                : `${count(Math.round(features.currentScore))} of ${count(Math.round(features.maxScore ?? 0))} Secure Score points earned`
            }
          />
        </div>
      )}

      {features.available && features.rows.length > 0 && (
        <div class="panel">
          <h3>Entitled versus deployed</h3>
          <p class="panel-lede">
            Every control Microsoft scores for this tenant, most money on the table first. Spend reads as value
            already earned on a deployed control, and as value still to unlock on one that is not.
          </p>

          <div class="filters" role="group" aria-label="Filter controls">
            <div class="seg">
              {(
                [
                  ['all', 'All'],
                  ['notDeployed', 'Not deployed'],
                  ['partial', 'Partial'],
                  ['deployed', 'Deployed'],
                ] as [StateFilter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={stateFilter === id}
                  class={stateFilter === id ? 'on' : ''}
                  onClick={() => setStateFilter(id)}
                >
                  {label}
                  <em>{id === 'all' ? features.rows.length : features.rows.filter((r) => r.state === id).length}</em>
                </button>
              ))}
            </div>

            <label class="check">
              <input
                type="checkbox"
                checked={withSpendOnly}
                onChange={(e) => setWithSpendOnly((e.target as HTMLInputElement).checked)}
              />
              Only with spend to unlock
            </label>

            <select
              aria-label="Filter by service"
              value={service}
              onChange={(e) => setService((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All services</option>
              {services.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <input
              type="search"
              placeholder="Search capability or control"
              aria-label="Search capability or control"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />

            {filtered && (
              <button class="clear" onClick={() => { setStateFilter('all'); setWithSpendOnly(false); setService('all'); setQuery(''); }}>
                Clear
              </button>
            )}
          </div>

          <div class="tw tw--tall tw--fixed">
            <table>
              <colgroup>
                <col style="width: 30%" />
                <col style="width: 16%" />
                <col style="width: 17%" />
                <col style="width: 11%" />
                <col style="width: 8%" />
                <col style="width: 8%" />
                <col style="width: 10%" />
              </colgroup>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Entitled by</th>
                  <th>Evidence</th>
                  <th>State</th>
                  <th>Effort</th>
                  <th>Impact</th>
                  <th class="num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.controlName}>
                    <td class="prod">
                      {r.displayName}
                      <span class="sub">{r.service}</span>
                      {/* Microsoft's own guidance, kept with the row it belongs to.
                          Collapsed, because it runs long. */}
                      {r.state !== 'deployed' && r.remediation && (
                        <details class="guidance-details">
                          <summary>How to close this</summary>
                          <div class="guidance">{plainText(r.remediation)}</div>
                          {r.actionUrl && (
                            <a
                              class="guidance-link"
                              href={r.actionUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Open the setting in Microsoft 365
                            </a>
                          )}
                        </details>
                      )}
                    </td>
                    <td>
                      {r.entitlementBasis === 'servicePlans' && (
                        // One licence, named as the product rather than the part number.
                        // A capability bundled into several suites is attributed to the
                        // dearest one held — that is the licence whose value is most at
                        // stake — and the others stay on the tooltip rather than crowding
                        // the column, because the overlap is worth knowing but not worth
                        // five lines of part numbers.
                        <span
                          title={
                            r.entitledBy.length > 1
                              ? `Also entitled by: ${r.entitledBy.filter((s) => s !== r.costSku).join(', ')}`
                              : r.costSku ?? undefined
                          }
                        >
                          {r.costSkuName ?? r.entitledBy[0]}
                          {r.entitledBy.length > 1 && (
                            <span class="sub">and {r.entitledBy.length - 1} other licence{r.entitledBy.length > 2 ? 's' : ''}</span>
                          )}
                        </span>
                      )}
                      {r.entitlementBasis === 'noLicenceRequired' && (
                        <span class="soft" title="Included at no extra licence cost.">
                          No licence needed
                        </span>
                      )}
                      {r.entitlementBasis === 'notEntitled' && (
                        // Scored, but the tenant owns nothing that unlocks it. Worth its
                        // own state: it is the opposite of idle spend — a gap that costs
                        // money to close rather than one already paid for.
                        <span
                          class="pill attention"
                          title={`Microsoft scores this control but the tenant owns none of the licences that unlock it: ${r.requiredPlans.join(', ')}`}
                        >
                          not licensed
                        </span>
                      )}
                      {r.entitlementBasis === 'unmapped' && (
                        <span
                          class="soft"
                          title="No verified licence mapping for this control yet. Shown as unknown rather than guessed."
                        >
                          Not yet mapped
                        </span>
                      )}
                    </td>
                    <td>
                      {/* The score is the evidence; the control id is the citation that
                          makes it checkable. Leading with the id put Microsoft's internal
                          names — scid_6002, AATP_PrivilegedAccounts — where the reader
                          looks first, and they read as corrupt data rather than as a
                          reference. Kept, because a claim nobody can trace back to Graph
                          is worse than an ugly one, but demoted to the second line. */}
                      {Math.round(r.score)} of {Math.round(r.maxScore)} points
                      <span class="sub">
                        <code class="sku">{r.controlName}</code>
                      </span>
                    </td>
                    <td>
                      <span
                        class={
                          r.state === 'deployed'
                            ? 'pill ok'
                            : r.state === 'partial'
                              ? 'pill attention'
                              : 'pill crit'
                        }
                      >
                        {r.state === 'notDeployed' ? 'not deployed' : r.state}
                      </span>
                    </td>
                    <td>{known(r.implementationCost) ?? <span class="soft">&mdash;</span>}</td>
                    <td>{known(r.userImpact) ?? <span class="soft">&mdash;</span>}</td>
                    <td class="num">
                      {r.baseline ? (
                        <span class="soft" title="Costs nothing to close.">
                          free to fix
                        </span>
                      ) : r.attributedSpend === null ? (
                        <>&mdash;</>
                      ) : (
                        <>
                          {money(r.attributedSpend, cur)}
                          <span class="sub">
                            {r.costBasis === 'listPrice'
                              ? 'to buy'
                              : r.costBasis === 'unassigned'
                                ? 'unassigned'
                                : r.state === 'deployed'
                                  ? 'earned'
                                  : 'at risk'}
                            {r.costSkuName && ` · ${r.costSkuName}`}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} class="empty">
                      No control matches these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filtered && (
            <p class="panel-lede">
              Showing {count(shown.length)} of {count(features.rows.length)} controls.
            </p>
          )}

          {features.licences.length > 0 && (
            // The additive view. Each control above carries the WHOLE cost of the licence
            // that enables it, so that column must never be summed — nine controls needing
            // Exchange Online Plan 1 would multiply one licence by nine. Here each licence
            // is counted once, and asked whether what it enables is switched on.
            <div class="panel panel--inset">
              <h3>What each licence is earning</h3>
              <p class="panel-lede">
                The Spend column above is per control and is deliberately not additive: several controls can
                depend on the same licence. This counts each licence once.
              </p>
              <div class="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Licence</th>
                      <th class="num">Annual cost</th>
                      <th class="num">Controls it enables</th>
                      <th class="num">Deployed</th>
                      <th class="num">At risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {features.licences.map((l) => (
                      <tr key={l.skuPartNumber}>
                        <td class="prod">
                          {l.displayName}
                          <span class="sub">
                            <code class="sku">{l.skuPartNumber}</code>
                          </span>
                          {l.basis === 'listPrice' && <span class="sub">not owned &mdash; list price</span>}
                          {l.basis === 'unassigned' && (
                            <span class="sub">bought, assigned to nobody &mdash; annual commitment</span>
                          )}
                        </td>
                        <td class="num">{money(l.annualCost, cur)}</td>
                        <td class="num">{l.controls}</td>
                        <td class="num">
                          {l.deployed} <span class="sub">{percent(l.deployed / l.controls)}</span>
                        </td>
                        <td class="num">
                          {money(l.annualCost * (1 - l.deployed / l.controls), cur)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {features.attributedSpend !== null && (
                <div class="totals-split">
                  <div>
                    <span>Committed to security licences</span>
                    <strong>{money(features.attributedSpend, cur)}</strong>
                  </div>
                  <div>
                    <span>Earned</span>
                    <strong>{money(features.realizedSpend, cur)}</strong>
                  </div>
                  <div>
                    <span>At risk</span>
                    <strong class="idle">{money(features.unlockableSpend, cur)}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          <div class="note">
            <strong>How a control gets a price</strong>
            Each control is matched to the service plans that unlock it &mdash; researched against
            Microsoft&rsquo;s licensing documentation, control by control &mdash; and then to the cheapest SKU
            you own carrying one of them. The control carries that licence&rsquo;s <em>whole</em> annual cost,
            not a share of it, because that is what the question asks: mailbox auditing is off, and Exchange
            Online Plan 1 is what you pay to have it. Where no owned SKU qualifies, the figure is list price
            for the seats you assign, marked <em>to buy</em> &mdash; money you would have to spend, not money
            already committed.
            {features.realizedSpend !== null && features.attributedSpend! > 0 && (
              <>
                {' '}
                Because several controls can depend on one licence, the per-control column must not be summed;
                the table above it counts each licence once, and treats a licence as earned in proportion to
                how many of the controls it enables are actually in place.
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Roadmap ─────────────────────────────────────────────────────────── */

export function RoadmapView({ model }: ViewProps): JSX.Element {
  const { risk, roadmap, spend } = model;
  const cur = spend.currency;
  const [showAll, setShowAll] = useState(false);

  if (!model.features.available) {
    return (
      <PendingView
        title="The remediation roadmap"
        why="A sequence of the gaps worth closing, ranked by the risk each one retires against the effort to close it."
        needs={model.features.unavailableReason ?? 'Secure Score control evidence'}
      />
    );
  }

  const steps = showAll ? roadmap : roadmap.slice(0, 15);

  return (
    <>
      <p class="lede-line">
        {risk.available ? (
          <>
            <strong>{money(risk.retainedAnnual, cur)}</strong> a year in expected loss is still on the table,
            against <strong>{money(risk.avoidedAnnual, cur)}</strong> the deployed controls already avoid.
          </>
        ) : (
          <>{risk.unavailableReason}</>
        )}
      </p>

      {risk.available && (
        <div class="tiles">
          <Tile
            label="Expected loss, annual"
            value={money(risk.expectedLossAnnual, cur)}
            sub="Before credit for anything deployed"
          />
          <Tile
            label="Avoided by what is deployed"
            value={money(risk.avoidedAnnual, cur)}
            sub={`${percent(risk.expectedLossAnnual > 0 ? risk.avoidedAnnual / risk.expectedLossAnnual : null)} of expected loss`}
          />
          <Tile
            label="Still retained"
            value={money(risk.retainedAnnual, cur)}
            sub="What finishing deployment would retire"
            idle
          />
          <Tile
            label="Steps to work through"
            value={roadmap.length.toString()}
            sub={`${roadmap.filter((s) => (s.implementationCost ?? '').toLowerCase() === 'low').length} of them low effort`}
          />
        </div>
      )}

      {risk.available && (
        <div class="panel">
          <h3>Where the remaining risk sits</h3>
          <p class="panel-lede">
            Expected loss per threat, reduced in proportion to how much of the Secure Score weight
            mitigating it is actually earned. Most left on the table first.
          </p>
          <div class="tw">
            <table>
              <thead>
                <tr>
                  <th>Threat</th>
                  <th class="num">Likelihood</th>
                  <th class="num">Impact</th>
                  <th class="num">Expected loss</th>
                  <th class="num">Covered</th>
                  <th class="num">Retained</th>
                </tr>
              </thead>
              <tbody>
                {risk.threats.map((t) => (
                  <tr key={t.threat}>
                    <td class="prod">
                      {t.displayName}
                      <span class="sub">
                        {t.controls} control{t.controls === 1 ? '' : 's'} · {Math.round(t.score)} of{' '}
                        {Math.round(t.maxScore)} points
                      </span>
                    </td>
                    <td class="num">{percent(t.annualLikelihood)}</td>
                    <td class="num">{money(t.impactUsd, cur)}</td>
                    <td class="num">{money(t.expectedLoss, cur)}</td>
                    <td class="num">{percent(t.coverage)}</td>
                    <td class="num idle">{money(t.retained, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div class="panel">
        <h3>The order to work in</h3>
        <p class="panel-lede">
          Ranked by what each step is worth — expected loss retired plus licence spend it starts earning —
          against the effort Microsoft rates it at. The ranking is the output; the ratio itself is not a
          figure to quote.
        </p>
        <div class="tw tw--fixed">
          <colgroup>
            <col style="width: 5%" />
            <col style="width: 33%" />
            <col style="width: 15%" />
            <col style="width: 15%" />
            <col style="width: 10%" />
            <col style="width: 11%" />
            <col style="width: 11%" />
          </colgroup>
          <table>
            <thead>
              <tr>
                <th class="num">#</th>
                <th>Step</th>
                <th class="num">Risk retired</th>
                <th class="num">Spend unlocked</th>
                <th class="num">Points</th>
                <th>Effort</th>
                <th>User impact</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={s.controlName}>
                  <td class="num">{i + 1}</td>
                  <td class="prod">
                    {s.displayName}
                    <span class="sub">
                      {s.service}
                      {s.costSkuName && ` · ${s.costSkuName}`}
                    </span>
                    {s.remediation && (
                      <details class="guidance-details">
                        <summary>How to close this</summary>
                        <div class="guidance">{plainText(s.remediation)}</div>
                        {s.actionUrl && (
                          <a
                            class="guidance-link"
                            href={s.actionUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Open the setting in Microsoft 365
                          </a>
                        )}
                      </details>
                    )}
                  </td>
                  <td class="num">{risk.available ? money(s.riskRetired, cur) : <>&mdash;</>}</td>
                  <td class="num">{s.spendUnlocked === null ? <>&mdash;</> : money(s.spendUnlocked, cur)}</td>
                  <td class="num">{Math.round(s.pointsGained)}</td>
                  <td>{s.implementationCost ?? <span class="soft">&mdash;</span>}</td>
                  <td>{s.userImpact ?? <span class="soft">&mdash;</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {roadmap.length > 15 && (
          <button class="btn" onClick={() => setShowAll(!showAll)} style="margin-top: 0.9rem">
            {showAll ? 'Show the first 15' : `Show all ${roadmap.length} steps`}
          </button>
        )}

        <div class="note">
          <strong>Both numbers behind this ranking are assumptions</strong>
          Likelihood and impact per threat are engagement inputs, not measurements — they are the two
          figures a customer will argue with, so they sit in one editable file and every number derived
          from them says so. Microsoft supplies the threat tags, the Secure Score weighting, and the
          effort ratings; what this tool adds is the arithmetic joining them.
          {risk.controlsWithoutThreatTag > 0 && (
            <>
              {' '}
              {risk.controlsWithoutThreatTag} scored control
              {risk.controlsWithoutThreatTag === 1 ? '' : 's'} carry no threat tag from Microsoft, so
              {risk.controlsWithoutThreatTag === 1 ? ' it contributes' : ' they contribute'} no risk figure
              — which is different from contributing none.
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Pending views ────────────────────────────────────────────────────── */

export function PendingView({
  title,
  needs,
  why,
}: {
  title: string;
  needs: string;
  why: string;
}): JSX.Element {
  return (
    <div class="pending">
      {/* "not built" rather than "not collected": nothing is missing from the tenant. */}
      <h3>{title} is not built yet</h3>
      <p>{why}</p>
      <p class="pending-needs">
        <strong>Needs:</strong> {needs}
      </p>
    </div>
  );
}

/* ── Not measured ─────────────────────────────────────────────────────── */

export function NotMeasuredView({ model }: ViewProps): JSX.Element {
  const { spend, provenance } = model;

  const { seatWaste, features } = model;

  // Derived from what this run actually produced, never a fixed list. This tab is the
  // report's integrity claim — "we never show $0 where the truth is we could not look" —
  // and a tab that claims gaps which do not exist discredits the very thing it is here
  // to establish, as surely as a silent zero would.
  const gaps: { what: string; why: string; fix: string }[] = [];

  if (!features.available) {
    gaps.push({
      what: 'Deployed vs. entitled security features',
      why: features.unavailableReason ?? 'Secure Score control evidence was not collected.',
      fix: 'SecurityEvents.Read.All',
    });
    gaps.push({
      what: 'Secure Score, benchmark and trend',
      why: features.unavailableReason ?? 'Not collected.',
      fix: 'SecurityEvents.Read.All',
    });
  }

  // Controls no verified licence research covers yet. Distinct from "needs no licence":
  // one is a finding, the other is an admission, and collapsing them would let a gap in
  // our own research read as a fact about the tenant.
  const unmapped = features.rows.filter((r) => r.entitlementBasis === 'unmapped');
  if (unmapped.length > 0) {
    gaps.push({
      what: `Which licence unlocks ${unmapped.length} of ${features.rows.length} scored controls`,
      why:
        'Microsoft Graph returns no licensing information on a Secure Score control and publishes no ' +
        'machine-readable control-to-SKU mapping, so each one has to be researched against the licensing ' +
        'documentation. These are not yet covered, so they carry no dollar figure rather than a guessed one.',
      fix: 'Extend controlEntitlements in feature-map.json',
    });
  }

  // Scored by Microsoft, unlocked by nothing the tenant owns. Not idle spend — the
  // opposite: a gap that would cost money to close.
  const notEntitled = features.rows.filter((r) => r.entitlementBasis === 'notEntitled');
  if (notEntitled.length > 0) {
    gaps.push({
      what: `${notEntitled.length} scored control${notEntitled.length === 1 ? '' : 's'} the tenant is not licensed for`,
      why: `Microsoft scores ${notEntitled.length === 1 ? 'it' : 'them'} against this tenant, but no owned SKU carries the service plan that unlocks ${notEntitled.length === 1 ? 'it' : 'them'} — for example ${notEntitled[0]!.displayName}, which needs ${notEntitled[0]!.requiredPlans.join(' or ') || 'a licence not identified'}. Closing these costs new licence spend rather than releasing spend already committed, so they carry no idle figure.`,
      fix: 'Purchase, or accept the gap deliberately',
    });
  }

  // Baseline controls take no share of the security budget, which is right, but it does
  // mean the allocated total is smaller than the whole security budget.
  const baselineCount = features.rows.filter((r) => r.baseline).length;
  if (baselineCount > 0) {
    gaps.push({
      what: `Spend attributed to ${baselineCount} baseline control${baselineCount === 1 ? '' : 's'}`,
      why:
        'These need no paid licence, so no licence spend is allocated to them. They still appear in the ' +
        'table with their state — the report simply does not claim a SKU bought them.',
      fix: 'Nothing: this is deliberate',
    });
  }

  // Covers the sign-in-activity cases too: without it, the never-signed-in and inactive
  // categories are themselves unavailable and carry the reason.
  for (const c of seatWaste.categories.filter((c) => !c.available)) {
    gaps.push({
      what: c.label,
      why: c.unavailableReason ?? 'Could not be measured.',
      fix: /Entra ID P1|AuditLog/i.test(c.unavailableReason ?? '')
        ? 'Entra ID P1, plus AuditLog.Read.All'
        : 'Not available through a read-only API',
    });
  }

  if (spend.skuCountUnpriced > 0) {
    gaps.unshift({
      what: `Cost of ${spend.skuCountUnpriced} unpriced SKU${spend.skuCountUnpriced === 1 ? '' : 's'}`,
      why: `${spend.unpricedSkus.map((s) => s.skuPartNumber).join(', ')} — no entry in the price table.`,
      fix: 'Add a price for each',
    });
  }

  return (
    <>
      <p class="lede-line">
        A report for a CFO must never show <strong>$0</strong> where the truth is &ldquo;we could not look.&rdquo;
        Everything this run could not establish is listed here rather than silently zeroed.
      </p>

      <div class="panel">
        <h3>Gaps in this report</h3>
        {gaps.length === 0 ? (
          <div class="note">
            <strong>Nothing was withheld from this run</strong>
            Every collector returned, and every figure in this report rests on data actually read from the
            tenant. The allocation model behind the feature-level dollar figures remains an assumption rather
            than a measurement — the Security features view says so where those numbers appear.
          </div>
        ) : (
          <div class="tw">
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>Why not</th>
                  <th>What would fix it</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.what}>
                    <td class="prod">{g.what}</td>
                    <td>{g.why}</td>
                    <td>{g.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {provenance.collectors.some((c) => !c.available || c.degraded) && (
        <div class="note warn">
          <strong>Collection was incomplete</strong>
          <ul>
            {provenance.collectors
              .filter((c) => !c.available || c.degraded)
              .map((c) => (
                <li key={c.name}>
                  <code>{c.name}</code> — {c.reason}
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ── Evidence ─────────────────────────────────────────────────────────── */

export function EvidenceView({ model }: ViewProps): JSX.Element {
  const { provenance, tenant } = model;

  return (
    <>
      <p class="lede-line">Where every figure came from, and what the session was permitted to read.</p>

      <div class="panel">
        <h3>Collection</h3>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Collector</th>
                <th>State</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {provenance.collectors.map((c) => (
                <tr key={c.name}>
                  <td>
                    <code class="sku">{c.name}</code>
                  </td>
                  <td>
                    {!c.available ? (
                      <span class="pill attention">unavailable</span>
                    ) : c.degraded ? (
                      <span class="pill attention">degraded</span>
                    ) : (
                      <span class="pill ok">complete</span>
                    )}
                  </td>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {provenance.extraScopes.length > 0 && (
        <div class="note warn">
          <strong>
            The signed-in session carried {provenance.extraScopes.length} permission
            {provenance.extraScopes.length === 1 ? '' : 's'} beyond what this tool requests
          </strong>
          Microsoft Graph reuses whatever cached token is available, so a session created for other work can carry
          more permission than this report needs.
          {provenance.extraWriteScopes.length > 0 && (
            <>
              {' '}
              <strong style="display:inline">
                {provenance.extraWriteScopes.length} of them grant write access.
              </strong>{' '}
              This tool never uses them — every call it makes is a GET — but the session presented to Graph was
              broader than least privilege.
            </>
          )}
          <ul>
            {provenance.extraScopes.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="panel">
        <h3>Tenant</h3>
        <dl class="defs">
          <dt>Tenant ID</dt>
          <dd>
            <code class="sku redactable">{tenant.TenantId}</code>
          </dd>
          <dt>Default domain</dt>
          <dd class="redactable">{tenant.DefaultDomain ?? 'n/a'}</dd>
          <dt>Snapshot collected</dt>
          <dd>{provenance.snapshotCollected}</dd>
          <dt>Source</dt>
          <dd>{provenance.source}</dd>
        </dl>
      </div>

      <div class="panel">
        <h3>Full inventory</h3>
        <InventoryTable model={model} />
      </div>
    </>
  );
}
