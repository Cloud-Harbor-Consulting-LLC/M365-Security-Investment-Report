import type { JSX } from 'preact';

import type { ReportModel } from '@/engine';
import { money, percent } from '@/format';

/**
 * Where the commitment goes: realized, assigned but not yet switched on, and idle.
 *
 * The same arithmetic as spend realized, drawn rather than multiplied. Spend on assigned
 * seats is split by the share of posture in place, and whatever is not on an assigned
 * seat is idle, so the three parts add up to the commitment and the first part is the
 * headline figure. Shown only when that figure is: a chart of a withheld number would
 * state what the report declines to.
 */
export function CommitmentSplit({ model }: { model: ReportModel }): JSX.Element | null {
  const { spend, realization } = model;
  const commitment = spend.annualCommitment;
  const consumed = spend.annualSpendConsumed;
  const inPlace = realization.feature.ratio;
  if (!realization.composite.available || !commitment || consumed === null || inPlace === null) return null;

  const cur = spend.currency;
  const parts = [
    { key: 'working', label: 'Realized', amount: consumed * inPlace },
    { key: 'off', label: 'Assigned, not yet switched on', amount: consumed * (1 - inPlace) },
    { key: 'idle', label: 'Idle seats', amount: Math.max(commitment - consumed, 0) },
  ].map((p) => ({ ...p, share: p.amount / commitment }));
  // Rounded separately, the three labels can read 39%, 50% and 12%. The realized and
  // idle labels round as they do everywhere else, and the middle one takes what is left.
  const shown = parts.map((p) => Math.round(p.share * 100));
  shown[1] = 100 - shown[0]! - shown[2]!;

  const r = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = parts.map((p) => {
    const length = p.share * circumference;
    const arc = { ...p, dash: `${length} ${circumference - length}`, offset: -offset };
    offset += length;
    return arc;
  });

  return (
    <section class="split" aria-labelledby="split-heading">
      <svg class="donut" viewBox="0 0 150 150" role="img" aria-label={`Spend realized: ${percent(parts[0]!.share)}`}>
        <circle class="d-track" cx="75" cy="75" r={r} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            class={`d-${a.key}`}
            cx="75"
            cy="75"
            r={r}
            stroke-dasharray={a.dash}
            stroke-dashoffset={a.offset}
            transform="rotate(-90 75 75)"
          />
        ))}
        <text x="75" y="80" text-anchor="middle" font-size="30" font-weight="700">
          {percent(parts[0]!.share)}
        </text>
        <text x="75" y="101" text-anchor="middle" font-size="12" class="d-cap">
          realized
        </text>
      </svg>
      <div>
        <h3 id="split-heading">Where the {money(commitment, cur)} goes</h3>
        <div class="split-bar" aria-hidden="true">
          {parts.map((p) =>
            p.share > 0 ? <span key={p.key} class={`seg-${p.key}`} style={{ width: `${p.share * 100}%` }} /> : null,
          )}
        </div>
        <ul class="split-legend">
          {parts.map((p, i) => (
            <li key={p.key}>
              <i class={`seg-${p.key}`} aria-hidden="true" />
              <span>
                <b>{money(p.amount, cur)}</b> {p.label.toLowerCase()} ({shown[i]}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
