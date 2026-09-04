import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { count, money, percent } from '@/format';
import { Tile } from './Tile';
import { InventoryTable } from './InventoryTable';

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
}

/* ── Board ────────────────────────────────────────────────────────────── */

export function BoardView({ model }: ViewProps): JSX.Element {
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

      <div class="note">
        <strong>{realization.composite.label} is not in this build</strong>
        {realization.feature.detail} It shows as not measured rather than assumed complete, because reporting a
        seat-only figure as &ldquo;spend realized&rdquo; would overstate this tenant&rsquo;s position.
      </div>
    </>
  );
}

/* ── Executive ────────────────────────────────────────────────────────── */

export function ExecutiveView({ model }: ViewProps): JSX.Element {
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
        <InventoryTable model={model} />
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
  const { spend } = model;
  const cur = spend.currency;

  const categories = [
    {
      name: 'Unassigned purchased seats',
      seats: count(spend.seatsUnassigned),
      cost: spend.anyPriced ? money(spend.unassignedSeatCost, cur) : 'Not available',
      state: <span class="pill ok">measured</span>,
    },
    { name: 'Disabled but licensed', seats: '—', cost: 'n/a', state: <span class="pill">needs user collection</span> },
    { name: 'Never signed in', seats: '—', cost: 'n/a', state: <span class="pill attention">needs Entra ID P1</span> },
    { name: 'Inactive beyond threshold', seats: '—', cost: 'n/a', state: <span class="pill attention">needs Entra ID P1</span> },
    { name: 'Over-provisioned (E5 where E3 suffices)', seats: '—', cost: 'n/a', state: <span class="pill">needs service-plan usage</span> },
  ];

  return (
    <>
      <p class="lede-line">
        One of the five seat-waste categories is measurable from what has been collected so far. The other four
        are named here with what each needs, rather than omitted.
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
              {categories.map((c) => (
                <tr key={c.name}>
                  <td class="prod">{c.name}</td>
                  <td class="num">{c.seats}</td>
                  <td class="num">{c.cost}</td>
                  <td>{c.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
