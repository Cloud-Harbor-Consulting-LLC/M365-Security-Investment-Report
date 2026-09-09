import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { count, money, percent, shortDate } from '@/format';

interface Props {
  model: ReportModel;
  sourceLabel: string;
}

/**
 * The document that gets sent to a board.
 *
 * Not the dashboard with a print stylesheet over it. A board pack is a different genre:
 * it is read once, on paper or in a PDF viewer, by people who will not click anything and
 * cannot ask a follow-up question in the moment. So every figure that carries a
 * qualification on screen carries it here in words, on the page, next to the number —
 * there is no popover to open and no tooltip to hover.
 *
 * Six pages, in the order a sceptical CFO asks the questions:
 *
 *   1. What is the finding?
 *   2. What are we spending, and how much of it is working?
 *   3. What is being wasted?
 *   4. What have we paid for and not switched on?
 *   5. What should we do first?
 *   6. How were these numbers made, and what is assumed?
 *
 * Page six is not an appendix. It is the page that decides whether the other five are
 * believed, and it is why this pack states plainly which figures are measured, which the
 * consultant supplied, and which rest on assumptions the reader is entitled to reject.
 */
export function BoardPack({ model, sourceLabel }: Props): JSX.Element {
  const { spend, realization, seatWaste, features, risk, roadmap, tenant, config } = model;
  const cur = spend.currency;
  const r = realization.composite.available ? realization.composite : realization.seat;

  const prepared = config.report?.preparedBy ?? null;
  const measuredWaste = seatWaste.categories.filter((c) => c.available);
  const unmeasuredWaste = seatWaste.categories.filter((c) => !c.available);
  const steps = roadmap.slice(0, 8);
  const incompleteCollectors = model.provenance.collectors.filter((c) => !c.available || c.degraded);

  // The additive view. The per-control column never sums, because several controls can
  // depend on one licence — putting it in a board pack would invent money.
  const rollup = [...features.licences].sort((a, b) => b.annualCost - a.annualCost).slice(0, 10);

  return (
    <div class="pack" aria-hidden="true">
      {/* ---------------------------------------------------------------- 1. Cover */}
      <section class="pack-page pack-cover">
        <div class="pack-cover-top">
          <p class="pack-kicker">Microsoft 365 Security Investment Report</p>
          <h1>{tenant.DisplayName}</h1>
          <p class="pack-sub">
            {spend.anyPriced ? (
              <>
                {money(spend.annualCommitment, cur)} a year in licence commitment.{' '}
                {percent(r.ratio)} of it is working.
              </>
            ) : (
              <>
                {spend.skuCountTotal} subscribed licence SKUs, none of which could be priced.
              </>
            )}
          </p>
        </div>

        <div class="pack-cover-foot">
          <dl class="pack-facts">
            <div>
              <dt>Tenant</dt>
              <dd>{tenant.DisplayName}</dd>
            </div>
            <div>
              <dt>Collected</dt>
              <dd>{shortDate(model.provenance.snapshotCollected)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{sourceLabel}</dd>
            </div>
            {prepared && (
              <div>
                <dt>Prepared by</dt>
                <dd>{prepared}</dd>
              </div>
            )}
          </dl>
          <p class="pack-cover-note">
            Read-only. This report was produced without writing anything to the tenant. Every
            monetary figure is a floor, not a valuation &mdash; see <em>How these numbers were
            made</em> on the final page before quoting any of them.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------- 2. The position */}
      <section class="pack-page">
        <PackHead title="The position" tenant={tenant.DisplayName} />

        <p class="pack-lede">
          {spend.anyPriced ? (
            <>
              This tenant carries <strong>{money(spend.annualCommitment, cur)}</strong> a year in
              Microsoft 365 licence commitment. <strong>{money(spend.unassignedSeatCost, cur)}</strong>{' '}
              of that pays for seats nobody is using.
            </>
          ) : (
            <>
              None of this tenant&rsquo;s {spend.skuCountTotal} subscribed SKUs matched the price
              table, so every monetary figure in this pack reads <em>not available</em> rather than
              zero. Supply the negotiated rates and the pack becomes a spend analysis.
            </>
          )}
        </p>

        <div class="pack-tiles">
          <PackTile
            label="Annual commitment"
            value={spend.anyPriced ? money(spend.annualCommitment, cur) : 'Not available'}
            sub={`${count(spend.seatsPurchased)} purchased seats`}
            na={!spend.anyPriced}
          />
          <PackTile
            label="Spend in use"
            value={spend.anyPriced ? money(spend.annualSpendConsumed, cur) : 'Not available'}
            sub={`${count(spend.seatsConsumed)} assigned seats`}
            na={!spend.anyPriced}
          />
          <PackTile
            label="Idle seat spend"
            value={spend.anyPriced ? money(spend.unassignedSeatCost, cur) : 'Not available'}
            sub={`${count(spend.seatsUnassigned)} unassigned seats`}
            na={!spend.anyPriced}
          />
          <PackTile label={r.label} value={percent(r.ratio)} sub={r.detail} />
        </div>

        {r.caveat && <p class="pack-caveat">{r.caveat}</p>}

        <h3>What &ldquo;{r.label.toLowerCase()}&rdquo; means</h3>
        <p>
          Buying a licence, assigning it to someone, and switching on what it carries are three
          separate things. This figure only counts spend that survived all three. A tenant can be
          fully licensed, fully assigned, and still have most of its security capability switched
          off &mdash; which is the gap this report exists to find.
        </p>

        {spend.skuCountUnpriced > 0 && (
          <p class="pack-warn">
            <strong>
              {spend.skuCountUnpriced} SKU{spend.skuCountUnpriced === 1 ? '' : 's'} contribute seats
              but no price.
            </strong>{' '}
            Their seats are counted; their cost is not. Every total in this pack is therefore a
            floor rather than a complete picture.
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- 3. Wasted spend */}
      <section class="pack-page">
        <PackHead title="Wasted spend" tenant={tenant.DisplayName} />

        <p class="pack-lede">
          {seatWaste.totalAnnualCost === null ? (
            <>Waste could not be priced for this tenant.</>
          ) : (
            <>
              <strong>{money(seatWaste.totalAnnualCost, cur)}</strong> a year across{' '}
              {count(seatWaste.totalSeats ?? 0)} seats, in the categories that could be measured.
              {seatWaste.incomplete || seatWaste.totalIsFloor
                ? ' This is a floor: not every category could be measured or fully priced.'
                : ''}
            </>
          )}
        </p>

        <table class="pack-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" class="num">Seats</th>
              <th scope="col" class="num">Annual cost</th>
            </tr>
          </thead>
          <tbody>
            {measuredWaste.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.label}
                  {c.costIsFloor && (
                    <span class="pack-cell-note">
                      Some seats in this category have no price, so the figure is a floor.
                    </span>
                  )}
                </td>
                <td class="num">{c.seats === null ? '' : count(c.seats)}</td>
                <td class="num">{c.annualCost === null ? '' : money(c.annualCost, cur)}</td>
              </tr>
            ))}
          </tbody>
          {seatWaste.totalAnnualCost !== null && (
            <tfoot>
              <tr>
                <td>Total measured</td>
                <td class="num">{count(seatWaste.totalSeats ?? 0)}</td>
                <td class="num">{money(seatWaste.totalAnnualCost, cur)}</td>
              </tr>
            </tfoot>
          )}
        </table>

        {unmeasuredWaste.length > 0 && (
          <>
            <h3>Not measured, and why</h3>
            <p class="pack-note">
              These are reported as unmeasured rather than as zero. An empty figure is a known gap;
              a zero would be a claim about this tenant.
            </p>
            <dl class="pack-defs">
              {unmeasuredWaste.map((c) => (
                <div key={c.id}>
                  <dt>{c.label}</dt>
                  <dd>{c.unavailableReason}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {seatWaste.exemptedAccounts > 0 && (
          <p class="pack-note">
            {count(seatWaste.exemptedAccounts)} account
            {seatWaste.exemptedAccounts === 1 ? ' was' : 's were'} exempted as service accounts,
            shared mailboxes or room resources. An account holding a licence is never exempt.
          </p>
        )}
      </section>

      {/* --------------------------------------- 4. Paid for, not switched on */}
      <section class="pack-page">
        <PackHead title="Paid for, not switched on" tenant={tenant.DisplayName} />

        {features.available ? (
          <>
            <p class="pack-lede">
              {features.featureRealization !== null ? (
                <>
                  <strong>{percent(features.featureRealization)}</strong> of the security posture
                  Microsoft measures for this tenant is in place
                  {features.currentScore !== null && features.maxScore !== null && (
                    <> &mdash; {count(features.currentScore)} of {count(features.maxScore)} points</>
                  )}
                  .
                  {features.unlockableSpend !== null && (
                    <>
                      {' '}
                      <strong>{money(features.unlockableSpend, cur)}</strong> a year of licence
                      spend is attributable to capability that is not yet deployed.
                    </>
                  )}
                </>
              ) : (
                <>Secure Score was collected but no realization share could be derived.</>
              )}
            </p>

            <h3>By licence</h3>
            <p class="pack-note">
              Grouped by licence deliberately. A single licence can fund many controls, so the
              per-control costs shown in the interactive report <strong>do not sum</strong> &mdash;
              adding them would invent money that was never spent. This table is the additive view.
            </p>

            <table class="pack-table">
              <thead>
                <tr>
                  <th scope="col">Licence</th>
                  <th scope="col" class="num">Controls</th>
                  <th scope="col" class="num">Deployed</th>
                  <th scope="col" class="num">Annual cost</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((l) => (
                  <tr key={l.skuPartNumber}>
                    <td>
                      {l.displayName}
                      {l.basis === 'listPrice' && (
                        <span class="pack-cell-note">
                          Not owned. Costed at public list price for the tenant&rsquo;s assigned
                          seats.
                        </span>
                      )}
                      {l.basis === 'unassigned' && (
                        <span class="pack-cell-note">
                          Purchased but unassigned; costed at the annual commitment.
                        </span>
                      )}
                    </td>
                    <td class="num">{count(l.controls)}</td>
                    <td class="num">{count(l.deployed)}</td>
                    <td class="num">{money(l.annualCost, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!features.reconciles && (
              <p class="pack-warn">
                The controls in this table do not account for the whole of the tenant&rsquo;s
                Secure Score maximum, so this share and the headline Secure Score describe
                overlapping but different populations.
              </p>
            )}
          </>
        ) : (
          <p class="pack-lede">{features.unavailableReason}</p>
        )}
      </section>

      {/* ------------------------------------------------------ 5. What to do first */}
      <section class="pack-page">
        <PackHead title="What to do first" tenant={tenant.DisplayName} />

        {steps.length === 0 ? (
          <p class="pack-lede">
            No remediation steps could be sequenced, because the control evidence needed to rank
            them was not available.
          </p>
        ) : (
          <>
            <p class="pack-lede">
              Ordered by value against effort, not by severity. The first rows are the ones that
              return the most for the least work.
            </p>

            <table class="pack-table">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Service</th>
                  <th scope="col" class="num">Points</th>
                  <th scope="col" class="num">Spend it starts earning</th>
                  <th scope="col">Effort</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={s.controlName}>
                    <td>
                      <span class="pack-rank">{i + 1}</span>
                      {s.displayName}
                      {s.userImpact && <span class="pack-cell-note">User impact: {s.userImpact}</span>}
                    </td>
                    <td>{s.service}</td>
                    <td class="num">{count(s.pointsGained)}</td>
                    <td class="num">
                      {s.spendUnlocked === null ? '' : money(s.spendUnlocked, cur)}
                    </td>
                    <td>{s.implementationCost ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p class="pack-note">
              &ldquo;Spend it starts earning&rdquo; is licence money already committed that this
              step puts to work. It is not a saving and not new budget, and these figures must not
              be added together &mdash; several steps can depend on the same licence.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------- 6. How these numbers were made */}
      <section class="pack-page">
        <PackHead title="How these numbers were made" tenant={tenant.DisplayName} />

        <p class="pack-lede">
          Everything below is stated so the figures can be checked and, where you disagree,
          rejected. A report that hides its assumptions is not more persuasive, only less useful.
        </p>

        <h3>Measured</h3>
        <p>
          Licence counts, seat assignment, and Secure Score come directly from Microsoft Graph, read
          only, on {shortDate(model.provenance.snapshotCollected)}. These are the tenant&rsquo;s own
          figures, not estimates.
        </p>

        <h3>Supplied</h3>
        <p>
          Microsoft Graph does not expose contract pricing. Every dollar figure here comes from a
          price table:{' '}
          {spend.pricingProvenance === 'negotiated' ? (
            <>rates supplied for this engagement.</>
          ) : spend.pricingProvenance === 'mixed' ? (
            <>
              a mix &mdash; {spend.overriddenSkuCount} SKU
              {spend.overriddenSkuCount === 1 ? ' was' : 's were'} given supplied rates, the rest use
              Microsoft public list prices.
            </>
          ) : (
            <>
              Microsoft public list prices, as at {spend.pricingAsOf}. Actual EA or CSP rates are
              usually lower, so these totals overstate cost and understate the discount already
              negotiated.
            </>
          )}
        </p>

        <h3>Assumed</h3>
        {risk.available ? (
          <>
            <p>
              Expected-loss figures multiply an assumed annual likelihood by an assumed impact for
              each threat. Neither is measured in this tenant &mdash; they are industry-shaped
              assumptions, stated so you can replace them with your own. Treat them as a way of
              ranking work, not as a forecast.
            </p>
            {risk.controlsWithoutThreatTag > 0 && (
              <p class="pack-warn">
                <strong>Risk rests on part of the tenant.</strong> Microsoft tags only some controls
                with a threat, so the expected-loss figures are derived from the controls that carry
                one. {count(risk.controlsWithoutThreatTag)} scored control
                {risk.controlsWithoutThreatTag === 1 ? ' carries' : 's carry'} no threat tag and
                therefore contribute nothing to those figures.
              </p>
            )}
          </>
        ) : (
          <p>{risk.unavailableReason ?? 'No risk figures were produced for this tenant.'}</p>
        )}

        <h3>Not measured</h3>
        <p class="pack-note">
          Where something could not be established it is left empty and the reason is given, rather
          than shown as zero. A zero is a claim about this tenant; an empty figure is an honest gap.
        </p>
        {incompleteCollectors.length > 0 ? (
          <>
            <p class="pack-note">The collectors that did not return complete data for this run:</p>
            <dl class="pack-defs">
              {incompleteCollectors.map((c) => (
                <div key={c.name}>
                  <dt>{c.name}</dt>
                  <dd>{c.reason}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p>Every collector returned complete data for this run.</p>
        )}

        <p class="pack-foot">
          Produced by the M365 Security Investment Report, an open-source tool. Read-only: nothing
          was written to the tenant. Source: {sourceLabel}, collected{' '}
          {shortDate(model.provenance.snapshotCollected)}.
        </p>
      </section>
    </div>
  );
}

function PackHead({ title, tenant }: { title: string; tenant: string }): JSX.Element {
  return (
    <header class="pack-head">
      <h2>{title}</h2>
      <span>{tenant}</span>
    </header>
  );
}

function PackTile({
  label,
  value,
  sub,
  na = false,
}: {
  label: string;
  value: string;
  sub: string;
  na?: boolean;
}): JSX.Element {
  return (
    <div class={na ? 'pack-tile pack-tile--na' : 'pack-tile'}>
      <div class="pack-tile-label">{label}</div>
      <div class="pack-tile-value">{value}</div>
      <div class="pack-tile-sub">{sub}</div>
    </div>
  );
}
