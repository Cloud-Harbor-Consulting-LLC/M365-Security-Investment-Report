import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import type { Change, ControlMovement, LicenceMovement, RunComparison } from '@/engine/compare';
import { count, money, moneyChange, numberChange, percent, percentagePointChange, shortDate } from '@/format';
import { Tile } from './Tile';

interface Props {
  model: ReportModel;
  comparison: RunComparison;
  /** Something to tell the reader about how the comparison was made, or null. */
  note: string | null;
}

const MOVEMENT: Record<ControlMovement, { cls: string; label: string }> = {
  regressed: { cls: 'pill crit', label: 'regressed' },
  closed: { cls: 'pill ok', label: 'closed' },
  improved: { cls: 'pill', label: 'improved' },
  appeared: { cls: 'pill', label: 'newly scored' },
  retired: { cls: 'pill', label: 'no longer scored' },
  unchanged: { cls: 'pill', label: 'unchanged' },
};

const LICENCE: Record<LicenceMovement, string> = {
  added: 'added',
  removed: 'removed',
  changed: 'changed',
};

const STATE: Record<string, string> = { deployed: 'deployed', partial: 'partial', notDeployed: 'not deployed' };

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/**
 * A tile's value and the line beneath it.
 *
 * Today's figure is shown whenever it is known, even when the earlier run cannot supply
 * one: greying out a real number would say it is unknown when only the change is. The
 * change itself is never invented. Without both figures there is no change to state.
 */
export function compared(
  c: Change,
  show: (v: number) => string,
  describe: (c: Change) => string,
): { value: string; unavailable: boolean; sub: string } {
  return {
    value: c.after === null ? 'Not measured' : show(c.after),
    unavailable: c.after === null,
    sub:
      c.change !== null
        ? describe(c)
        : c.after === null
          ? 'Not measured in this run'
          : 'No earlier figure to compare with',
  };
}

/** "300 → 288", or the single figure when it did not move. */
const span = (c: Change, show: (v: number) => string = count): string =>
  c.before === null || c.after === null
    ? 'n/a'
    : c.before === c.after
      ? show(c.after)
      : `${show(c.before)} → ${show(c.after)}`;

/**
 * Since last review: the same tenant, an earlier run, and what changed between them.
 *
 * Written for the quarterly review it exists for. The lead sentence is the one a CFO
 * repeats in the meeting, the tiles carry its figures, and the tables beneath are the
 * evidence: regressions first, because a control that slipped is what the room most needs
 * to hear about and the easiest thing to bury under good news.
 */
export function SinceView({ model, comparison, note }: Props): JSX.Element {
  const cur = model.spend.currency;
  const { headline: h, controlCounts: n } = comparison;
  const since = shortDate(comparison.baselineCollected);
  const scored = !comparison.notComparable.some((r) => r.startsWith('Secure Score'));

  const realized = h.spendRealized;
  const idle = h.idleSeatCost;

  return (
    <>
      <p class="lede-line">
        {realized.change !== null ? (
          <>
            Since {since}, spend realized {realized.change > 0 ? 'rose' : realized.change < 0 ? 'fell' : 'held'}{' '}
            from <strong>{percent(realized.before, 1)}</strong> to <strong>{percent(realized.after, 1)}</strong>.
          </>
        ) : (
          <>Compared with the run collected on {since}, {comparison.daysBetween} days earlier.</>
        )}{' '}
        {scored && (
          <>
            {plural(n.closed, 'control')} closed, {count(n.improved)} improved and {count(n.regressed)} regressed.{' '}
          </>
        )}
        {idle.change !== null && Math.round(idle.change) !== 0 && (
          <>
            Idle seat spend {idle.change < 0 ? 'fell' : 'rose'} by{' '}
            <strong>{money(Math.abs(idle.change), cur)}</strong> a year.
          </>
        )}
      </p>

      <div class="tiles">
        <Tile
          label="Spend realized"
          {...compared(realized, (v) => percent(v, 1), (c) => `${percent(c.before, 1)} on ${since} · ${percentagePointChange(c.change)}`)}
        />
        <Tile
          label="Secure Score"
          {...compared(
            h.securePoints,
            (v) => `${v} of ${h.secureMax.after ?? '?'}`,
            (c) => `was ${c.before} of ${h.secureMax.before} · ${numberChange(c.change)} points`,
          )}
        />
        <Tile
          label="Idle seat spend"
          idle={idle.after !== null}
          {...compared(idle, (v) => money(v, cur), (c) => `was ${money(c.before, cur)} · ${moneyChange(c.change, cur)}`)}
        />
        <Tile
          label="Annual commitment"
          {...compared(
            h.annualCommitment,
            (v) => money(v, cur),
            (c) => `was ${money(c.before, cur)} · ${moneyChange(c.change, cur)}`,
          )}
        />
      </div>

      {comparison.notComparable.length > 0 && (
        <div class="note warn">
          <strong>Not everything could be compared</strong>
          <ul>
            {comparison.notComparable.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          A figure that was not measured in both runs is shown as not comparable rather than as no change.
        </div>
      )}

      <div class="panel">
        <h3>Controls that moved</h3>
        {!scored ? (
          <p class="basis-note">Secure Score was not collected in both runs, so control changes cannot be shown.</p>
        ) : comparison.controls.length === 0 ? (
          <p class="basis-note">No control moved. All {count(n.unchanged)} scored controls are where they were.</p>
        ) : (
          <>
            <div class="tw">
              <table>
                <caption>Secure Score controls that changed since the earlier run, regressions first</caption>
                <thead>
                  <tr>
                    <th scope="col">Control</th>
                    <th scope="col">Service</th>
                    <th scope="col">Movement</th>
                    <th scope="col" class="num">Then</th>
                    <th scope="col" class="num">Now</th>
                    <th scope="col" class="num">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.controls.map((c) => (
                    <tr key={c.controlName}>
                      <td>
                        <span class="prod">{c.displayName}</span>
                        <br />
                        <code class="sku">{c.controlName}</code>
                      </td>
                      <td>{c.service}</td>
                      <td>
                        <span class={MOVEMENT[c.movement].cls}>{MOVEMENT[c.movement].label}</span>
                      </td>
                      {/* Score, then its state on a line of its own. On one line the pair
                          made this the widest table in the report. */}
                      <td class="num">
                        {c.score.before === null ? (
                          'not scored'
                        ) : (
                          <>
                            {c.score.before}
                            <br />
                            <span class="sub">{STATE[c.stateBefore ?? ''] ?? ''}</span>
                          </>
                        )}
                      </td>
                      <td class="num">
                        {c.score.after === null ? (
                          'not scored'
                        ) : (
                          <>
                            {c.score.after}
                            <br />
                            <span class="sub">{STATE[c.stateAfter ?? ''] ?? ''}</span>
                          </>
                        )}
                      </td>
                      <td class="num">{c.score.change === null ? 'n/a' : numberChange(c.score.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="basis-note">
              {count(n.unchanged)} other scored control{n.unchanged === 1 ? ' is' : 's are'} unchanged. A control
              counts as moved by its share of the maximum, so a control Microsoft re-weighted between the runs is not
              shown as something this tenant did.
            </p>
          </>
        )}
      </div>

      <div class="panel">
        <h3>Licences</h3>
        {comparison.licences.length === 0 ? (
          <p class="basis-note">No licence was bought, dropped or reassigned between the runs.</p>
        ) : (
          <div class="tw">
            <table>
              <caption>Licences bought, dropped or reassigned since the earlier run</caption>
              <thead>
                <tr>
                  <th scope="col">Licence</th>
                  <th scope="col">Change</th>
                  <th scope="col" class="num">Seats bought</th>
                  <th scope="col" class="num">Seats assigned</th>
                  <th scope="col" class="num">Annual commitment</th>
                </tr>
              </thead>
              <tbody>
                {comparison.licences.map((l) => (
                  <tr key={l.skuPartNumber}>
                    <td>
                      <span class="prod">{l.displayName}</span>
                      <br />
                      <code class="sku">{l.skuPartNumber}</code>
                    </td>
                    <td>
                      <span class={l.movement === 'removed' ? 'pill attention' : 'pill'}>{LICENCE[l.movement]}</span>
                    </td>
                    <td class="num">{span(l.purchased)}</td>
                    <td class="num">{span(l.assigned)}</td>
                    <td class="num">{moneyChange(l.annualCommitment.change, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div class="panel">
        <h3>Seat-level waste</h3>
        <div class="tw">
          <table>
            <caption>Seat-level waste by category in each run</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" class="num">Seats</th>
                <th scope="col" class="num">Annual cost then</th>
                <th scope="col" class="num">Annual cost now</th>
                <th scope="col" class="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.waste.map((w) => (
                <tr key={w.id} class={w.comparable ? undefined : 'muted'}>
                  <td class="prod">{w.label}</td>
                  <td class="num">{w.comparable ? span(w.seats) : 'n/a'}</td>
                  <td class="num">{w.comparable ? money(w.annualCost.before, cur) : 'n/a'}</td>
                  <td class="num">{w.comparable ? money(w.annualCost.after, cur) : 'n/a'}</td>
                  <td class="num">
                    {w.comparable ? (
                      moneyChange(w.annualCost.change, cur)
                    ) : (
                      <span class="pill attention" title={w.reason ?? undefined}>
                        not comparable
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td class="num">{h.wasteTotal.change === null ? 'n/a' : money(h.wasteTotal.before, cur)}</td>
                <td class="num">{h.wasteTotal.change === null ? 'n/a' : money(h.wasteTotal.after, cur)}</td>
                <td class="num">{h.wasteTotal.change === null ? 'not compared' : moneyChange(h.wasteTotal.change, cur)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="note">
        <strong>How the 2 runs are compared</strong>
        The run collected on {since} is priced at the prices this report uses now and analysed with the same
        reference data, so every difference on this page is something that changed in the tenant, not in a price
        list. {note}
      </div>
    </>
  );
}
