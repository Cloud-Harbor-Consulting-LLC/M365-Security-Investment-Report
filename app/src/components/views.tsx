import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { count, money, percent } from '@/format';
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
        <Tile
          label={realization.seat.label}
          value={percent(realization.seat.ratio)}
          sub={realization.seat.detail}
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

      <div class="note">
        <strong>{realization.composite.label} is not in this build</strong>
        {realization.feature.detail} It shows as not measured rather than assumed complete, because reporting a
        seat-only figure as &ldquo;spend realized&rdquo; would overstate this tenant&rsquo;s position.
      </div>
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
          <li>Entitled-but-unconfigured security features, and what they cost</li>
          <li>The remaining four seat-waste categories</li>
          <li>Secure Score, peer benchmark and 90-day trend</li>
          <li>Dollarized risk reduction for the highest-impact undeployed control</li>
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
        {seatWaste.totalAnnualCost !== null ? (
          <>
            <strong>{money(seatWaste.totalAnnualCost, cur)}</strong> a year is going to seats that are not
            earning it, across {measured.length} of the five categories.
          </>
        ) : (
          <>
            {measured.length} of the five waste categories could be measured, but none of the seats involved
            carry a price, so no figure can be produced.
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
                  <td class="num">{c.annualCost === null ? (c.available ? 'n/a' : '—') : money(c.annualCost, cur)}</td>
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
                <td class="num">{money(seatWaste.totalAnnualCost, cur)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

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

      <div class="note">
        <strong>Feature-level idle spend is not measured yet</strong>
        The dollar value of security capabilities that are entitled but switched off requires Secure Score control
        evidence to establish what is actually deployed. Until that is collected, no figure is shown rather than a
        zero.
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
      <h3>{title} is not collected yet</h3>
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

  const gaps = [
    {
      what: 'Sign-in activity',
      why: 'Requires Entra ID P1. Without it Graph returns 403 for the entire user query, not just the sign-in field.',
      fix: 'Entra ID P1, plus AuditLog.Read.All',
    },
    {
      what: 'Never-signed-in and inactive seats',
      why: 'Both derive from sign-in activity above.',
      fix: 'As above',
    },
    {
      what: 'Deployed vs. entitled security features',
      why: 'Requires Secure Score control evidence, which is not collected yet.',
      fix: 'SecurityEvents.Read.All',
    },
    {
      what: 'Secure Score, benchmark and trend',
      why: 'Not collected yet.',
      fix: 'SecurityEvents.Read.All',
    },
    {
      what: 'Over-provisioning',
      why: 'Requires per-user service-plan usage rather than seat counts.',
      fix: 'User collection',
    },
  ];

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
