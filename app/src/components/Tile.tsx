import type { JSX } from 'preact';

export interface TileProps {
  label: string;
  value: string;
  sub?: string;
  /** Shown beneath the figure when it is correct but liable to be misread. */
  caveat?: string | null;
  idle?: boolean;
  unavailable?: boolean;
}

export function Tile({ label, value, sub, caveat, idle, unavailable }: TileProps): JSX.Element {
  const classes = ['tile'];
  if (idle) classes.push('tile--idle');
  if (caveat) classes.push('tile--caveat');

  return (
    <div class={classes.join(' ')}>
      <div class="lab">{label}</div>
      <div class={unavailable ? 'val na' : 'val'}>{value}</div>
      {sub && <div class="sub">{sub}</div>}
      {caveat && (
        <div class="tile-caveat">
          <strong>Read with care.</strong> {caveat}
        </div>
      )}
    </div>
  );
}
