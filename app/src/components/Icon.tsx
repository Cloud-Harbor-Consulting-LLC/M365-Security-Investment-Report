import type { JSX } from 'preact';

/**
 * Line icons for the dashboard's actions. Drawn here rather than taken from a library:
 * nine paths do not justify a dependency, and the standalone export has to carry them too.
 * Always beside a text label, so they are hidden from assistive technology.
 */
const PATHS = {
  pricing: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  redact: 'M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7zM4 4l16 16',
  presenter: 'M3 4h18v12H3zM8 20h8M12 16v4',
  board: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6',
  compare: 'M7 7h13l-4-4M17 17H4l4 4',
  export: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-6h8v6',
  portfolio: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  restart: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
